import { GetJobRequest } from "@alicloud/pai-dlc20201203";
import pc from "picocolors";

import { createDLCClient } from "../clients/dlc.js";
import { loadSettings } from "../config/loader.js";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default async function dumpJobSpecsCommand(jobId: string): Promise<void> {
  try {
    const settings = await loadSettings();
    const dlcClient = createDLCClient(settings.credentials, settings.regionId);

    const response = await dlcClient.getJob(jobId, new GetJobRequest({}));
    const body = response.body;

    if (!body) {
      console.log(`${pc.red("x")} No job details returned for jobId: ${jobId}`);
      process.exitCode = 1;
      return;
    }

    const extracted = {
      jobType: body.jobType,
      jobSpecs: body.jobSpecs,
      codeSource: body.codeSource,
      dataSources: body.dataSources,
      resourceId: body.resourceId,
      workspaceId: body.workspaceId,
    };

    console.log(pc.bold(pc.cyan("Job details (selected fields)")));
    console.log(JSON.stringify(extracted, null, 2));
    console.log("");
    console.log(pc.bold(pc.cyan("Paste-ready jobDefaults.jobSpecs")));
    console.log(JSON.stringify(body.jobSpecs ?? [], null, 2));
  } catch (error: unknown) {
    console.log(`${pc.red("x")} ${pc.bold("Failed to dump job specs")}`);
    console.log(`  ${formatError(error)}`);
    process.exitCode = 1;
  }
}
