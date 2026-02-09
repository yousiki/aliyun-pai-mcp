import { GetJobRequest } from "@alicloud/pai-dlc20201203";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import type { DlcClientApi } from "../../clients/dlc.js";
import type { CallerIdentity } from "../../clients/sts.js";
import type { Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";
import { validateJobOwnership } from "../../utils/validate.js";

const jobStopInputSchema = {
  jobId: z.string().min(1),
} as unknown as ZodRawShapeCompat;

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerJobStopTool(
  server: McpServer,
  settings: Settings,
  dlcClient: DlcClientApi,
  callerIdentity: CallerIdentity,
): void {
  server.registerTool(
    "pai_job_stop",
    {
      description: "Stop a running job",
      inputSchema: jobStopInputSchema,
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

      const ownership = validateJobOwnership(job, settings.projectPrefix, callerIdentity.userId);
      if (!ownership.valid) {
        return {
          isError: true,
          content: [{ type: "text", text: ownership.reason ?? "Job ownership validation failed." }],
        };
      }

      await dlcClient.stopJob(args.jobId);
      const result = sanitizeObject({
        jobId: args.jobId,
        result: "stopped",
      });

      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );
}
