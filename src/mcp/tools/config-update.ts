import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";

import type { ConfigStore } from "../../config/store.js";
import { sanitizeObject } from "../../utils/sanitize.js";

const configUpdateInputSchema = {
  updates: z
    .record(z.string(), z.unknown())
    .describe(
      "Map of field paths to new values. Supports dot-notation with array indices. " +
        'Example: { "jobDefaults.jobSpecs[0].resourceConfig.GPU": "8", "maxRunningJobs": 2 }. ' +
        "Use pai_config_schema to see available fields and current values.",
    ),
} as unknown as ZodRawShapeCompat;

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function registerConfigUpdateTool(server: McpServer, configStore: ConfigStore): void {
  server.registerTool(
    "pai_config_update",
    {
      description:
        "Update modifiable configuration fields at runtime. Changes are validated " +
        "against the settings schema and persisted to disk. Locked fields (credentials, " +
        "regionId, workspaceId, resourceId, projectPrefix) cannot be modified — " +
        "use 'init' command instead. Use pai_config_schema to discover available fields.",
      inputSchema: configUpdateInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, _extra) => {
      const updates = args.updates as Record<string, unknown>;

      if (Object.keys(updates).length === 0) {
        return {
          isError: true,
          content: [
            { type: "text", text: "No updates provided. Pass at least one field to update." },
          ],
        };
      }

      if (Object.keys(updates).length > 50) {
        return {
          isError: true,
          content: [{ type: "text", text: "Too many updates: maximum 50 keys allowed." }],
        };
      }

      if (Object.keys(updates).some((key) => key.length === 0)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Invalid updates: empty key is not allowed." }],
        };
      }

      try {
        const diff = await configStore.updateByDotPaths(updates);

        if (Object.keys(diff.changed).length === 0) {
          return {
            content: [
              {
                type: "text",
                text: toText({
                  message: "No changes detected — values are already set.",
                  changed: {},
                }),
              },
            ],
          };
        }

        const result = sanitizeObject({
          message: `Updated ${Object.keys(diff.changed).length} field(s).`,
          changed: diff.changed,
        });
        return {
          content: [{ type: "text", text: toText(result) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("locked field")) {
          return {
            isError: true,
            content: [{ type: "text", text: `Cannot modify locked field: ${message}` }],
          };
        }

        if (
          message.includes("Expected") ||
          message.includes("invalid") ||
          message.includes("Zod")
        ) {
          return {
            isError: true,
            content: [{ type: "text", text: `Validation failed: ${message}` }],
          };
        }

        throw error;
      }
    },
  );
}
