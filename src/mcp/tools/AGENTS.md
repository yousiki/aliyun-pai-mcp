# MCP TOOLS MODULE

## OVERVIEW
MCP tool implementations for Aliyun PAI-DLC operations. 14 TypeScript files registering 14 MCP tools.

## STRUCTURE
```
tools/
├── job-submit.ts         # pai_job_submit
├── job-list.ts           # pai_job_list
├── job-get.ts            # pai_job_get
├── job-stop.ts           # pai_job_stop
├── job-wait.ts           # pai_job_wait
├── job-logs.ts           # pai_job_logs
├── config.ts             # pai_config
├── config-schema.ts      # pai_config_schema
├── config-update.ts      # pai_config_update
├── config-profiles.ts    # pai_config_list_profiles, pai_config_apply_profile, pai_config_create_profile
├── whoami.ts             # pai_whoami
└── help.ts               # pai_help
```

## WHERE TO LOOK

| Task | File | Key Function |
|------|------|--------------|
| Submit job | job-submit.ts | `registerJobSubmitTool()` |
| List jobs | job-list.ts | `registerJobListTool()` |
| Get job details | job-get.ts | `registerJobGetTool()` |
| Stop job | job-stop.ts | `registerJobStopTool()` |
| Poll job status | job-wait.ts | `registerJobWaitTool()` |
| Get logs | job-logs.ts | `registerJobLogsTool()` |
| Show config | config.ts | `registerConfigTool()` |
| Inspect config schema | config-schema.ts | `registerConfigSchemaTool()` |
| Update config | config-update.ts | `registerConfigUpdateTool()` |
| List profiles | config-profiles.ts | `registerConfigProfileTools()` |
| Apply profile | config-profiles.ts | `registerConfigProfileTools()` |
| Create profile | config-profiles.ts | `registerConfigProfileTools()` |
| Show identity | whoami.ts | `registerWhoamiTool()` |
| Show help | help.ts | `registerHelpTool()` |

## CONVENTIONS

**File naming**: `{domain}-{action}.ts` for job operations, descriptive for others.

**MCP tool naming**: `pai_{domain}_{action}` snake_case with `pai_` prefix.

**Export pattern**: Each file exports ONE function `register*Tool(server, configStore, ...clients)`.

**Registration location**: All tools imported and registered in `../server.ts`.

**Dependency injection**: Tools receive `configStore: ConfigStore` instead of `settings: Settings`. Call `configStore.get()` to access current settings. Never import clients/settings directly.

**Input schema**: Zod schemas defined as `{tool}InputSchema` constants where needed.

**Helper**: All files define `toText(payload) => JSON.stringify(payload, null, 2)` for output formatting.

**Sanitization**: ALWAYS call `sanitizeObject(result)` before returning tool output. Never expose credentials.

**Annotations**: Include `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` on every tool.

## ANTI-PATTERNS

**Never** return raw API responses — always sanitize first.

**Never** import settings/clients at module level — use dependency injection.

**Never** deviate from `pai_` prefix for tool names.

## ADDING NEW TOOLS

1. Create `{domain}-{action}.ts` file
2. Define input schema (if parameters needed)
3. Export `register*Tool(server, settings, ...clients)`
4. Import and call in `../server.ts`
5. Use `sanitizeObject()` on all outputs
6. Add annotations
