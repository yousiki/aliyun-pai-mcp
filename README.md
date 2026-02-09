# aliyun-pai-mcp

MCP server for Aliyun PAI-DLC. Lets coding agents (Claude Code, etc.) submit, monitor, and manage distributed training jobs on PAI-DLC.

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- Aliyun credentials (AccessKey ID + Secret)

## Installation

```bash
git clone https://github.com/yousiki/aliyun-pai-mcp.git
cd aliyun-pai-mcp
bun install
```

## Quick Start

### 1. Initialize settings

```bash
bun run src/index.ts init
```

The interactive wizard walks you through:

- **Region** — select from available PAI regions
- **Credentials** — enter AccessKey or use environment variables (`ALIBABA_CLOUD_ACCESS_KEY_ID`, `ALIBABA_CLOUD_ACCESS_KEY_SECRET`)
- **Workspace** — fetched from API, select from list
- **Resource (DLC cluster)** — fetched from API, filtered to DLC-compatible resources
- **Project prefix** — short name (e.g. `yousiki`) used to namespace your jobs
- **Code source** — optional, fetched from API
- **Job type** — PyTorchJob, TFJob, MPIJob, XGBoostJob, or RayJob
- **Copy jobSpecs from past job** — select a recent job to copy its resource configuration (image, GPU, memory, etc.) and optionally import its data source mounts

Settings are saved to `~/.config/aliyun-pai/settings.json` (chmod 600). Override path with `ALIYUN_PAI_SETTINGS_PATH`.

### 2. Verify setup

```bash
bun run src/index.ts doctor
```

Checks credential validity (STS) and lists recent jobs with your prefix.

### 3. Add to Claude Code

```bash
claude mcp add aliyun-pai -- bun run /path/to/aliyun-pai-mcp/src/index.ts server
```

## CLI Commands

| Command                  | Description                                               |
| ------------------------ | --------------------------------------------------------- |
| `init`                   | Interactive setup wizard                                  |
| `server`                 | Start MCP server (stdio transport)                        |
| `doctor`                 | Verify credentials and connectivity                       |
| `dump-job-specs <jobId>` | Extract jobSpecs from an existing job for use in settings |

## MCP Tools

Once the server is running, agents have access to these tools:

### Configuration

| Tool         | Description                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `pai_whoami` | Show current caller identity and workspace context                                                                           |
| `pai_config` | Show full MCP settings (sanitized). Includes job defaults (image, GPU/CPU/memory, pod count), mounts, and code source config |

### Code Source

| Tool                    | Description                             |
| ----------------------- | --------------------------------------- |
| `pai_codesource_get`    | Show configured code source settings    |
| `pai_codesource_update` | Update code source branch and/or commit |

### Jobs

| Tool             | Description                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `pai_job_list`   | List recent jobs for current project prefix                                                                     |
| `pai_job_get`    | Get full details for a specific job (owner check only)                                                          |
| `pai_job_submit` | Submit a new DLC job. Only `name` and `command` are specified — image, resources, mounts are driven by settings |
| `pai_job_stop`   | Stop a running job (requires prefix + owner match)                                                              |
| `pai_job_logs`   | Get pod logs for a job (owner check only)                                                                       |
| `pai_job_wait`   | Poll until a job reaches Running or Terminal status                                                             |

### How job submission works

When an agent calls `pai_job_submit`, it only provides:

- **`name`** — a short task name (e.g. `train`, `eval`). The prefix is added automatically: `{prefix}-{name}-{timestamp}`
- **`command`** — the shell command to run
- **`codeCommit`** (optional) — git commit to checkout

Everything else comes from settings:

- Docker image, GPU/CPU/memory, pod count (from `jobDefaults.jobSpecs`)
- Data source mounts (from `mounts`)
- Code source (from `codeSource`, if configured)
- Workspace, resource quota, job type

Use `pai_config` to inspect the current configuration before submitting.

## Typical Agent Workflow

```
1. Agent writes code locally → git commit && git push
2. pai_codesource_update(commit=<HEAD>)        # point code source to latest commit
3. pai_job_submit(name="train", command="...")  # submit training job
4. pai_job_wait(jobId, target="Running")        # wait for job to start
5. pai_job_logs(jobId)                          # check logs
6. If error → fix code, repeat from step 1
7. pai_job_wait(jobId, target="Terminal")        # wait for completion
```

## Settings Reference

Settings file: `~/.config/aliyun-pai/settings.json`

```jsonc
{
  "version": "0.3.0",
  "projectPrefix": "yousiki",
  "regionId": "ap-southeast-1",
  "workspaceId": "123456",
  "resourceId": "quota-xxxx",

  "credentials": {
    "accessKeyId": "LTAI...",
    "accessKeySecret": "...",
  },

  // Optional — auto-detected during init
  "caller": {
    "accountId": "...",
    "userId": "...",
    "identityType": "RAMUser",
  },

  // Optional — skip during init if not using code source
  "codeSource": {
    "codeSourceId": "code-xxxx",
    "mountPath": "/root/code",
    "defaultBranch": "main",
    "defaultCommit": null,
  },

  "jobDefaults": {
    "jobType": "PyTorchJob",
    "displayNamePrefix": "yousiki",
    // Copied from a past job during init, or via dump-job-specs
    "jobSpecs": [
      {
        "type": "Worker",
        "image": "your-image:tag",
        "podCount": 1,
        "resourceConfig": {
          "CPU": "8",
          "GPU": "1",
          "memory": "32Gi",
          "sharedMemory": "32Gi",
        },
      },
    ],
  },

  "mounts": [
    {
      "name": "data",
      "uri": "oss://bucket/path/",
      "mountPath": "/mnt/data",
      "mountAccess": "ReadOnly",
    },
  ],
}
```
