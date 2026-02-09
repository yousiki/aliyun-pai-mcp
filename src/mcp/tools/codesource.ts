import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerCodeSourceTools(server: McpServer, settings: Settings): void {
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
}
