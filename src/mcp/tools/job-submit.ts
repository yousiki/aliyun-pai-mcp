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
import type { MountAccess, Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";
import { generateDisplayName, isActiveStatus } from "../../utils/validate.js";

const jobSubmitInputSchema = {
  name: z
    .string()
    .min(1)
    .describe(
      "Short task name (e.g. 'train', 'eval', 'debug'). " +
        "Do NOT include the project prefix — it is prepended automatically. " +
        "Final displayName will be: {projectPrefix}-{name}-{timestamp}.",
    ),
  command: z.string().min(1).describe("The shell command to run inside the container."),
  codeCommit: z
    .string()
    .min(1)
    .optional()
    .describe("Git commit hash to checkout. Uses default from settings if omitted."),
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

function buildJobSpecs(settings: Settings): JobSpec[] {
  if (settings.jobDefaults.jobSpecs.length > 0) {
    return settings.jobDefaults.jobSpecs.map((rawSpec) => new JobSpec(rawSpec));
  }

  const simple = settings.jobDefaults.simple;
  if (!simple) {
    throw new Error(
      "Job spec defaults are missing: provide jobDefaults.jobSpecs or jobDefaults.simple.",
    );
  }

  return [
    new JobSpec({
      type: "Worker",
      image: simple.dockerImage,
      ecsSpec: simple.ecsSpec,
      podCount: simple.podCount,
    }),
  ];
}

export function registerJobSubmitTool(
  server: McpServer,
  settings: Settings,
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
      const maxRunning = settings.maxRunningJobs ?? 1;
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
      const activeJobs =
        listResponse.body?.jobs?.filter((job) => isActiveStatus(job.status ?? "")) ?? [];
      if (activeJobs.length >= maxRunning) {
        const jobSummary = activeJobs.map((j) => `  - ${j.displayName} (${j.status})`).join("\n");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Concurrency limit reached: ${activeJobs.length}/${maxRunning} active job(s) for project '${settings.projectPrefix}'.\n` +
                `Active jobs:\n${jobSummary}\n\n` +
                "Wait for existing jobs to finish or stop them before submitting a new one.",
            },
          ],
        };
      }

      const displayName = generateDisplayName(settings.projectPrefix, args.name);
      const request = new CreateJobRequest({
        workspaceId: settings.workspaceId,
        resourceId: settings.resourceId,
        displayName,
        jobType: settings.jobDefaults.jobType,
        jobSpecs: buildJobSpecs(settings),
        userCommand: args.command,
        codeSource: settings.codeSource
          ? new CreateJobRequestCodeSource({
              codeSourceId: settings.codeSource.codeSourceId,
              branch: settings.codeSource.defaultBranch,
              commit: args.codeCommit ?? settings.codeSource.defaultCommit ?? undefined,
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

      const result = sanitizeObject({ jobId, displayName });
      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );
}
