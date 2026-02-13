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
