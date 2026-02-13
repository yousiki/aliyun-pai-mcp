import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ConfigStore } from "../../config/store.js";
import { sanitizeSettings } from "../../utils/sanitize.js";

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerConfigTool(server: McpServer, configStore: ConfigStore): void {
  server.registerTool(
    "pai_config",
    {
      description:
        "Show current MCP settings (sanitized, no secrets). " +
        "Returns project prefix, region, workspace, resource quota, " +
        "job defaults (type, image, GPU/CPU/memory, pod count), " +
        "data source mounts, and code source configuration. " +
        "Call this first to understand what resources and mounts " +
        "will be used when submitting jobs.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (_extra) => {
      const result = sanitizeSettings(configStore.get());
      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );
}
