import { GetJobRequest, GetPodLogsRequest } from "@alicloud/pai-dlc20201203";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DlcClientApi } from "../../clients/dlc.js";
import type { CallerIdentity } from "../../clients/sts.js";
import type { Settings } from "../../config/schema.js";

const jobLogsInputSchema = z.object({
  jobId: z.string().min(1),
  podId: z.string().min(1).optional(),
  maxLines: z.number().int().positive().max(5000).optional().default(200),
});

export function registerJobLogsTool(
  server: McpServer,
  settings: Settings,
  dlcClient: DlcClientApi,
  callerIdentity: CallerIdentity,
): void {
  server.registerTool(
    "pai_job_logs",
    {
      description: "Get pod logs for a job",
      inputSchema: jobLogsInputSchema,
    },
    async (args, _extra) => {
      const jobResponse = await dlcClient.getJob(args.jobId, new GetJobRequest({}));
      const job = jobResponse.body;
      if (!job) {
        return {
          isError: true,
          content: [{ type: "text", text: `Job '${args.jobId}' not found.` }],
        };
      }

      if (callerIdentity.userId && job.userId && job.userId !== callerIdentity.userId) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Job belongs to user '${job.userId}', not current user.` },
          ],
        };
      }

      const chosenPod = args.podId
        ? (job.pods ?? []).find((pod) => pod.podId === args.podId)
        : job.pods?.[0];
      const chosenPodId = args.podId ?? chosenPod?.podId;

      if (!chosenPodId) {
        return {
          isError: true,
          content: [{ type: "text", text: "No pod is available for this job." }],
        };
      }

      const logsResponse = await dlcClient.getPodLogs(
        args.jobId,
        chosenPodId,
        new GetPodLogsRequest({
          maxLines: args.maxLines,
          podUid: chosenPod?.podUid,
        }),
      );

      return {
        content: [{ type: "text", text: (logsResponse.body?.logs ?? []).join("\n") }],
      };
    },
  );
}
