# aliyun-pai-mcp

MCP server for Aliyun PAI-DLC. Lets coding agents (Claude Code, etc.) submit, monitor, and manage distributed training jobs on PAI-DLC.

## Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- Aliyun credentials (AccessKey ID + Secret)

## Installation

### Via bunx (recommended)

No installation needed — runs directly from npm:

```bash
bunx aliyun-pai-mcp init
```

### Via global install

```bash
bun install -g aliyun-pai-mcp
aliyun-pai-mcp init
```

### From source (development)

```bash
git clone https://github.com/yousiki/aliyun-pai-mcp.git
cd aliyun-pai-mcp
bun install
bun run src/index.ts init
```

## Quick Start

### 1. Initialize settings

```bash
bunx aliyun-pai-mcp init
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
bunx aliyun-pai-mcp doctor
```

Checks credential validity (STS) and lists recent jobs with your prefix.

### 3. Add to Claude Code

```bash
claude mcp add aliyun-pai -- bunx aliyun-pai-mcp server
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

| Tool                         | Description                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pai_whoami`                 | Show current caller identity and workspace context                                                                           |
| `pai_config`                 | Show full MCP settings (sanitized). Includes profiles, global limits, mounts, and code source config                        |
| `pai_config_schema`          | Inspect configuration schema with field descriptions and types                                                               |
| `pai_config_update`          | Update modifiable configuration fields at runtime. Use `profile` parameter to target specific profiles                      |
| `pai_config_list_profiles`   | List all saved configuration profiles                                                                                        |
| `pai_config_delete_profile`  | Delete a named configuration profile                                                                                         |
| `pai_config_create_profile`  | Create or update a named configuration profile                                                                               |
| `pai_help`                   | Show comprehensive usage guide                                                                                               |

### Jobs

| Tool             | Description                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pai_job_list`   | List recent jobs for current project prefix                                                                                                                |
| `pai_job_get`    | Get full details for a specific job (owner check only)                                                                                                     |
| `pai_job_submit` | Submit a new DLC job. Specify `name`, `command`, and optional `profile` (defaults to "default"). Image, resources, mounts are driven by profile settings |
| `pai_job_stop`   | Stop a running job (requires prefix + owner match)                                                                                                         |
| `pai_job_logs`   | Get pod logs for a job (owner check only)                                                                                                                  |
| `pai_job_wait`   | Poll until a job reaches Running or Terminal status                                                                                                        |

### How job submission works

When an agent calls `pai_job_submit`, it only provides:

- **`name`** — a short task name (e.g. `train`, `eval`). The prefix is added automatically: `{prefix}-{name}-{timestamp}`
- **`command`** — the shell command to run
- **`profile`** (optional) — defaults to "default", selects which profile's jobSpecs/jobType to use
- **`codeCommit`** (optional, deprecated) — git commit to checkout

Everything else comes from settings:

- Docker image, GPU/CPU/memory, pod count, job type (from the selected PROFILE's `jobSpecs` and `jobType`)
- Data source mounts (from global `mounts`)
- Code source (from `codeSource`, if configured)
- Workspace, resource quota

Use `pai_config_schema` to see available profiles and limits, and `pai_job_submit(profile='gpu-4')` to select resources.

## Typical Agent Workflow

```
1. Agent writes code locally → git commit && git push
2. pai_config_list_profiles                        # see available resource profiles
3. pai_job_submit(name="train", command="...", profile="gpu-4")  # submit with profile
4. pai_job_wait(jobId, target="Running")            # wait for job to start
5. pai_job_logs(jobId)                              # verify branch/commit in early output
6. If error → fix code, push, resubmit. Iterate until success.
```

## Settings Reference

Settings file: `~/.config/aliyun-pai/settings.json`

```jsonc
{
  "version": "0.5.0",
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

  // Named resource profiles — "default" is required
  "profiles": {
    "default": {
      "jobSpecs": [
        {
          "type": "Worker",
          "image": "your-image:tag",
          "podCount": 1,
          "resourceConfig": {
            "CPU": "8",
            "GPU": "0",
            "memory": "32Gi",
            "sharedMemory": "32Gi",
          },
        },
      ],
      "jobType": "PyTorchJob",
    },
    "gpu-4": {
      "jobSpecs": [
        {
          "type": "Worker",
          "image": "your-image:tag",
          "podCount": 1,
          "resourceConfig": {
            "CPU": "64",
            "GPU": "4",
            "memory": "512Gi",
            "sharedMemory": "512Gi",
          },
        },
      ],
      "jobType": "PyTorchJob",
    },
  },

  // Global resource limits (optional)
  "limits": {
    "maxRunningJobs": 5,
    "maxGPU": 16,
    "maxCPU": 128,
  },

  // Global data source mounts — shared across all profiles
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

## Recommended OpenCode Configuration

If using this MCP server with OpenCode, add these permission rules to your `oh-my-opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "external_directory": { "*": "deny" },
    "pai_config_update": "ask",
    "pai_config_delete_profile": "ask",
    "pai_config_create_profile": "ask",
    "pai_job_submit": "ask"
  }
}
```

This prevents agents from reading credential files and requires user approval for config changes.
