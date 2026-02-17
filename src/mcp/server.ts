import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDLCClient } from "../clients/dlc.js";
import { createSTSClient, getCallerIdentity } from "../clients/sts.js";
import { loadSettings } from "../config/loader.js";
import { ConfigStore } from "../config/store.js";
import { registerConfigTool } from "./tools/config.js";
import { registerConfigProfileTools } from "./tools/config-profiles.js";
import { registerConfigSchemaTool } from "./tools/config-schema.js";
import { registerConfigUpdateTool } from "./tools/config-update.js";
import { registerHelpTool } from "./tools/help.js";
import { registerJobGetTool } from "./tools/job-get.js";
import { registerJobListTool } from "./tools/job-list.js";
import { registerJobLogsTool } from "./tools/job-logs.js";
import { registerJobStopTool } from "./tools/job-stop.js";
import { registerJobSubmitTool } from "./tools/job-submit.js";
import { registerJobWaitTool } from "./tools/job-wait.js";
import { registerWhoamiTool } from "./tools/whoami.js";

export async function startServer(): Promise<void> {
  const settings = await loadSettings();

  const stsClient = createSTSClient(settings.credentials, settings.regionId);
  const dlcClient = createDLCClient(settings.credentials, settings.regionId);

  const callerIdentity = await getCallerIdentity(stsClient);

  const configStore = new ConfigStore(settings);

  const server = new McpServer(
    { name: "aliyun-pai-mcp", version: "0.5.0" },
    {
      instructions: `
You are connected to Aliyun PAI-DLC via this MCP server.

WORKFLOW:
1. Write/modify code locally, then git commit && git push
2. Use pai_config_schema to understand available profiles and global limits
3. Call pai_job_submit with name, command, and profile (e.g., profile="gpu-4")
4. Code is pulled from the configured branch automatically.
5. Use pai_job_wait + pai_job_logs to monitor. Verify the correct branch/commit in early log output.
6. If errors: fix code locally, push, resubmit. Iterate until success.

RULES:
- ALL cluster interaction MUST go through pai_* tools. No exceptions.
- NEVER call Aliyun APIs directly via curl, SDK, or CLI.
- NEVER read or search for credential files on the filesystem.
- NEVER run commands to inspect environment variables for secrets.
- Branch switching via Aliyun PAI may occasionally be unreliable. Always verify in logs.

Use pai_help for detailed usage guide.
      `.trim(),
    },
  );

  registerHelpTool(server, configStore);
  registerWhoamiTool(server, configStore, stsClient, callerIdentity);
  registerConfigTool(server, configStore);
  registerConfigSchemaTool(server, configStore);
  registerConfigUpdateTool(server, configStore);
  registerConfigProfileTools(server, configStore);
  registerJobListTool(server, configStore, dlcClient);
  registerJobGetTool(server, configStore, dlcClient, callerIdentity);
  registerJobSubmitTool(server, configStore, dlcClient);
  registerJobStopTool(server, configStore, dlcClient, callerIdentity);
  registerJobLogsTool(server, configStore, dlcClient, callerIdentity);
  registerJobWaitTool(server, configStore, dlcClient, callerIdentity);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
