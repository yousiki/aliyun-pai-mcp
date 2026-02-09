import { ListJobsRequest } from "@alicloud/pai-dlc20201203";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DlcClientApi } from "../../clients/dlc.js";
import type { Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";

const jobListInputSchema = z.object({
  limit: z.number().int().positive().max(100).optional().default(20),
});

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerJobListTool(
  server: McpServer,
  settings: Settings,
  dlcClient: DlcClientApi,
): void {
  server.registerTool(
    "pai_job_list",
    {
      description: "List recent jobs for current project prefix",
      inputSchema: jobListInputSchema,
    },
    async (args, _extra) => {
      const request = new ListJobsRequest({
        workspaceId: settings.workspaceId,
        showOwn: true,
        displayName: settings.projectPrefix,
        pageSize: args.limit,
        pageNumber: 1,
        sortBy: "GmtCreateTime",
        order: "desc",
      });

      const response = await dlcClient.listJobs(request);
      const jobs =
        response.body?.jobs?.map((job) => ({
          jobId: job.jobId,
          displayName: job.displayName,
          status: job.status,
          gmtCreateTime: job.gmtCreateTime,
        })) ?? [];

      return {
        content: [{ type: "text", text: toText(sanitizeObject(jobs)) }],
      };
    },
  );
}
