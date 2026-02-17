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
Before submitting jobs, verify profiles, limits, mounts, and code source:

a) Inspect available settings:
   pai_config_schema()
   → Returns profile fields, global limits, mounts, and code source fields

b) View current configuration:
   pai_config()
   → Shows your current settings (sanitized, credentials redacted)

c) List available profiles:
   pai_config_list_profiles()
   → Shows profile names and their jobType/jobSpecs summaries

d) Update global fields (all profiles share these):
   pai_config_update(updates={
     "limits.maxRunningJobs": 2,
     "limits.maxGPU": 8,
     "limits.maxCPU": 64
   })
   → Limits are global
   → Mounts are global-only and updated via "mounts"

e) Update a specific profile in-place:
   pai_config_update(updates={
     "jobSpecs[0].resourceConfig.GPU": "4",
     "jobSpecs[0].resourceConfig.memory": "64Gi",
     "jobType": "PyTorchJob"
   }, profile="gpu-4")
   → When profile is provided, updates target that profile

### Step 3: Job Submission
pai_job_submit(name="train", command="python train.py --epochs 100", profile="gpu-4")
→ System automatically:
  - Prepends your project prefix to the name
  - Adds timestamp: {prefix}-{name}-{timestamp}
  - Pulls code from configured branch/commit
  - Loads jobType + jobSpecs from the selected profile
  - Applies global mounts and global limits
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
- Optionally update config (profile or global fields)
- Resubmit: pai_job_submit(name="train-v2", command="...", profile="gpu-4")
- Repeat monitoring steps

If resource issues (OOM, quota exceeded):
- Adjust profile fields or limits via pai_config_update
- Resubmit with updated resources


## 2. TOOL CATALOG

### Identity & Configuration
- pai_whoami
  Show current caller identity (account, user, identity type) and workspace context
  Use to verify credentials and workspace before submitting jobs

- pai_config
  Show full MCP settings (sanitized, credentials redacted)
  Includes profiles, global limits, global mounts, and code source config
  Use to inspect current configuration before job submission

- pai_config_schema
  Inspect the configuration schema with field descriptions and types
  Use to understand profile fields and global fields for updates

- pai_config_update
  Modify specific configuration fields using JSON path notation
  Optional profile parameter targets a specific profile
  Example (global): pai_config_update(updates={"limits.maxRunningJobs": 2})
  Example (profile): pai_config_update(updates={"jobSpecs[0].resourceConfig.GPU": "8"}, profile="gpu-8")

- pai_config_list_profiles
  List all saved configuration profiles with summaries
  Profiles are the primary source for jobType and jobSpecs

- pai_config_create_profile
  Create or update a named profile with overrides
  Example: pai_config_create_profile(name="gpu-4", baseProfile="default", overrides={...})

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
  Required: name (short task name), command (shell command), profile (defaults to "default")
  Optional: codeCommit (git commit to checkout)
  jobType + jobSpecs come from selected profile; mounts/limits are global
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

Profiles are named presets for job configuration. Each profile contains jobType + jobSpecs.
Jobs pick a profile at submit time via the profile parameter.

### List Available Profiles
pai_config_list_profiles()
→ Shows all saved profiles with summary fields

### Submit with a Profile
pai_job_submit(name="debug-run", command="python train.py --epochs 1", profile="default")
→ Uses the selected profile for jobType + resources

pai_job_submit(name="train-run", command="python train.py --epochs 100", profile="gpu-8")
→ Switch profiles per job without mutating global runtime state

### Create Profile from Existing Profile
pai_config_create_profile(name="my-preset", fromCurrent=true)
→ Copies the active/default base profile into a new named profile

pai_config_create_profile(name="my-preset", baseProfile="default", overrides={
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
  ]
})
→ Creates/updates a profile with explicit overrides

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
    ]
  }
)
→ Creates a new profile; limits remain global under limits.*


## 4. COMMON SCENARIOS

### Scenario A: Debug a Training Script
1. Submit short test with small profile:
   pai_job_submit(name="test", command="python train.py --epochs 1 --debug", profile="debug")
2. Monitor: pai_job_wait(jobId, target="Running") → pai_job_logs(jobId)
3. If errors: fix locally, push, resubmit

### Scenario B: Scale Up for Production Training
1. Submit full training with larger profile:
   pai_job_submit(name="prod-train", command="python train.py --epochs 100", profile="train")
2. Monitor: pai_job_wait(jobId, target="Running") → pai_job_logs(jobId)
3. Wait for completion: pai_job_wait(jobId, target="Terminal")

### Scenario C: Switch Branches
1. Update branch: pai_config_update(updates={"codeSource.defaultBranch": "feature-x"})
2. Verify: pai_config() → check codeSource.defaultBranch
3. Submit job: pai_job_submit(name="test-feature", command="...", profile="default")
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
     baseProfile="default",
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
2. Submit job: pai_job_submit(name="train", command="...", profile="medium")


## 5. TROUBLESHOOTING

### Job Stuck in "Queuing" Status
Cause: Insufficient quota or all resources in use
Solution:
1. Check active jobs: pai_job_list()
2. Stop old/failed jobs: pai_job_stop(jobId)
3. Submit with a smaller profile: pai_job_submit(name="retry", command="...", profile="debug")
4. Resubmit with lower resources

### Wrong Branch Deployed
Cause: Branch switching via Aliyun API may be unreliable
Solution:
1. Always verify branch/commit in job logs (first few lines)
2. If wrong branch: update config and resubmit
   pai_config_update(updates={"codeSource.defaultBranch": "correct-branch"})
   pai_job_submit(name="retry", command="...", profile="default")
3. Check logs again to confirm correct branch

### Out of Quota
Cause: Too many active jobs or too many resources requested
Solution:
1. List active jobs: pai_job_list()
2. Stop unnecessary jobs: pai_job_stop(jobId)
3. Wait for jobs to complete: pai_job_wait(jobId, target="Terminal")
4. Optionally tighten limits globally:
   pai_config_update(updates={"limits.maxRunningJobs": 1})

### Import Errors in Logs
Cause: Code not pushed to correct branch, or dependencies missing
Solution:
1. Verify code pushed: git push
2. Check branch in logs: pai_job_logs(jobId)
3. If wrong branch: update config and resubmit
4. If dependencies missing: update image in a profile
   pai_config_update(updates={"jobSpecs[0].image": "new-image:tag"}, profile="default")

### Job Fails Immediately
Cause: Command error, missing files, or resource issues
Solution:
1. Check logs: pai_job_logs(jobId)
2. Look for error messages in stdout/stderr
3. Fix code locally, push, resubmit
4. If OOM: increase memory via pai_config_update(..., profile="...")

### Cannot Modify Locked Fields
Cause: Some fields are locked and cannot be changed via pai_config_update
Locked fields: credentials, regionId, workspaceId, resourceId, projectPrefix, codeSource.codeSourceId
Solution:
1. These fields are set during initialization (bunx aliyun-pai-mcp init)
2. To change them, re-run initialization or manually edit ~/.config/aliyun-pai/settings.json
3. For other fields, use pai_config_update (global or profile-scoped)


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
