import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZodError } from "zod";
import type { Settings } from "./schema.js";
import { SettingsSchema } from "./schema.js";

const CURRENT_VERSION = "0.5.0";

export function getSettingsPath(): string {
  const envPath = process.env.ALIYUN_PAI_SETTINGS_PATH;
  if (envPath && envPath.trim().length > 0) {
    return envPath;
  }

  return path.join(os.homedir(), ".config", "aliyun-pai", "settings.json");
}

function isLegacyFormat(parsed: unknown): boolean {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const obj = parsed as Record<string, unknown>;
  return "jobSpecs" in obj || "jobType" in obj || "maxRunningJobs" in obj;
}

export async function loadSettings(): Promise<Settings> {
  const settingsPath = getSettingsPath();

  let raw: string;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read settings file at ${settingsPath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON in settings file at ${settingsPath}: ${message}`);
  }

  if (isLegacyFormat(parsed)) {
    throw new Error(
      `Settings file at ${settingsPath} uses an outdated format (pre-${CURRENT_VERSION}). ` +
        "Please re-initialize: bunx aliyun-pai-mcp init",
    );
  }

  try {
    return SettingsSchema.parse(parsed);
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const issues = error.issues
        .map((issue) => {
          const issuePath = issue.path.length > 0 ? issue.path.join(".") : "<root>";
          return `${issuePath}: ${issue.message}`;
        })
        .join("; ");

      throw new Error(`Invalid settings in ${settingsPath}: ${issues}`);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to validate settings at ${settingsPath}: ${message}`);
  }
}
