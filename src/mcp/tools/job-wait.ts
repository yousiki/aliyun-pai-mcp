import { GetJobRequest } from "@alicloud/pai-dlc20201203";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import type { DlcClientApi } from "../../clients/dlc.js";
import type { CallerIdentity } from "../../clients/sts.js";
import type { ConfigStore } from "../../config/store.js";
import { sanitizeObject } from "../../utils/sanitize.js";
import { isTerminalStatus, validateJobOwnership } from "../../utils/validate.js";

const jobWaitInputSchema = {
  jobId: z.string().min(1),
  target: z.enum(["Running", "Terminal"]).optional().default("Running"),
  timeoutSec: z
    .number()
    .int()
    .positive()
    .optional()
    .default(30)
    .describe(
      "Max seconds to poll before returning current status. Default 30s. Call again to continue waiting.",
    ),
  pollSec: z.number().int().positive().optional().default(10),
} as unknown as ZodRawShapeCompat;

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerJobWaitTool(
  server: McpServer,
  configStore: ConfigStore,
  dlcClient: DlcClientApi,
  callerIdentity: CallerIdentity,
): void {
  server.registerTool(
    "pai_job_wait",
    {
      description:
        "Poll a job until it reaches the target status or the timeout expires. " +
        "Returns current status in both cases — NOT an error on timeout. " +
        "Call again to continue waiting if 'reached' is false. Default timeout: 30s.",
      inputSchema: jobWaitInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args, _extra) => {
      const deadline = Date.now() + args.timeoutSec * 1000;
      let isOwnershipValidated = false;
      let lastStatus = "Unknown";
      let lastJobSnapshot: Record<string, unknown> | undefined;

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
          const settings = configStore.get();
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
        lastJobSnapshot = {
          jobId: job.jobId,
          status: job.status,
          displayName: job.displayName,
          duration: job.duration,
        };

        const reached =
          (args.target === "Running" && status === "Running") ||
          (args.target === "Terminal" && isTerminalStatus(status));

        if (reached) {
          const result = sanitizeObject({ ...lastJobSnapshot, reached: true });
          return { content: [{ type: "text", text: toText(result) }] };
        }

        if (isTerminalStatus(status) && args.target === "Running") {
          const result = sanitizeObject({
            ...lastJobSnapshot,
            reached: false,
            message: `Job reached terminal status '${status}' before 'Running'.`,
          });
          return { content: [{ type: "text", text: toText(result) }] };
        }

        await Bun.sleep(args.pollSec * 1000);
      }

      const result = sanitizeObject({
        ...(lastJobSnapshot ?? { jobId: args.jobId, status: lastStatus }),
        reached: false,
        message:
          `Not yet '${args.target}' after ${args.timeoutSec}s (current: '${lastStatus}'). ` +
          "Call pai_job_wait again to continue waiting.",
      });
      return { content: [{ type: "text", text: toText(result) }] };
    },
  );
}
