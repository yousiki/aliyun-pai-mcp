import type WorkspaceClient from "@alicloud/aiworkspace20210204";
import { UpdateCodeSourceRequest } from "@alicloud/aiworkspace20210204";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";

import type { Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

const codeSourceUpdateInputSchema = {
  branch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
} as unknown as ZodRawShapeCompat;

export function registerCodeSourceTools(
  server: McpServer,
  settings: Settings,
  workspaceClient: WorkspaceClient,
): void {
  server.registerTool(
    "pai_codesource_get",
    {
      description: "Show configured code source settings",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, _extra) => {
      if (!settings.codeSource) {
        throw new Error("No code source configured in settings.");
      }

      if (args.branch === undefined && args.commit === undefined) {
        throw new Error("At least one of 'branch' or 'commit' must be provided.");
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
