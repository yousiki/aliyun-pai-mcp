import { isDeepStrictEqual } from "node:util";

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
const PROTOTYPE_POLLUTION_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_UPDATE_KEYS = 50;
const MAX_PATH_DEPTH = 10;
const MAX_ARRAY_INDEX = 9999;

type PathSegment = string | number;

export interface ConfigDiff {
  changed: Record<string, { from: unknown; to: unknown }>;
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
  );
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (isObjectRecord(sourceVal) && isObjectRecord(targetVal)) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
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

function validatePathNotLocked(path: string): void {
  for (const lockedField of LOCKED_FIELDS) {
    if (path === lockedField || path.startsWith(`${lockedField}.`)) {
      throw new Error(
        `Cannot modify locked field "${lockedField}". ` +
          "This field requires re-initialization via 'init' command.",
      );
    }
  }
}

function parsePathSegments(path: string): PathSegment[] {
  if (path.length === 0) {
    throw new Error("Update path cannot be empty");
  }

  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  if (parts.length > MAX_PATH_DEPTH) {
    throw new Error(`Path '${path}' exceeds maximum depth ${MAX_PATH_DEPTH}`);
  }

  const segments: PathSegment[] = [];
  for (const part of parts) {
    if (part.length === 0) {
      throw new Error(`Invalid update path '${path}': empty segment is not allowed`);
    }

    if (/^\d+$/.test(part)) {
      const index = Number.parseInt(part, 10);
      if (index > MAX_ARRAY_INDEX) {
        throw new Error(`Invalid update path '${path}': array index exceeds ${MAX_ARRAY_INDEX}`);
      }
      segments.push(index);
      continue;
    }

    if (PROTOTYPE_POLLUTION_SEGMENTS.has(part)) {
      throw new Error(`Invalid update path '${path}': forbidden segment '${part}'`);
    }

    segments.push(part);
  }

  return segments;
}

function setByPath(target: Record<string, unknown>, segments: PathSegment[], value: unknown): void {
  let current: unknown = target;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as PathSegment;
    const isLast = i === segments.length - 1;
    const nextSegment = isLast ? undefined : segments[i + 1];

    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        throw new Error("Cannot set array index on non-array path segment");
      }

      if (isLast) {
        current[segment] = value;
        return;
      }

      const existing = current[segment];
      if (existing === undefined || existing === null) {
        current[segment] = typeof nextSegment === "number" ? [] : {};
      } else if (typeof nextSegment === "number") {
        if (!Array.isArray(existing)) {
          throw new Error("Cannot traverse into non-array value with array index");
        }
      } else if (!isObjectRecord(existing)) {
        throw new Error("Cannot traverse into non-object value with object key");
      }

      current = current[segment];
      continue;
    }

    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      throw new Error("Cannot set object key on non-object path segment");
    }

    const container = current as Record<string, unknown>;
    if (isLast) {
      container[segment] = value;
      return;
    }

    const existing = container[segment];
    if (existing === undefined || existing === null) {
      container[segment] = typeof nextSegment === "number" ? [] : {};
    } else if (typeof nextSegment === "number") {
      if (!Array.isArray(existing)) {
        throw new Error("Cannot traverse into non-array value with array index");
      }
    } else if (!isObjectRecord(existing)) {
      throw new Error("Cannot traverse into non-object value with object key");
    }

    current = container[segment];
  }
}

function segmentsToPath(segments: PathSegment[]): string {
  return segments.map((segment) => String(segment)).join(".");
}

function computeDiff(
  oldSettings: Settings,
  newSettings: Settings,
  changePaths: string[],
): ConfigDiff {
  const diff: ConfigDiff = { changed: {} };

  for (const changePath of changePaths) {
    const oldValue = getNestedValue(oldSettings as unknown as Record<string, unknown>, changePath);
    const newValue = getNestedValue(newSettings as unknown as Record<string, unknown>, changePath);
    if (!isDeepStrictEqual(oldValue, newValue)) {
      diff.changed[changePath] = { from: oldValue, to: newValue };
    }
  }

  return diff;
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
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(settings: Settings) {
    this.settings = deepClone(settings);
  }

  get(): Settings {
    return deepClone(this.settings);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.updateQueue.then(fn, fn);
    this.updateQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async update(changes: Partial<Settings>): Promise<ConfigDiff> {
    return this.enqueue(async () => {
      const changePaths = collectPaths(changes as Record<string, unknown>);

      for (const changePath of changePaths) {
        validatePathNotLocked(changePath);
      }

      const oldSettings = deepClone(this.settings);
      const merged = deepMerge(
        deepClone(this.settings) as unknown as Record<string, unknown>,
        changes as Record<string, unknown>,
      ) as Settings;
      const validated = SettingsSchema.parse(merged);
      const diff = computeDiff(oldSettings, validated, changePaths);

      await writeSettings(validated);
      this.settings = validated;

      return diff;
    });
  }

  async updateByDotPaths(updates: Record<string, unknown>): Promise<ConfigDiff> {
    return this.enqueue(async () => {
      const entries = Object.entries(updates);
      if (entries.length > MAX_UPDATE_KEYS) {
        throw new Error(`Too many update paths: maximum ${MAX_UPDATE_KEYS} allowed`);
      }

      const oldSettings = deepClone(this.settings);
      const merged = deepClone(this.settings) as unknown as Record<string, unknown>;
      const changePaths: string[] = [];

      for (const [path, value] of entries) {
        const segments = parsePathSegments(path);
        const canonicalPath = segmentsToPath(segments);
        validatePathNotLocked(canonicalPath);
        setByPath(merged, segments, value);
        changePaths.push(canonicalPath);
      }

      const validated = SettingsSchema.parse(merged);
      const diff = computeDiff(oldSettings, validated, changePaths);

      await writeSettings(validated);
      this.settings = validated;

      return diff;
    });
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
      changes.jobSpecs = profile.jobSpecs;
    }

    if (profile.jobType !== undefined) {
      changes.jobType = profile.jobType;
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
