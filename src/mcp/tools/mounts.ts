import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Settings } from "../../config/schema.js";
import { sanitizeObject } from "../../utils/sanitize.js";

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerMountsTool(server: McpServer, settings: Settings): void {
  server.registerTool(
    "pai_mounts_list",
    {
      description: "List configured mounts from settings",
    },
    async (_extra) => {
      const mounts = sanitizeObject(settings.mounts);
      return {
        content: [{ type: "text", text: toText(mounts) }],
      };
    },
  );
}
