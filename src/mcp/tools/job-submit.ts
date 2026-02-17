import {
  CreateJobRequest,
  CreateJobRequestCodeSource,
  CreateJobRequestDataSources,
  JobSpec,
  ListJobsRequest,
} from "@alicloud/pai-dlc20201203";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import type { DlcClientApi } from "../../clients/dlc.js";
import type { MountAccess } from "../../config/schema.js";
import type { ConfigStore } from "../../config/store.js";
import { sanitizeObject } from "../../utils/sanitize.js";
import {
  extractResources,
  formatJobSpecsSummary,
  generateDisplayName,
  isActiveStatus,
} from "../../utils/validate.js";

const jobSubmitInputSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      "Short task name (e.g. 'train', 'eval', 'debug'). " +
        "Do NOT include the project prefix — it is prepended automatically. " +
        "Final displayName will be: {projectPrefix}-{name}-{timestamp}.",
    ),
  command: z.string().min(1).describe("Shell command to run inside the container."),
  profile: z
    .string()
    .min(1)
    .optional()
    .default("default")
    .describe("Profile name to use for job resources. Defaults to 'default'."),
  codeBranch: z.string().min(1).optional().describe("Git branch for code source."),
  codeCommit: z.string().min(1).optional().describe("[DEPRECATED] Git commit hash to checkout."),
} as unknown as ZodRawShapeCompat;

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * The DLC API uses "RO" for read-only mounts, not "ReadOnly".
 * Map the human-readable settings values to what the API actually expects.
 */
const MOUNT_ACCESS_API_VALUES: Record<MountAccess, string> = {
  ReadOnly: "RO",
  ReadWrite: "ReadWrite",
};

function toJobSpecsArray(value: unknown): ReadonlyArray<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

function buildJobSpecs(jobSpecs: ReadonlyArray<Record<string, unknown>>): JobSpec[] {
  if (jobSpecs.length === 0) {
    throw new Error("jobSpecs is empty: configure via pai_config_update or profiles.");
  }

  return jobSpecs.map((rawSpec) => new JobSpec(rawSpec));
}

export function registerJobSubmitTool(
  server: McpServer,
  configStore: ConfigStore,
  dlcClient: DlcClientApi,
): void {
  server.registerTool(
    "pai_job_submit",
    {
      description:
        "Submit a new DLC job. Only 'name' and 'command' are specified by the caller. " +
        "All other job parameters (image, GPU/CPU/memory, pod count, mounts, code source) " +
        "are controlled by MCP settings. Use pai_config to inspect the current configuration. " +
        "A concurrency limit is enforced per project prefix (default: 1 active job). " +
        "If the limit is reached, the submission is rejected — stop or wait for existing jobs first.",
      inputSchema: jobSubmitInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args, _extra) => {
      const settings = configStore.get();
      const profile = configStore.getProfile((args.profile as string) ?? "default");
      const profileJobSpecs = toJobSpecsArray(profile.jobSpecs);
      const requestedResources = extractResources(profileJobSpecs);

      const maxRunning = settings.limits?.maxRunningJobs ?? 1;
      const maxGPU = settings.limits?.maxGPU;
      const maxCPU = settings.limits?.maxCPU;
      const listResponse = await dlcClient.listJobs(
        new ListJobsRequest({
          workspaceId: settings.workspaceId,
          showOwn: true,
          displayName: settings.projectPrefix,
          pageSize: 100,
          pageNumber: 1,
          sortBy: "GmtCreateTime",
          order: "desc",
        }),
      );
      const expectedPrefix = `${settings.projectPrefix}-`;
      const activeJobs =
        listResponse.body?.jobs
          ?.filter((job) => (job.displayName ?? "").startsWith(expectedPrefix))
          .filter((job) => isActiveStatus(job.status ?? "")) ?? [];

      if (activeJobs.length >= maxRunning) {
        const jobSummary = activeJobs.map((j) => `  - ${j.displayName} (${j.status})`).join("\n");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Limit exceeded: maxRunningJobs (${maxRunning}). ` +
                `Current active jobs: ${activeJobs.length}.\n` +
                `Active jobs:\n${jobSummary}\n\n` +
                "Wait for existing jobs to finish or stop them before submitting a new one.",
            },
          ],
        };
      }

      const activeResources = activeJobs.reduce(
        (acc, job) => {
          const resources = extractResources(toJobSpecsArray(job.jobSpecs));
          return {
            gpu: acc.gpu + resources.gpu,
            cpu: acc.cpu + resources.cpu,
          };
        },
        { gpu: 0, cpu: 0 },
      );

      const projectedGPU = activeResources.gpu + requestedResources.gpu;
      if (maxGPU !== undefined && projectedGPU > maxGPU) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Limit exceeded: maxGPU (${maxGPU}). ` +
                `Current usage: ${activeResources.gpu}, requested: ${requestedResources.gpu}, ` +
                `projected: ${projectedGPU}.`,
            },
          ],
        };
      }

      const projectedCPU = activeResources.cpu + requestedResources.cpu;
      if (maxCPU !== undefined && projectedCPU > maxCPU) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Limit exceeded: maxCPU (${maxCPU}). ` +
                `Current usage: ${activeResources.cpu}, requested: ${requestedResources.cpu}, ` +
                `projected: ${projectedCPU}.`,
            },
          ],
        };
      }

      const displayName = generateDisplayName(settings.projectPrefix, args.name);
      const codeBranch = args.codeBranch ?? settings.codeSource?.defaultBranch;
      const request = new CreateJobRequest({
        workspaceId: settings.workspaceId,
        resourceId: settings.resourceId,
        displayName,
        jobType: profile.jobType,
        jobSpecs: buildJobSpecs(profileJobSpecs),
        userCommand: args.command,
        codeSource: settings.codeSource
          ? new CreateJobRequestCodeSource({
              codeSourceId: settings.codeSource.codeSourceId,
              branch: codeBranch,
              commit: args.codeCommit ?? undefined,
              mountPath: settings.codeSource.mountPath,
            })
          : undefined,
        dataSources: settings.mounts.map(
          (mount) =>
            new CreateJobRequestDataSources({
              uri: mount.uri,
              mountPath: mount.mountPath,
              mountAccess: MOUNT_ACCESS_API_VALUES[mount.mountAccess],
              options: mount.options ?? undefined,
            }),
        ),
      });

      const response = await dlcClient.createJob(request);
      const jobId = response.body?.jobId;
      if (!jobId) {
        throw new Error("DLC createJob succeeded but no jobId was returned.");
      }

      const result = sanitizeObject({
        jobId,
        displayName,
        submitted: {
          profile: (args.profile as string) ?? "default",
          jobType: profile.jobType,
          image:
            typeof profileJobSpecs[0]?.image === "string"
              ? (profileJobSpecs[0].image as string)
              : null,
          resources: formatJobSpecsSummary(profileJobSpecs),
          command: args.command,
          codeBranch: codeBranch ?? null,
          mounts: settings.mounts.map(
            (mount, index) =>
              `ds-${index}:${mount.mountPath}(${MOUNT_ACCESS_API_VALUES[mount.mountAccess]})`,
          ),
        },
      });
      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );
}
