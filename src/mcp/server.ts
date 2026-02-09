import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDLCClient } from "../clients/dlc.js";
import { createSTSClient, getCallerIdentity } from "../clients/sts.js";
import { loadSettings } from "../config/loader.js";
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

  const server = new McpServer({ name: "aliyun-pai-mcp", version: "0.3.0" });

  registerWhoamiTool(server, settings, stsClient, callerIdentity);
  registerConfigTool(server, settings);
  registerCodeSourceTools(server, settings);
  registerJobListTool(server, settings, dlcClient);
  registerJobGetTool(server, settings, dlcClient, callerIdentity);
  registerJobSubmitTool(server, settings, dlcClient);
  registerJobStopTool(server, settings, dlcClient, callerIdentity);
  registerJobLogsTool(server, settings, dlcClient, callerIdentity);
  registerJobWaitTool(server, settings, dlcClient, callerIdentity);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
