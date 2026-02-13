import type STSClient from "@alicloud/sts20150401";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallerIdentity } from "../../clients/sts.js";
import type { ConfigStore } from "../../config/store.js";
import { sanitizeObject } from "../../utils/sanitize.js";

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerWhoamiTool(
  server: McpServer,
  configStore: ConfigStore,
  _stsClient: STSClient,
  cachedIdentity: CallerIdentity,
): void {
  server.registerTool(
    "pai_whoami",
    {
      description: "Show current caller identity and workspace context",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (_extra) => {
      const settings = configStore.get();
      const result = sanitizeObject({
        accountId: cachedIdentity.accountId,
        userId: cachedIdentity.userId,
        identityType: cachedIdentity.identityType,
        regionId: settings.regionId,
        workspaceId: settings.workspaceId,
      });

      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );
}
