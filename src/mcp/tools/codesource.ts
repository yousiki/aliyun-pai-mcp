import type WorkspaceClient from "@alicloud/aiworkspace20210204";
import { UpdateCodeSourceRequest } from "@alicloud/aiworkspace20210204";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

const codeSourceUpdateInputSchema = z
  .object({
    branch: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
  })
  .refine((value) => value.branch !== undefined || value.commit !== undefined, {
    message: "At least one of 'branch' or 'commit' must be provided.",
  });

export function registerCodeSourceTools(
  server: McpServer,
  settings: Settings,
  workspaceClient: WorkspaceClient,
): void {
  server.registerTool(
    "pai_codesource_get",
    {
      description: "Show configured code source settings",
    },
    async (_extra) => {
      if (!settings.codeSource) {
        return {
          content: [{ type: "text", text: "No code source configured." }],
        };
      }
      const result = sanitizeObject(settings.codeSource);
      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );

  server.registerTool(
    "pai_codesource_update",
    {
      description: "Update code source branch and/or commit",
      inputSchema: codeSourceUpdateInputSchema,
    },
    async (args, _extra) => {
      if (!settings.codeSource) {
        throw new Error("No code source configured in settings.");
      }

      const request = new UpdateCodeSourceRequest({
        codeBranch: args.branch,
        codeCommit: args.commit,
      });

      const response = await workspaceClient.updateCodeSource(
        settings.codeSource.codeSourceId,
        request,
      );
      const result = sanitizeObject({
        codeSourceId: settings.codeSource.codeSourceId,
        branch: args.branch ?? settings.codeSource.defaultBranch,
        commit: args.commit ?? settings.codeSource.defaultCommit,
        requestId: response.body?.requestId,
      });

      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );
}
