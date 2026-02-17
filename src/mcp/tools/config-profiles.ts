import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";

import type { Profile } from "../../config/schema.js";
import type { ConfigStore } from "../../config/store.js";
import { sanitizeObject } from "../../utils/sanitize.js";

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

const createProfileInputSchema = {
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .describe("Profile name (lowercase alphanumeric + hyphens only)"),
  overrides: z
    .record(z.string(), z.unknown())
    .describe(
      "Profile overrides using Profile fields directly: { jobSpecs: [...], " +
        "jobType: 'PyTorchJob' }. " +
        "Only these top-level keys are allowed.",
    ),
  fromCurrent: z
    .boolean()
    .optional()
    .describe("If true, snapshot base profile as base, then apply overrides on top"),
  baseProfile: z
    .string()
    .min(1)
    .optional()
    .describe("Base profile to snapshot from when fromCurrent=true. Defaults to 'default'."),
} as unknown as ZodRawShapeCompat;

const deleteProfileInputSchema = {
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .describe("Profile name to delete (cannot delete 'default')"),
} as unknown as ZodRawShapeCompat;

export function registerConfigProfileTools(server: McpServer, configStore: ConfigStore): void {
  // --- pai_config_list_profiles ---
  server.registerTool(
    "pai_config_list_profiles",
    {
      description:
        "List all saved configuration profiles. Each profile is a named preset " +
        'of resource settings (jobSpecs, jobType). A "default" profile always exists.',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (_extra) => {
      const profileMap = configStore.getProfiles();
      const profiles = Object.entries(profileMap).map(([name, overrides]) => ({
        name,
        overrides,
      }));
      const result = sanitizeObject(profiles);
      return {
        content: [{ type: "text", text: toText(result) }],
      };
    },
  );

  // --- pai_config_create_profile ---
  server.registerTool(
    "pai_config_create_profile",
    {
      description:
        "Create or update a named configuration profile. Profiles store resource presets " +
        "using Profile fields directly (jobSpecs, jobType). " +
        "Dot-path keys are not supported. " +
        "Use fromCurrent=true to snapshot a base profile before applying overrides. " +
        "Profile names must be lowercase alphanumeric with hyphens only.",
      inputSchema: createProfileInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, _extra) => {
      const name = args.name as string;
      const rawOverrides = args.overrides as Record<string, unknown>;
      const fromCurrent = args.fromCurrent as boolean | undefined;
      const baseProfileName = (args.baseProfile as string | undefined) ?? "default";

      try {
        let overrides: Record<string, unknown>;

        if (fromCurrent === true) {
          const baseProfile = configStore.getProfile(baseProfileName);
          const base: Record<string, unknown> = {
            jobSpecs: baseProfile.jobSpecs,
            jobType: baseProfile.jobType,
          };
          overrides = { ...base, ...rawOverrides };
        } else {
          overrides = rawOverrides;
        }

        await configStore.setProfile(name, overrides as Profile);

        const result = sanitizeObject({ name, overrides });
        return {
          content: [{ type: "text", text: toText(result) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes("locked field") || message.includes("Cannot modify locked field")) {
          return {
            isError: true,
            content: [{ type: "text", text: `Cannot include locked field in profile: ${message}` }],
          };
        }

        if (
          message.includes("Expected") ||
          message.includes("invalid") ||
          message.includes("Zod") ||
          message.includes("Invalid profile name") ||
          message.includes("reserved")
        ) {
          return {
            isError: true,
            content: [{ type: "text", text: `Profile validation failed: ${message}` }],
          };
        }

        throw error;
      }
    },
  );

  // --- pai_config_delete_profile ---
  server.registerTool(
    "pai_config_delete_profile",
    {
      description:
        "Delete a named configuration profile. Cannot delete the 'default' profile. " +
        "Returns the name of the deleted profile on success.",
      inputSchema: deleteProfileInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, _extra) => {
      const name = args.name as string;

      try {
        await configStore.deleteProfile(name);
        return {
          content: [{ type: "text", text: toText({ deleted: name }) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (
          message.includes("Cannot delete") ||
          message.includes("does not exist") ||
          message.includes("Invalid profile name") ||
          message.includes("reserved")
        ) {
          return {
            isError: true,
            content: [{ type: "text", text: `Cannot delete profile: ${message}` }],
          };
        }

        throw error;
      }
    },
  );
}
