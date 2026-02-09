import { startServer } from "../mcp/server.js";

export default async function serverCommand(): Promise<void> {
  try {
    await startServer();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start MCP server: ${message}`);
    process.exit(1);
  }
}
