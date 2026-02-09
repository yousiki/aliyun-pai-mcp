import * as p from "@clack/prompts";
import pc from "picocolors";

import { createSTSClient, getCallerIdentity } from "../clients/sts.js";
import type { Mount, MountAccess, Settings } from "../config/schema.js";
import { writeSettings } from "../config/writer.js";

const SETTINGS_VERSION = "0.3.0";

function ensureNotCancelled<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  return value;
}

function requiredInput(label: string): (value: string) => string | undefined {
  return (value: string) => {
    if (value.trim().length === 0) {
      return `${label} is required.`;
    }

    return undefined;
  };
}

export default async function initCommand(): Promise<void> {
  p.intro("aliyun-pai-mcp init");

  const regionId = ensureNotCancelled(
    await p.text({
      message: "Region ID",
      placeholder: "cn-hangzhou",
      initialValue: "cn-hangzhou",
      validate: requiredInput("Region ID"),
    }),
  ).trim();

  const workspaceId = ensureNotCancelled(
    await p.text({
      message: "Workspace ID",
      validate: requiredInput("Workspace ID"),
    }),
  ).trim();

  const resourceId = ensureNotCancelled(
    await p.text({
      message: "Resource ID (DLC cluster)",
      validate: requiredInput("Resource ID"),
    }),
  ).trim();

  const projectPrefix = ensureNotCancelled(
    await p.text({
      message: "Project prefix",
      placeholder: "my-project",
      validate: requiredInput("Project prefix"),
    }),
  ).trim();

  const credentialMode = ensureNotCancelled(
    await p.select({
      message: "Credentials",
      options: [
        { value: "input", label: "Enter AccessKey" },
        { value: "env", label: "Use environment variables" },
      ],
    }),
  );

  let accessKeyId: string;
  let accessKeySecret: string;

  if (credentialMode === "input") {
    accessKeyId = ensureNotCancelled(
      await p.text({
        message: "AccessKey ID",
        validate: requiredInput("AccessKey ID"),
      }),
    ).trim();

    accessKeySecret = ensureNotCancelled(
      await p.text({
        message: "AccessKey Secret",
        validate: requiredInput("AccessKey Secret"),
      }),
    ).trim();
  } else {
    const envKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
    const envKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;

    if (!envKeyId || !envKeySecret) {
      p.cancel(
        "Missing ALIBABA_CLOUD_ACCESS_KEY_ID or ALIBABA_CLOUD_ACCESS_KEY_SECRET in environment.",
      );
      process.exit(1);
    }

    accessKeyId = envKeyId;
    accessKeySecret = envKeySecret;
  }

  const spinner = p.spinner();
  spinner.start("Verifying credentials with STS...");

  let caller:
    | {
        accountId: string;
        userId: string;
        identityType: string;
      }
    | undefined;

  try {
    const stsClient = createSTSClient({ accessKeyId, accessKeySecret }, regionId);
    const identity = await getCallerIdentity(stsClient);
    caller = {
      accountId: identity.accountId,
      userId: identity.userId,
      identityType: identity.identityType,
    };
    spinner.stop(pc.green("Credentials verified."));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.stop(pc.red("Credential verification failed."));
    p.cancel(`Unable to verify credentials: ${message}`);
    process.exit(1);
  }

  p.note(
    `${pc.bold("Account:")} ${caller.accountId}\n${pc.bold("User:")} ${caller.userId}\n${pc.bold("Type:")} ${caller.identityType}`,
    "Caller identity",
  );

  const codeSourceMode = ensureNotCancelled(
    await p.select({
      message: "CodeSource",
      options: [
        { value: "existing", label: "Use existing CodeSource ID" },
        { value: "skip", label: "Skip (configure later)" },
      ],
    }),
  );

  let codeSourceId = "TODO";
  let codeSourceMountPath = "/root/code";
  let codeSourceDefaultBranch = "main";

  if (codeSourceMode === "existing") {
    codeSourceId = ensureNotCancelled(
      await p.text({
        message: "CodeSource ID",
        validate: requiredInput("CodeSource ID"),
      }),
    ).trim();

    codeSourceMountPath = ensureNotCancelled(
      await p.text({
        message: "Code mount path",
        initialValue: "/root/code",
        validate: requiredInput("Code mount path"),
      }),
    ).trim();

    codeSourceDefaultBranch = ensureNotCancelled(
      await p.text({
        message: "Default branch",
        initialValue: "main",
        validate: requiredInput("Default branch"),
      }),
    ).trim();
  }

  const mounts: Mount[] = [];
  while (true) {
    const addMount = ensureNotCancelled(
      await p.confirm({
        message: "Add a mount?",
        initialValue: false,
      }),
    );

    if (!addMount) {
      break;
    }

    const name = ensureNotCancelled(
      await p.text({
        message: "Mount name",
        validate: requiredInput("Mount name"),
      }),
    ).trim();

    const uri = ensureNotCancelled(
      await p.text({
        message: "Mount URI",
        validate: requiredInput("Mount URI"),
      }),
    ).trim();

    const mountPath = ensureNotCancelled(
      await p.text({
        message: "Mount path",
        validate: requiredInput("Mount path"),
      }),
    ).trim();

    const mountAccess = ensureNotCancelled(
      await p.select({
        message: "Mount access",
        options: [
          { value: "ReadOnly", label: "ReadOnly" },
          { value: "ReadWrite", label: "ReadWrite" },
        ],
      }),
    ) as MountAccess;

    const descriptionInput = ensureNotCancelled(
      await p.text({
        message: "Description (optional)",
      }),
    ).trim();

    mounts.push({
      name,
      uri,
      mountPath,
      mountAccess,
      description: descriptionInput.length > 0 ? descriptionInput : undefined,
    });
  }

  const jobType = ensureNotCancelled(
    await p.select({
      message: "Default job type",
      options: [
        { value: "PyTorchJob", label: "PyTorchJob" },
        { value: "TFJob", label: "TFJob" },
        { value: "MPIJob", label: "MPIJob" },
        { value: "XGBoostJob", label: "XGBoostJob" },
        { value: "RayJob", label: "RayJob" },
      ],
    }),
  );

  p.note(
    "jobDefaults.jobSpecs is initialized as an empty array. Use 'aliyun-pai-mcp dump-job-specs <jobId>' to copy specs into settings.",
    "Job specs",
  );

  const settings: Settings = {
    version: SETTINGS_VERSION,
    projectPrefix,
    regionId,
    workspaceId,
    resourceId,
    credentials: {
      accessKeyId,
      accessKeySecret,
    },
    caller,
    codeSource: {
      codeSourceId,
      mountPath: codeSourceMountPath,
      defaultBranch: codeSourceDefaultBranch,
      defaultCommit: null,
    },
    jobDefaults: {
      jobType,
      displayNamePrefix: projectPrefix,
      jobSpecs: [],
    },
    mounts,
  };

  try {
    await writeSettings(settings);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    p.cancel(`Failed to write settings: ${message}`);
    process.exit(1);
  }

  p.outro("Settings saved! Run 'aliyun-pai-mcp doctor' to verify.");
}
