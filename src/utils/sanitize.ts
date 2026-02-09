import type { Settings } from "../config/schema.js";

export const REDACTED = "***REDACTED***";

export const SENSITIVE_KEYS = ["accessKeySecret", "securityToken"] as const;

export const PARTIAL_REDACT_KEYS = ["accessKeyId"] as const;

function partiallyRedact(value: string): string {
  if (value.length <= 8) {
    return REDACTED;
  }

  const start = value.slice(0, 4);
  const end = value.slice(-4);
  return `${start}${"*".repeat(value.length - 8)}${end}`;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(input)) {
      if (SENSITIVE_KEYS.includes(key as (typeof SENSITIVE_KEYS)[number])) {
        output[key] = REDACTED;
        continue;
      }

      if (PARTIAL_REDACT_KEYS.includes(key as (typeof PARTIAL_REDACT_KEYS)[number])) {
        if (typeof nestedValue === "string") {
          output[key] = partiallyRedact(nestedValue);
        } else {
          output[key] = REDACTED;
        }
        continue;
      }

      output[key] = sanitizeValue(nestedValue);
    }

    return output;
  }

  return value;
}

export function sanitizeObject<T>(obj: T): T {
  return sanitizeValue(obj) as T;
}

export interface SanitizedSettings {
  version: Settings["version"];
  projectPrefix: Settings["projectPrefix"];
  regionId: Settings["regionId"];
  workspaceId: Settings["workspaceId"];
  resourceId: Settings["resourceId"];
  mounts: Settings["mounts"];
  codeSource: {
    codeSourceId: Settings["codeSource"]["codeSourceId"];
    mountPath: Settings["codeSource"]["mountPath"];
    defaultBranch: Settings["codeSource"]["defaultBranch"];
    defaultCommit: Settings["codeSource"]["defaultCommit"];
  };
  jobDefaults: {
    jobType: Settings["jobDefaults"]["jobType"];
    displayNamePrefix: Settings["jobDefaults"]["displayNamePrefix"];
  };
}

export function sanitizeSettings(settings: Settings): SanitizedSettings {
  return {
    version: settings.version,
    projectPrefix: settings.projectPrefix,
    regionId: settings.regionId,
    workspaceId: settings.workspaceId,
    resourceId: settings.resourceId,
    mounts: sanitizeObject(settings.mounts),
    codeSource: {
      codeSourceId: settings.codeSource.codeSourceId,
      mountPath: settings.codeSource.mountPath,
      defaultBranch: settings.codeSource.defaultBranch,
      defaultCommit: settings.codeSource.defaultCommit,
    },
    jobDefaults: {
      jobType: settings.jobDefaults.jobType,
      displayNamePrefix: settings.jobDefaults.displayNamePrefix,
    },
  };
}
