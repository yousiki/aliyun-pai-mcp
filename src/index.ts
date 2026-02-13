#!/usr/bin/env bun

import { Command } from "commander";

const program = new Command();

program.name("aliyun-pai-mcp").version("0.4.1").description("MCP server for Aliyun PAI-DLC");

program
  .command("init")
  .description("Initialize configuration")
  .option("--force", "Skip reconfigure confirmation if settings exist")
  .action(async (options: { force?: boolean }) => {
    const command = await import("./commands/init.js");
    await command.default(options);
  });

program
  .command("server")
  .description("Start MCP server")
  .action(async () => {
    const command = await import("./commands/server.js");
    await command.default();
  });

program
  .command("doctor")
  .description("Run diagnostics")
  .action(async () => {
    const command = await import("./commands/doctor.js");
    await command.default();
  });

program
  .command("dump-job-specs <jobId>")
  .description("Dump job specs for a job")
  .action(async (jobId: string) => {
    const command = await import("./commands/dump-job-specs.js");
    await command.default(jobId);
  });

program.parse();
