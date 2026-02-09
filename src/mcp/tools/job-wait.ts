import { GetJobRequest } from "@alicloud/pai-dlc20201203";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import type { DlcClientApi } from "../../clients/dlc.js";
import type { CallerIdentity } from "../../clients/sts.js";
import type { Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";
import { isTerminalStatus, validateJobOwnership } from "../../utils/validate.js";

const jobWaitInputSchema = {
  jobId: z.string().min(1),
  target: z.enum(["Running", "Terminal"]).optional().default("Running"),
  timeoutSec: z.number().int().positive().optional().default(900),
  pollSec: z.number().int().positive().optional().default(10),
} as unknown as ZodRawShapeCompat;

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerJobWaitTool(
  server: McpServer,
  settings: Settings,
  dlcClient: DlcClientApi,
  callerIdentity: CallerIdentity,
): void {
  server.registerTool(
    "pai_job_wait",
    {
      description: "Wait until a job reaches Running or Terminal status",
      inputSchema: jobWaitInputSchema,
    },
    async (args, _extra) => {
      const deadline = Date.now() + args.timeoutSec * 1000;
      let isOwnershipValidated = false;
      let lastStatus = "Unknown";

      while (Date.now() <= deadline) {
        const response = await dlcClient.getJob(args.jobId, new GetJobRequest({}));
        const job = response.body;

        if (!job) {
          return {
            isError: true,
            content: [{ type: "text", text: `Job '${args.jobId}' not found.` }],
          };
        }

        if (!isOwnershipValidated) {
          const ownership = validateJobOwnership(
            job,
            settings.projectPrefix,
            callerIdentity.userId,
          );
          if (!ownership.valid) {
            return {
              isError: true,
              content: [
                { type: "text", text: ownership.reason ?? "Job ownership validation failed." },
              ],
            };
          }
          isOwnershipValidated = true;
        }

        const status = job.status ?? "Unknown";
        lastStatus = status;

        if (args.target === "Running" && status === "Running") {
          const result = sanitizeObject({
            jobId: job.jobId,
            status: job.status,
            displayName: job.displayName,
            duration: job.duration,
          });
          return {
            content: [{ type: "text", text: toText(result) }],
          };
        }

        if (args.target === "Terminal" && isTerminalStatus(status)) {
          const result = sanitizeObject({
            jobId: job.jobId,
            status: job.status,
            displayName: job.displayName,
            duration: job.duration,
          });
          return {
            content: [{ type: "text", text: toText(result) }],
          };
        }

        await Bun.sleep(args.pollSec * 1000);
      }

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Timed out after ${args.timeoutSec}s waiting for '${args.jobId}' to reach '${args.target}'. Last status: ${lastStatus}.`,
          },
        ],
      };
    },
  );
}
