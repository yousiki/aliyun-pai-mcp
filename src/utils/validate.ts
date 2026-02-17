export function validateJobOwnership(
  job: { displayName?: string; userId?: string },
  projectPrefix: string,
  currentUserId?: string,
): { valid: boolean; reason?: string } {
  const expectedPrefix = `${projectPrefix}-`;

  if (!job.displayName || !job.displayName.startsWith(expectedPrefix)) {
    return {
      valid: false,
      reason: `Job displayName must start with '${expectedPrefix}'.`,
    };
  }

  if (currentUserId && job.userId && job.userId !== currentUserId) {
    return {
      valid: false,
      reason: `Job userId '${job.userId}' does not match current user '${currentUserId}'.`,
    };
  }

  return { valid: true };
}

export function generateDisplayName(projectPrefix: string, nameSuffix: string): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;

  return `${projectPrefix}-${nameSuffix}-${timestamp}`;
}

export const TERMINAL_STATUSES = ["Succeeded", "Failed", "Stopped"] as const;

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as (typeof TERMINAL_STATUSES)[number]);
}

/** Any non-empty, non-terminal status occupies a concurrency slot. */
export function isActiveStatus(status: string): boolean {
  return status !== "" && !isTerminalStatus(status);
}

export interface ResourceUsage {
  gpu: number;
  cpu: number;
}

/**
 * Extract total GPU and CPU usage from an array of jobSpecs.
 * Handles podCount (multiplied per spec type) and string-typed resource values.
 * Returns { gpu: 0, cpu: 0 } for empty or malformed specs.
 */
export function extractResources(jobSpecs: ReadonlyArray<Record<string, unknown>>): ResourceUsage {
  let gpu = 0;
  let cpu = 0;

  for (const spec of jobSpecs) {
    const podCount = typeof spec.podCount === "number" ? spec.podCount : 1;
    const resourceConfig = spec.resourceConfig;

    if (
      resourceConfig !== null &&
      resourceConfig !== undefined &&
      typeof resourceConfig === "object" &&
      !Array.isArray(resourceConfig)
    ) {
      const rc = resourceConfig as Record<string, unknown>;
      const specGPU = Number.parseInt(String(rc.GPU ?? "0"), 10) || 0;
      const specCPU = Number.parseInt(String(rc.CPU ?? "0"), 10) || 0;
      gpu += specGPU * podCount;
      cpu += specCPU * podCount;
    }
  }

  return { gpu, cpu };
}

/**
 * Format resource usage into a human-readable summary string.
 * Example: "Worker×2: CPU=64, GPU=8, Memory=512Gi"
 */
export function formatJobSpecsSummary(jobSpecs: ReadonlyArray<Record<string, unknown>>): string {
  return jobSpecs
    .map((spec) => {
      const specType = typeof spec.type === "string" ? spec.type : "Worker";
      const podCount = typeof spec.podCount === "number" ? spec.podCount : 1;
      const rc =
        spec.resourceConfig !== null &&
        spec.resourceConfig !== undefined &&
        typeof spec.resourceConfig === "object" &&
        !Array.isArray(spec.resourceConfig)
          ? (spec.resourceConfig as Record<string, unknown>)
          : {};

      const parts = [`${specType}×${podCount}`];
      if (rc.CPU !== undefined) parts.push(`CPU=${rc.CPU}`);
      if (rc.GPU !== undefined) parts.push(`GPU=${rc.GPU}`);
      if (rc.memory !== undefined) parts.push(`Memory=${rc.memory}`);

      return parts.join(", ");
    })
    .join("; ");
}
