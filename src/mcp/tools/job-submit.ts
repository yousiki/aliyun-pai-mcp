import {
  CreateJobRequest,
  CreateJobRequestCodeSource,
  CreateJobRequestDataSources,
  JobSpec,
} from "@alicloud/pai-dlc20201203";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DlcClientApi } from "../../clients/dlc.js";
import type { Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";
import { generateDisplayName } from "../../utils/validate.js";

const jobSubmitInputSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  codeCommit: z.string().min(1).optional(),
});

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

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
      description: "Submit a new DLC job",
      inputSchema: jobSubmitInputSchema,
    },
    async (args, _extra) => {
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
              mountAccess: mount.mountAccess,
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
