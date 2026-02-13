import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";

import type { Profile } from "../../config/schema.js";
import type { ConfigStore } from "../../config/store.js";
import { sanitizeObject } from "../../utils/sanitize.js";

function toText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

const applyProfileInputSchema = {
  name: z.string().min(1).describe("Profile name to apply"),
} as unknown as ZodRawShapeCompat;

const createProfileInputSchema = {
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/)
    .describe("Profile name (lowercase alphanumeric + hyphens only)"),
  overrides: z
    .record(z.string(), z.unknown())
    .describe("Config field overrides for this profile (only modifiable fields allowed)"),
  fromCurrent: z
    .boolean()
    .optional()
    .describe("If true, snapshot current config as base, then apply overrides on top"),
} as unknown as ZodRawShapeCompat;

export function registerConfigProfileTools(server: McpServer, configStore: ConfigStore): void {
  // --- pai_config_list_profiles ---
  server.registerTool(
    "pai_config_list_profiles",
    {
      description:
        "List all saved configuration profiles. Each profile is a named preset " +
        "of resource settings (jobSpecs, jobType, mounts, maxRunningJobs) that can be " +
        "applied with pai_config_apply_profile. Returns an empty array if no profiles exist.",
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

  // --- pai_config_apply_profile ---
  server.registerTool(
    "pai_config_apply_profile",
    {
      description:
        "Apply a saved configuration profile by name. Merges the profile's overrides " +
        "into the current settings (jobSpecs, jobType, mounts, maxRunningJobs). " +
        "Returns a diff showing what changed. Use pai_config_list_profiles to see available profiles.",
      inputSchema: applyProfileInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, _extra) => {
      try {
        const diff = await configStore.applyProfile(args.name as string);
        const result = sanitizeObject({
          message: `Profile "${args.name}" applied.`,
          changed: diff.changed,
        });
        return {
          content: [{ type: "text", text: toText(result) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("does not exist")) {
          return {
            isError: true,
            content: [{ type: "text", text: `Profile '${args.name}' not found` }],
          };
        }
        throw error;
      }
    },
  );

  // --- pai_config_create_profile ---
  server.registerTool(
    "pai_config_create_profile",
    {
      description:
        "Create or update a named configuration profile. Profiles store resource presets " +
        "(jobSpecs, jobType, mounts, maxRunningJobs) that can be quickly applied later. " +
        "Use fromCurrent=true to snapshot current settings as a base before applying overrides. " +
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

      try {
        let overrides: Record<string, unknown>;

        if (fromCurrent === true) {
          const settings = configStore.get();
          const base: Record<string, unknown> = {};

          if (settings.jobDefaults?.jobSpecs !== undefined) {
            base.jobSpecs = settings.jobDefaults.jobSpecs;
          }
          if (settings.jobDefaults?.jobType !== undefined) {
            base.jobType = settings.jobDefaults.jobType;
          }
          if (settings.mounts !== undefined) {
            base.mounts = settings.mounts;
          }
          if (settings.maxRunningJobs !== undefined) {
            base.maxRunningJobs = settings.maxRunningJobs;
          }

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
}
