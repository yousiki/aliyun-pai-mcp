import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ConfigStore } from "../../config/store.js";
import { sanitizeObject } from "../../utils/sanitize.js";

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerCodeSourceTools(server: McpServer, configStore: ConfigStore): void {
  server.registerTool(
    "pai_codesource_get",
    {
      description: "Show configured code source settings",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (_extra) => {
      const settings = configStore.get();
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
