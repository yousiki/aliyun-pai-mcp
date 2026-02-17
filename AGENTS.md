# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-09 21:41:00  
**Commit:** cfe1bd7  
**Branch:** main

## OVERVIEW
MCP server for Aliyun PAI-DLC distributed training. CLI tool + stdio MCP server enabling coding agents to submit, monitor, and manage DLC jobs. TypeScript/Bun runtime. 14 MCP tools with profile-first configuration and resource limits.

## STRUCTURE
```
aliyun-pai-mcp/
├── src/
│   ├── index.ts           # CLI entry point (Commander.js routing)
│   ├── commands/          # CLI commands: init, server, doctor, dump-job-specs
│   ├── mcp/
│   │   ├── server.ts      # MCP server bootstrap, tool registration
│   │   └── tools/         # MCP tool implementations (14 tools) → See tools/AGENTS.md
│   ├── clients/           # API client factories: dlc, sts
│   ├── config/
│   │   ├── store.ts       # ConfigStore class (mutable settings with validation)
│   │   ├── schema.ts      # Zod schemas + ProfileSchema
│   │   ├── loader.ts      # loadSettings()
│   │   └── writer.ts      # writeSettings()
│   └── utils/             # Validation + sanitization
├── package.json
├── tsconfig.json
└── biome.json
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add MCP tool | `src/mcp/tools/` | Follow `job-*.ts` pattern, register in server.ts |
| Add CLI command | `src/commands/` | Export default async, import in index.ts |
| Modify settings schema | `src/config/schema.ts` | Zod schemas, regenerate types |
| Add API client | `src/clients/` | Factory pattern: `create*Client(creds, region)` |
| Job validation logic | `src/utils/validate.ts` | Ownership, status checks, name generation, resource extraction |
| Credential redaction | `src/utils/sanitize.ts` | Security: redact before output |
| ConfigStore operations | `src/config/store.ts` | Mutable settings with locked field enforcement |

## CONVENTIONS

**Bun-native TypeScript** — Direct TS execution, no compile step. Uses `bun run` not `npm run`.

**Code Style** (Biome):
- 100-char line width (not 80)
- Double quotes required
- Semicolons always
- Trailing commas everywhere
- 2-space indent
- Arrow function parens: always `(x) => x`

**TypeScript**:
- Strict mode + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noFallthroughCasesInSwitch`
- Path alias: `@/*` → `./src/*`

**Naming**:
- Files: kebab-case (`job-submit.ts`)
- Types: PascalCase (`Settings`, `JobSpec`)
- Functions: camelCase (`loadSettings`, `validateJobOwnership`)
- MCP tools: `pai_` prefix + snake_case (`pai_job_submit`)

## ANTI-PATTERNS (THIS PROJECT)

1. **Job name prefixes**: Do NOT include `projectPrefix` in `pai_job_submit` name parameter — system auto-prepends. Manual prefix = malformed name = ownership validation failure.

## UNIQUE STYLES

**Settings location**: `~/.config/aliyun-pai/settings.json` (not project root, not `.env`).

**Settings shape**: Profile-first — `profiles` (required `default`) hold `jobSpecs` + `jobType`. `mounts` and `limits` (maxRunningJobs/maxGPU/maxCPU) are global. No top-level jobSpecs/jobType.

**Architecture**: Layered DI pattern — config → clients → tools. Settings loaded once, passed down. Legacy settings auto-migrated on load.

**Security**: All tool outputs sanitized via `sanitizeObject()` or `sanitizeSettings()` before returning to agents.

**Tool registration**: Each tool file exports single `register*Tool(server, configStore, ...clients)`. Tools receive `ConfigStore` instance for dynamic config access.

## COMMANDS

```bash
# User-facing (via npm)
bunx aliyun-pai-mcp init                  # Initialize settings
bunx aliyun-pai-mcp doctor                # Verify setup
bunx aliyun-pai-mcp dump-job-specs <id>   # Extract jobSpecs from existing job

# MCP integration (Claude Code)
claude mcp add aliyun-pai -- bunx aliyun-pai-mcp server

# Development (from source)
bun install
bun run dev                 # Runs src/index.ts
bun run server              # Starts MCP server (stdio)

# Code quality
bun run typecheck           # TypeScript strict check
bun run format              # Biome format --write
bun run lint:fix            # Biome lint --write
bun run check               # Full Biome check
```

## NOTES

**No tests** — Quality via TypeScript strict mode + Biome + Zod runtime validation.

**No CI/CD** — Manual testing/deployment.

**Bun-first** — Requires Bun runtime. Published to npm, installable via `bunx` or `bun install -g`.

**Settings initialization**: Run `bunx aliyun-pai-mcp init` once to create `~/.config/aliyun-pai/settings.json`.
