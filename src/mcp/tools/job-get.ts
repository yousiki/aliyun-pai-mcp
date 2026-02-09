import { GetJobRequest } from "@alicloud/pai-dlc20201203";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DlcClientApi } from "../../clients/dlc.js";
import type { CallerIdentity } from "../../clients/sts.js";
import type { Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";
import { validateJobOwnership } from "../../utils/validate.js";

const jobGetInputSchema = z.object({
  jobId: z.string().min(1),
});

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerJobGetTool(
  server: McpServer,
  settings: Settings,
  dlcClient: DlcClientApi,
  callerIdentity: CallerIdentity,
): void {
  server.registerTool(
    "pai_job_get",
    {
      description: "Get details for a specific job",
      inputSchema: jobGetInputSchema,
    },
    async (args, _extra) => {
      const response = await dlcClient.getJob(args.jobId, new GetJobRequest({}));
      const job = response.body;

      if (!job) {
        return {
          isError: true,
          content: [{ type: "text", text: `Job '${args.jobId}' not found.` }],
        };
      }

      const ownership = validateJobOwnership(job, settings.projectPrefix, callerIdentity.userId);
      if (!ownership.valid) {
        return {
          isError: true,
          content: [{ type: "text", text: ownership.reason ?? "Job ownership validation failed." }],
        };
      }

      const result = sanitizeObject({
        jobId: job.jobId,
        displayName: job.displayName,
        status: job.status,
        jobType: job.jobType,
        reasonCode: job.reasonCode,
        reasonMessage: job.reasonMessage,
        gmtCreateTime: job.gmtCreateTime,
        gmtRunningTime: job.gmtRunningTime,
        gmtFinishTime: job.gmtFinishTime,
        duration: job.duration,
        pods:
          job.pods?.map((pod) => ({
            podId: pod.podId,
            type: pod.type,
            status: pod.status,
            ip: pod.ip,
            podUid: pod.podUid,
          })) ?? [],
      });

      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );
}
