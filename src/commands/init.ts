import {
  ListCodeSourcesRequest,
  ListResourcesRequest,
  ListWorkspacesRequest,
} from "@alicloud/aiworkspace20210204";
import { GetJobRequest, ListJobsRequest } from "@alicloud/pai-dlc20201203";
import * as p from "@clack/prompts";
import pc from "picocolors";

import { createDLCClient } from "../clients/dlc.js";
import { createSTSClient, getCallerIdentity } from "../clients/sts.js";
import { createWorkspaceClient } from "../clients/workspace.js";
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
    await p.select({
      message: "Region ID",
      initialValue: "cn-hangzhou",
      options: [
        { value: "cn-hangzhou", label: "cn-hangzhou" },
        { value: "cn-shanghai", label: "cn-shanghai" },
        { value: "cn-beijing", label: "cn-beijing" },
        { value: "cn-shenzhen", label: "cn-shenzhen" },
        { value: "cn-chengdu", label: "cn-chengdu" },
        { value: "cn-wulanchabu", label: "cn-wulanchabu" },
        { value: "cn-hongkong", label: "cn-hongkong" },
        { value: "ap-southeast-1", label: "ap-southeast-1" },
        { value: "us-west-1", label: "us-west-1" },
        { value: "eu-central-1", label: "eu-central-1" },
      ],
    }),
  );

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

  const workspaceClient = createWorkspaceClient({ accessKeyId, accessKeySecret }, regionId);

  let workspaceId: string;
  const workspaceSpinner = p.spinner();
  try {
    workspaceSpinner.start("Fetching workspaces...");
    const response = await workspaceClient.listWorkspaces(
      new ListWorkspacesRequest({ status: "ENABLED", verbose: true, pageSize: 100 }),
    );
    const workspaces = response.body?.workspaces ?? [];
    const workspaceOptions = workspaces.flatMap((workspace) => {
      const id = workspace?.workspaceId?.trim();
      if (!id) {
        return [];
      }

      return [
        {
          value: id,
          label: workspace.workspaceName?.trim() || id,
          hint: id,
        },
      ];
    });
    workspaceSpinner.stop(pc.green(`Found ${workspaceOptions.length} workspaces.`));

    if (workspaceOptions.length > 0) {
      const selectedWorkspace = ensureNotCancelled(
        await p.select({
          message: "Select workspace",
          options: workspaceOptions,
        }),
      );

      if (typeof selectedWorkspace === "string" && selectedWorkspace.trim().length > 0) {
        workspaceId = selectedWorkspace;
      } else {
        p.log.warn("Workspace selection was empty. Please enter manually.");
        workspaceId = ensureNotCancelled(
          await p.text({
            message: "Enter Workspace ID",
            validate: requiredInput("Workspace ID"),
          }),
        ).trim();
      }
    } else {
      p.log.warn("No workspaces found. Please enter manually.");
      workspaceId = ensureNotCancelled(
        await p.text({
          message: "Enter Workspace ID",
          validate: requiredInput("Workspace ID"),
        }),
      ).trim();
    }
  } catch (error: unknown) {
    workspaceSpinner.stop(pc.yellow("Failed to fetch workspaces."));
    p.log.warn(
      `Could not fetch workspaces: ${error instanceof Error ? error.message : String(error)}`,
    );
    workspaceId = ensureNotCancelled(
      await p.text({
        message: "Enter Workspace ID manually",
        validate: requiredInput("Workspace ID"),
      }),
    ).trim();
  }

  let resourceId: string;
  const resourceSpinner = p.spinner();
  try {
    resourceSpinner.start("Fetching resources...");
    const response = await workspaceClient.listResources(
      new ListResourcesRequest({
        workspaceId,
        verbose: true,
        pageSize: 100,
        labels: "system.supported.dlc=true",
      }),
    );
    const resources = response.body?.resources ?? [];
    const resourceOptions = resources.flatMap((resource) => {
      const id = resource?.id?.trim();
      if (!id) {
        return [];
      }

      return [
        {
          value: id,
          label: resource.name?.trim() || id,
          hint: `${resource.resourceType ?? ""} ${resource.groupName ?? ""}`.trim(),
        },
      ];
    });
    resourceSpinner.stop(pc.green(`Found ${resourceOptions.length} resources.`));

    if (resourceOptions.length > 0) {
      const selectedResource = ensureNotCancelled(
        await p.select({
          message: "Select resource (DLC cluster)",
          options: resourceOptions,
        }),
      );

      if (typeof selectedResource === "string" && selectedResource.trim().length > 0) {
        resourceId = selectedResource;
      } else {
        p.log.warn("Resource selection was empty. Please enter manually.");
        resourceId = ensureNotCancelled(
          await p.text({
            message: "Enter Resource ID (DLC cluster)",
            validate: requiredInput("Resource ID"),
          }),
        ).trim();
      }
    } else {
      p.log.warn("No DLC-compatible resources found. Please enter manually.");
      resourceId = ensureNotCancelled(
        await p.text({
          message: "Enter Resource ID (DLC cluster)",
          validate: requiredInput("Resource ID"),
        }),
      ).trim();
    }
  } catch (error: unknown) {
    resourceSpinner.stop(pc.yellow("Failed to fetch resources."));
    p.log.warn(
      `Could not fetch resources: ${error instanceof Error ? error.message : String(error)}`,
    );
    resourceId = ensureNotCancelled(
      await p.text({
        message: "Enter Resource ID manually",
        validate: requiredInput("Resource ID"),
      }),
    ).trim();
  }

  const projectPrefix = ensureNotCancelled(
    await p.text({
      message: "Project prefix",
      placeholder: "my-project",
      validate: requiredInput("Project prefix"),
    }),
  ).trim();

  let codeSourceId: string | undefined;
  let codeSourceMountPath = "/root/code";
  let codeSourceDefaultBranch = "main";

  const codeSourceSpinner = p.spinner();
  try {
    codeSourceSpinner.start("Fetching code sources...");
    const response = await workspaceClient.listCodeSources(
      new ListCodeSourcesRequest({ workspaceId, pageSize: 100 }),
    );
    const codeSources = response.body?.codeSources ?? [];
    const codeSourceItems = codeSources.flatMap((codeSource) => {
      const id = codeSource?.codeSourceId?.trim();
      if (!id) {
        return [];
      }

      return [
        {
          id,
          label: codeSource.displayName?.trim() || id,
          hint: codeSource.codeRepo ?? "",
          mountPath: codeSource.mountPath?.trim() || "/root/code",
          codeBranch: codeSource.codeBranch?.trim() || "main",
        },
      ];
    });
    codeSourceSpinner.stop(pc.green(`Found ${codeSourceItems.length} code sources.`));

    const codeSourceSelection = ensureNotCancelled(
      await p.select({
        message: "CodeSource",
        options: [
          { value: "__skip__", label: "Skip (configure later)" },
          ...codeSourceItems.map((codeSource) => ({
            value: codeSource.id,
            label: codeSource.label,
            hint: codeSource.hint,
          })),
        ],
      }),
    );

    if (codeSourceSelection !== "__skip__") {
      const selectedCodeSource =
        typeof codeSourceSelection === "string"
          ? codeSourceItems.find((codeSource) => codeSource.id === codeSourceSelection)
          : undefined;

      if (!selectedCodeSource) {
        p.log.warn("CodeSource selection was empty. Falling back to TODO.");
      } else {
        codeSourceId = selectedCodeSource.id;
        codeSourceMountPath = selectedCodeSource.mountPath;
        codeSourceDefaultBranch = selectedCodeSource.codeBranch;

        p.note(
          `${pc.bold("Mount path:")} ${codeSourceMountPath}\n${pc.bold("Default branch:")} ${codeSourceDefaultBranch}`,
          "CodeSource defaults",
        );

        codeSourceDefaultBranch = ensureNotCancelled(
          await p.text({
            message: "Default branch",
            initialValue: codeSourceDefaultBranch,
            validate: requiredInput("Default branch"),
          }),
        ).trim();
      }
    }
  } catch (error: unknown) {
    codeSourceSpinner.stop(pc.yellow("Failed to fetch code sources."));
    p.log.warn(
      `Could not fetch code sources: ${error instanceof Error ? error.message : String(error)}`,
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

  const showEmptyJobSpecsNote = (): void => {
    p.note(
      "jobDefaults.jobSpecs is initialized as an empty array. Use 'aliyun-pai-mcp dump-job-specs <jobId>' to copy specs into settings.",
      "Job specs",
    );
  };

  let copiedJobSpecs: Record<string, unknown>[] = [];
  const copyFromJob = ensureNotCancelled(
    await p.confirm({
      message: "Copy jobSpecs from an existing DLC job?",
      initialValue: true,
    }),
  );

  if (copyFromJob) {
    const dlcClient = createDLCClient({ accessKeyId, accessKeySecret }, regionId);

    try {
      spinner.start("Fetching recent jobs...");
      const listJobsResponse = await dlcClient.listJobs(
        new ListJobsRequest({
          workspaceId,
          showOwn: true,
          pageSize: 30,
          sortBy: "GmtCreateTime",
          order: "desc",
        }),
      );

      const jobsWithSpecs = (listJobsResponse.body?.jobs ?? []).filter(
        (job) => job.jobId && (job.jobSpecs?.length ?? 0) > 0,
      );
      spinner.stop(pc.green(`Found ${jobsWithSpecs.length} jobs with jobSpecs.`));

      if (jobsWithSpecs.length === 0) {
        p.log.warn("No recent jobs with jobSpecs found.");
        showEmptyJobSpecsNote();
      } else {
        const selectedJobId = ensureNotCancelled(
          await p.select({
            message: "Select a job to copy jobSpecs from",
            options: [
              { value: "__skip__", label: "Skip (leave jobSpecs empty)" },
              ...jobsWithSpecs.map((job) => ({
                value: job.jobId!,
                label: job.displayName ?? job.jobId!,
                hint: `${job.status ?? ""} · ${job.jobType ?? ""} · ${job.gmtCreateTime ?? ""}`,
              })),
            ],
          }),
        );

        if (selectedJobId === "__skip__") {
          showEmptyJobSpecsNote();
        } else {
          spinner.start("Fetching job details...");
          const jobResponse = await dlcClient.getJob(selectedJobId, new GetJobRequest({}));
          spinner.stop(pc.green("Fetched job details."));

          const jobBody = jobResponse.body;
          const selectedJob = jobsWithSpecs.find((job) => job.jobId === selectedJobId);
          const selectedJobName = selectedJob?.displayName ?? selectedJobId;

          const jobSpecs = jobBody?.jobSpecs ?? [];
          copiedJobSpecs = jobSpecs.map((spec) => JSON.parse(JSON.stringify(spec))) as Record<
            string,
            unknown
          >[];

          const firstSpec = copiedJobSpecs[0];
          const firstSpecType = typeof firstSpec?.type === "string" ? firstSpec.type : "-";
          const firstSpecImage = typeof firstSpec?.image === "string" ? firstSpec.image : "-";
          const firstSpecPodCount =
            typeof firstSpec?.podCount === "number" || typeof firstSpec?.podCount === "string"
              ? String(firstSpec.podCount)
              : "-";

          p.note(
            `Copied ${copiedJobSpecs.length} jobSpec(s) from "${selectedJobName}"\nType: ${firstSpecType}, Image: ${firstSpecImage}, podCount: ${firstSpecPodCount}`,
            "Job specs",
          );

          const jobDataSources =
            jobBody?.dataSources?.filter((dataSource) => dataSource.uri && dataSource.mountPath) ??
            [];

          if (jobDataSources.length > 0 && mounts.length === 0) {
            const importDataSourcesAsMounts = ensureNotCancelled(
              await p.confirm({
                message: `Import ${jobDataSources.length} data source(s) as mounts?`,
                initialValue: true,
              }),
            );

            if (importDataSourcesAsMounts) {
              const importedMounts: Mount[] = jobDataSources.map((dataSource, index) => ({
                name: `ds-${index}`,
                uri: dataSource.uri!,
                mountPath: dataSource.mountPath!,
                mountAccess: "ReadWrite" as MountAccess,
              }));

              mounts.push(...importedMounts);

              p.note(
                importedMounts
                  .map((mount) => `${mount.name}: ${mount.uri} -> ${mount.mountPath}`)
                  .join("\n"),
                "Imported mounts",
              );
            }
          }
        }
      }
    } catch (error: unknown) {
      spinner.stop(pc.yellow("Failed to copy job specs from existing jobs."));
      p.log.warn(
        `Could not copy jobSpecs from existing jobs: ${error instanceof Error ? error.message : String(error)}`,
      );
      showEmptyJobSpecsNote();
    }
  } else {
    showEmptyJobSpecsNote();
  }

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
    codeSource: codeSourceId
      ? {
          codeSourceId,
          mountPath: codeSourceMountPath,
          defaultBranch: codeSourceDefaultBranch,
          defaultCommit: null,
        }
      : undefined,
    jobDefaults: {
      jobType,
      displayNamePrefix: projectPrefix,
      jobSpecs: copiedJobSpecs,
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
