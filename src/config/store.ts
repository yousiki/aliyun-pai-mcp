import type { Profile, Settings } from "./schema.js";
import { ProfileSchema, SettingsSchema } from "./schema.js";
import { writeSettings } from "./writer.js";

// Security: these fields require re-initialization via 'init' and cannot be hot-updated
const LOCKED_FIELDS: ReadonlyArray<string> = [
  "credentials",
  "regionId",
  "workspaceId",
  "resourceId",
  "projectPrefix",
  "codeSource.codeSourceId",
  "caller",
  "version",
];

const PROFILE_NAME_REGEX = /^[a-z0-9-]+$/;
const RESERVED_PROFILE_NAMES: ReadonlyArray<string> = ["default", "current"];

export interface ConfigDiff {
  changed: Record<string, { from: unknown; to: unknown }>;
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function collectPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    paths.push(fullPath);
    const value = obj[key];
    if (
      value !== null &&
      value !== undefined &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      paths.push(...collectPaths(value as Record<string, unknown>, fullPath));
    }
  }
  return paths;
}

function validateProfileName(name: string): void {
  if (!PROFILE_NAME_REGEX.test(name)) {
    throw new Error(
      `Invalid profile name "${name}": must match ${PROFILE_NAME_REGEX} (lowercase alphanumeric and hyphens only)`,
    );
  }
  if (RESERVED_PROFILE_NAMES.includes(name)) {
    throw new Error(`Profile name "${name}" is reserved and cannot be used`);
  }
}

export class ConfigStore {
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = deepClone(settings);
  }

  get(): Settings {
    return deepClone(this.settings);
  }

  async update(changes: Partial<Settings>): Promise<ConfigDiff> {
    const changePaths = collectPaths(changes as Record<string, unknown>);

    for (const lockedField of LOCKED_FIELDS) {
      for (const changePath of changePaths) {
        if (changePath === lockedField || changePath.startsWith(`${lockedField}.`)) {
          throw new Error(
            `Cannot modify locked field "${lockedField}". ` +
              "This field requires re-initialization via 'init' command.",
          );
        }
      }
    }

    const oldSettings = deepClone(this.settings);
    const merged = { ...deepClone(this.settings), ...changes };
    const validated = SettingsSchema.parse(merged);

    const diff: ConfigDiff = { changed: {} };
    for (const changePath of changePaths) {
      const oldValue = getNestedValue(
        oldSettings as unknown as Record<string, unknown>,
        changePath,
      );
      const newValue = getNestedValue(validated as unknown as Record<string, unknown>, changePath);
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        diff.changed[changePath] = { from: oldValue, to: newValue };
      }
    }

    await writeSettings(validated);
    this.settings = validated;

    return diff;
  }

  getProfiles(): Record<string, Profile> {
    return deepClone(this.settings.profiles ?? {});
  }

  async setProfile(name: string, overrides: Profile): Promise<void> {
    validateProfileName(name);
    const validated = ProfileSchema.parse(overrides);
    const profiles = { ...(this.settings.profiles ?? {}), [name]: validated };
    await this.update({ profiles });
  }

  async applyProfile(name: string): Promise<ConfigDiff> {
    validateProfileName(name);

    const profiles = this.settings.profiles ?? {};
    const profile = profiles[name];
    if (!profile) {
      throw new Error(`Profile "${name}" does not exist`);
    }

    const changes: Partial<Settings> = {};

    if (profile.jobSpecs !== undefined) {
      changes.jobDefaults = {
        ...deepClone(this.settings.jobDefaults),
        jobSpecs: profile.jobSpecs,
      };
    }

    if (profile.jobType !== undefined) {
      changes.jobDefaults = {
        ...(changes.jobDefaults ?? deepClone(this.settings.jobDefaults)),
        jobType: profile.jobType,
      };
    }

    if (profile.mounts !== undefined) {
      changes.mounts = profile.mounts;
    }

    if (profile.maxRunningJobs !== undefined) {
      changes.maxRunningJobs = profile.maxRunningJobs;
    }

    return this.update(changes);
  }

  async deleteProfile(name: string): Promise<void> {
    validateProfileName(name);

    const profiles = { ...(this.settings.profiles ?? {}) };
    if (!(name in profiles)) {
      throw new Error(`Profile "${name}" does not exist`);
    }

    delete profiles[name];

    const updatedProfiles = Object.keys(profiles).length > 0 ? profiles : undefined;
    await this.update({ profiles: updatedProfiles });
  }
}
