import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfigStore } from "../../config/store.js";

const HELP_TEXT = `
# Aliyun PAI-DLC MCP Server — Usage Guide

## 1. RECOMMENDED WORKFLOW

### Step 1: Local Development
- Write or modify your training code locally
- Test locally if possible (unit tests, small dataset runs)
- Commit your changes: git commit -m "your message"
- Push to remote: git push

### Step 2: Configuration
Before submitting jobs, ensure your configuration matches your needs:

a) Inspect available settings:
   pai_config_schema()
   → Returns the full schema with descriptions of all configurable fields

b) View current configuration:
   pai_config()
   → Shows your current settings (sanitized, credentials redacted)

c) List available profiles:
   pai_config_list_profiles()
   → Shows predefined resource profiles (e.g., "debug", "train")

d) Apply a profile:
   pai_config_apply_profile(name="debug")
   → Use "debug" for 1-GPU quick tests
   → Use "train" for 8-GPU full training runs
   → Profiles set image, GPU/CPU/memory, pod count, etc.

e) Or update specific fields:
   pai_config_update(updates={
     "jobSpecs[0].resourceConfig.GPU": "4",
     "jobSpecs[0].resourceConfig.memory": "64Gi"
   })
   → Use JSON path notation for nested fields
   → Changes persist until next update or profile application

### Step 3: Job Submission
pai_job_submit(name="train", command="python train.py --epochs 100")
→ System automatically:
  - Prepends your project prefix to the name
  - Adds timestamp: {prefix}-{name}-{timestamp}
  - Pulls code from configured branch/commit
  - Applies resource config from settings
  - Mounts data sources from settings
→ Returns jobId for monitoring

### Step 4: Monitoring
a) Wait for job to start:
   pai_job_wait(jobId, target="Running")
   → Polls every 10 seconds until status reaches "Running"

b) Check logs:
   pai_job_logs(jobId)
   → IMPORTANT: Verify branch/commit in early log output
   → Branch switching via Aliyun API may be unreliable
   → Always confirm correct code version is deployed

c) Monitor progress:
   pai_job_logs(jobId)
   → Call periodically to check training progress

d) Wait for completion:
   pai_job_wait(jobId, target="Terminal")
   → Polls until job reaches terminal state (Succeeded/Failed/Stopped)

### Step 5: Iteration
If errors occur:
- Fix code locally
- git commit && git push
- Optionally update config (pai_config_update or pai_config_apply_profile)
- Resubmit: pai_job_submit(name="train-v2", command="...")
- Repeat monitoring steps

If resource issues (OOM, quota exceeded):
- Adjust config: pai_config_update or pai_config_apply_profile
- Resubmit with new resources


## 2. TOOL CATALOG

### Identity & Configuration
- pai_whoami
  Show current caller identity (account, user, identity type) and workspace context
  Use to verify credentials and workspace before submitting jobs

- pai_config
  Show full MCP settings (sanitized, credentials redacted)
  Includes default job settings (image, GPU/CPU/memory, pod count), mounts, code source config
  Use to inspect current configuration before job submission

- pai_config_schema
  Inspect the configuration schema with field descriptions and types
  Use to understand what fields are available and how to structure updates

- pai_config_update
  Modify specific configuration fields using JSON path notation
  Example: pai_config_update(updates={"jobSpecs[0].resourceConfig.GPU": "8"})
  Changes persist until next update or profile application

- pai_config_list_profiles
  List all saved configuration profiles with their settings
  Profiles are named presets for resource configurations

- pai_config_apply_profile
  Apply a saved profile to current configuration
  Example: pai_config_apply_profile(name="debug") for 1-GPU testing
  Example: pai_config_apply_profile(name="train") for 8-GPU training

- pai_config_create_profile
  Create a new profile from current config or with custom overrides
  Example: pai_config_create_profile(name="my-preset", fromCurrent=true)
  Example: pai_config_create_profile(name="custom", overrides={...})

### Jobs
- pai_job_list
  List recent jobs for your project prefix
  Shows job ID, name, status, creation time
  Use to check active jobs and quota usage

- pai_job_get
  Get full details for a specific job (owner check only)
  Shows complete job spec, status, timestamps, resource allocation
  Use to inspect job configuration and state

- pai_job_submit
  Submit a new DLC job
  Required: name (short task name), command (shell command to run)
  Optional: codeCommit (git commit to checkout)
  Everything else (image, resources, mounts) comes from settings
  Returns jobId for monitoring

- pai_job_stop
  Stop a running job (requires prefix + owner match)
  Use to free resources or cancel failed jobs
  Job enters "Stopped" terminal state

- pai_job_logs
  Get pod logs for a job (owner check only)
  Returns stdout/stderr from job pods
  Use to debug errors and monitor training progress
  IMPORTANT: Check branch/commit in early log output

- pai_job_wait
  Poll until a job reaches target status
  target="Running" → wait for job to start
  target="Terminal" → wait for completion (Succeeded/Failed/Stopped)
  Polls every 10 seconds, returns when target reached

- pai_help
  Show this comprehensive usage guide


## 3. CONFIG PROFILE USAGE

Profiles are named presets for resource configurations. They simplify switching between different resource allocations (e.g., debug vs. production).

### List Available Profiles
pai_config_list_profiles()
→ Shows all saved profiles with their settings

### Apply a Profile
pai_config_apply_profile(name="debug")
→ Applies the "debug" profile (typically 1 GPU, small memory)

pai_config_apply_profile(name="train")
→ Applies the "train" profile (typically 8 GPU, large memory)

### Create Profile from Current Config
pai_config_create_profile(name="my-preset", fromCurrent=true)
→ Saves current settings as a new profile named "my-preset"

pai_config_create_profile(name="my-preset", fromCurrent=true, overrides={
  jobSpecs: [
    {
      type: "Worker",
      image: "registry.cn-hangzhou.aliyuncs.com/org/image:tag",
      podCount: 1,
      resourceConfig: {
        GPU: "4",
        CPU: "16",
        memory: "64Gi",
        sharedMemory: "64Gi"
      }
    }
  ]
})
→ Saves current settings with GPU override

### Create Profile from Scratch
pai_config_create_profile(
  name="custom",
  overrides={
    jobType: "PyTorchJob",
    jobSpecs: [
      {
        type: "Worker",
        image: "registry.cn-hangzhou.aliyuncs.com/org/image:tag",
        podCount: 1,
        resourceConfig: {
          GPU: "4",
          CPU: "16",
          memory: "64Gi",
          sharedMemory: "64Gi"
        }
      }
    ],
    maxRunningJobs: 2
  }
)
→ Creates a new profile with specified resource settings


## 4. COMMON SCENARIOS

### Scenario A: Debug a Training Script
1. Apply debug profile: pai_config_apply_profile(name="debug")
2. Submit short test: pai_job_submit(name="test", command="python train.py --epochs 1 --debug")
3. Monitor: pai_job_wait(jobId, target="Running") → pai_job_logs(jobId)
4. If errors: fix locally, push, resubmit

### Scenario B: Scale Up for Production Training
1. Apply train profile: pai_config_apply_profile(name="train")
2. Submit full training: pai_job_submit(name="prod-train", command="python train.py --epochs 100")
3. Monitor: pai_job_wait(jobId, target="Running") → pai_job_logs(jobId)
4. Wait for completion: pai_job_wait(jobId, target="Terminal")

### Scenario C: Switch Branches
1. Update branch: pai_config_update(updates={"codeSource.defaultBranch": "feature-x"})
2. Verify: pai_config() → check codeSource.defaultBranch
3. Submit job: pai_job_submit(name="test-feature", command="...")
4. IMPORTANT: Verify branch in logs (first few lines)
   → Branch switching via Aliyun API may be unreliable

### Scenario D: Check Quota Usage
1. List active jobs: pai_job_list()
2. Check status of each job: pai_job_get(jobId)
3. Stop old jobs to free resources: pai_job_stop(jobId)

### Scenario E: Custom Resource Configuration
1. Create custom profile:
   pai_config_create_profile(
     name="medium",
     overrides={
        jobSpecs: [
          {
            type: "Worker",
            image: "registry.cn-hangzhou.aliyuncs.com/org/image:tag",
            podCount: 1,
            resourceConfig: {
              GPU: "4",
              CPU: "16",
              memory: "64Gi",
              sharedMemory: "64Gi"
            }
          }
        ]
      }
    )
2. Apply it: pai_config_apply_profile(name="medium")
3. Submit job: pai_job_submit(name="train", command="...")


## 5. TROUBLESHOOTING

### Job Stuck in "Queuing" Status
Cause: Insufficient quota or all resources in use
Solution:
1. Check active jobs: pai_job_list()
2. Stop old/failed jobs: pai_job_stop(jobId)
3. Reduce resource requirements: pai_config_apply_profile(name="debug")
4. Resubmit with lower resources

### Wrong Branch Deployed
Cause: Branch switching via Aliyun API may be unreliable
Solution:
1. Always verify branch/commit in job logs (first few lines)
2. If wrong branch: update config and resubmit
   pai_config_update(updates={"codeSource.defaultBranch": "correct-branch"})
   pai_job_submit(name="retry", command="...")
3. Check logs again to confirm correct branch

### Out of Quota
Cause: Too many active jobs or too many resources requested
Solution:
1. List active jobs: pai_job_list()
2. Stop unnecessary jobs: pai_job_stop(jobId)
3. Wait for jobs to complete: pai_job_wait(jobId, target="Terminal")
4. Resubmit with freed quota

### Import Errors in Logs
Cause: Code not pushed to correct branch, or dependencies missing
Solution:
1. Verify code pushed: git push
2. Check branch in logs: pai_job_logs(jobId)
3. If wrong branch: update config and resubmit
4. If dependencies missing: update Docker image in config
   pai_config_update(updates={"jobSpecs[0].image": "new-image:tag"})

### Job Fails Immediately
Cause: Command error, missing files, or resource issues
Solution:
1. Check logs: pai_job_logs(jobId)
2. Look for error messages in stdout/stderr
3. Fix code locally, push, resubmit
4. If OOM: increase memory via pai_config_update or profile

### Cannot Modify Locked Fields
Cause: Some fields are locked and cannot be changed via pai_config_update
Locked fields: credentials, regionId, workspaceId, resourceId, projectPrefix, codeSource.codeSourceId
Solution:
1. These fields are set during initialization (bunx aliyun-pai-mcp init)
2. To change them, re-run initialization or manually edit ~/.config/aliyun-pai/settings.json
3. For other fields, use pai_config_update or profiles


## 6. SECURITY RULES

CRITICAL SECURITY RULES — NEVER VIOLATE THESE:

1. ALL cluster operations MUST use pai_* tools
   → NEVER call Aliyun APIs directly via curl, SDK, or CLI
   → NEVER bypass this MCP server for cluster interaction

2. NEVER read credential files
   → NEVER read ~/.config/aliyun-pai/settings.json
   → NEVER search for credential files on the filesystem
   → Use pai_config to inspect settings (credentials are redacted)

3. NEVER inspect environment variables for secrets
   → NEVER run commands like: env | grep KEY
   → NEVER attempt to extract credentials from environment

4. NEVER attempt to modify locked configuration fields
   → Locked: credentials, regionId, workspaceId, resourceId, projectPrefix, codeSource.codeSourceId
   → These are set during initialization and cannot be changed via tools
   → Attempting to modify them will fail validation

5. Branch/commit switching via Aliyun API may be unreliable
   → ALWAYS verify branch/commit in job logs (first few lines)
   → Do not assume branch switch succeeded without verification

6. Job ownership validation
   → You can only stop jobs that match your project prefix AND your user ID
   → You can view any job (pai_job_get, pai_job_logs) but only stop your own
   → Ownership is enforced server-side

VIOLATION OF THESE RULES = SECURITY INCIDENT
`.trim();

export function registerHelpTool(server: McpServer, _configStore: ConfigStore): void {
  server.registerTool(
    "pai_help",
    {
      description: "Show comprehensive usage guide for Aliyun PAI-DLC MCP server",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (_extra) => {
      return {
        content: [{ type: "text", text: HELP_TEXT }],
      };
    },
  );
}
