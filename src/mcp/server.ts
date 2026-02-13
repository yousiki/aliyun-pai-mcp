import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDLCClient } from "../clients/dlc.js";
import { createSTSClient, getCallerIdentity } from "../clients/sts.js";
import { loadSettings } from "../config/loader.js";
import { ConfigStore } from "../config/store.js";
import { registerCodeSourceTools } from "./tools/codesource.js";
import { registerConfigTool } from "./tools/config.js";
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

  const server = new McpServer({ name: "aliyun-pai-mcp", version: "0.3.0" });

  registerWhoamiTool(server, configStore, stsClient, callerIdentity);
  registerConfigTool(server, configStore);
  registerCodeSourceTools(server, configStore);
  registerJobListTool(server, configStore, dlcClient);
  registerJobGetTool(server, configStore, dlcClient, callerIdentity);
  registerJobSubmitTool(server, configStore, dlcClient);
  registerJobStopTool(server, configStore, dlcClient, callerIdentity);
  registerJobLogsTool(server, configStore, dlcClient, callerIdentity);
  registerJobWaitTool(server, configStore, dlcClient, callerIdentity);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
