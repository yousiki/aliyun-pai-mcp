import { ListJobsRequest } from "@alicloud/pai-dlc20201203";
import pc from "picocolors";

import { createDLCClient } from "../clients/dlc.js";
import { createSTSClient, getCallerIdentity } from "../clients/sts.js";
import { getSettingsPath, loadSettings } from "../config/loader.js";
import { sanitizeObject, sanitizeSettings } from "../utils/sanitize.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatJobRow(job: {
  displayName?: string;
  status?: string;
  jobId?: string;
  gmtCreateTime?: string;
}): string {
  const displayName = (job.displayName ?? "-").slice(0, 42);
  const status = job.status ?? "-";
  const jobId = job.jobId ?? "-";
  const gmtCreateTime = job.gmtCreateTime ?? "-";
  return `  ${displayName.padEnd(44)} ${status.padEnd(10)} ${jobId.padEnd(20)} ${gmtCreateTime}`;
}

export default async function doctorCommand(): Promise<void> {
  const settingsPath = getSettingsPath();
  let successCount = 0;
  let failureCount = 0;

  const settingsResult = await loadSettings()
    .then((settings) => ({ ok: true as const, settings }))
    .catch((error: unknown) => ({ ok: false as const, error }));

  if (!settingsResult.ok) {
    console.log(`${pc.red("x")} ${pc.bold("Failed to load settings")}`);
    console.log(`  ${formatError(settingsResult.error)}`);
    console.log(" ");
    console.log(`${pc.red("Doctor checks failed")}: ${pc.yellow("1 failed")}`);
    process.exitCode = 1;
    return;
  }

  const settings = settingsResult.settings;
  const sanitized = sanitizeSettings(settings);
  const sanitizedCredentials = sanitizeObject({ accessKeyId: settings.credentials.accessKeyId });

  console.log(`${pc.green("✓")} ${pc.bold(`Settings loaded from ${settingsPath}`)}`);
  console.log(`  Region:    ${sanitized.regionId}`);
  console.log(`  Workspace: ${sanitized.workspaceId}`);
  console.log(`  Resource:  ${sanitized.resourceId}`);
  console.log(`  Prefix:    ${sanitized.projectPrefix}`);
  console.log(`  Key:       ${sanitizedCredentials.accessKeyId}`);
  console.log(
    `  STS Token: ${settings.credentials.securityToken ? pc.green("set") : pc.yellow("not set")}`,
  );
  successCount += 1;

  const stsClient = createSTSClient(settings.credentials, settings.regionId);
  const identityResult = await getCallerIdentity(stsClient)
    .then((identity) => ({ ok: true as const, identity }))
    .catch((error: unknown) => ({ ok: false as const, error }));

  console.log(" ");
  if (!identityResult.ok) {
    console.log(`${pc.red("x")} ${pc.bold("Caller identity verification failed")}`);
    console.log(`  ${formatError(identityResult.error)}`);
    failureCount += 1;
  } else {
    console.log(`${pc.green("✓")} ${pc.bold("Caller identity verified")}`);
    console.log(`  Account: ${identityResult.identity.accountId}`);
    console.log(`  User:    ${identityResult.identity.userId}`);
    console.log(`  Type:    ${identityResult.identity.identityType}`);
    successCount += 1;
  }

  const dlcClient = createDLCClient(settings.credentials, settings.regionId);
  const jobsResult = await dlcClient
    .listJobs(
      new ListJobsRequest({
        showOwn: true,
        displayName: settings.projectPrefix,
        pageSize: 5,
        workspaceId: settings.workspaceId,
      }),
    )
    .then((response) => ({ ok: true as const, response }))
    .catch((error: unknown) => ({ ok: false as const, error }));

  console.log(" ");
  if (!jobsResult.ok) {
    console.log(`${pc.red("x")} ${pc.bold("Failed to list DLC jobs")}`);
    console.log(`  ${formatError(jobsResult.error)}`);
    failureCount += 1;
  } else {
    const jobs = jobsResult.response.body?.jobs ?? [];
    console.log(
      `${pc.green("✓")} ${pc.bold(`Found ${jobs.length} jobs with prefix "${settings.projectPrefix}"`)}`,
    );

    for (const job of jobs.slice(0, 5)) {
      console.log(
        formatJobRow({
          displayName: job.displayName,
          status: job.status,
          jobId: job.jobId,
          gmtCreateTime: job.gmtCreateTime,
        }),
      );
    }

    successCount += 1;
  }

  console.log(" ");
  if (failureCount > 0) {
    console.log(
      `${pc.red("Doctor checks failed")}: ${pc.green(`${successCount} passed`)}, ${pc.red(`${failureCount} failed`)}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`${pc.green("Doctor checks passed")}: ${pc.green(`${successCount} passed`)}`);
}
