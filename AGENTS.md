# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-09 18:14:59  
**Commit:** 96072b9  
**Branch:** main

## OVERVIEW
MCP server for Aliyun PAI-DLC distributed training. CLI tool + stdio MCP server enabling coding agents to submit, monitor, and manage DLC jobs. TypeScript/Bun runtime.

## STRUCTURE
```
aliyun-pai-mcp/
├── src/
│   ├── index.ts           # CLI entry point (Commander.js routing)
│   ├── commands/          # CLI commands: init, server, doctor, dump-job-specs
│   ├── mcp/
│   │   ├── server.ts      # MCP server bootstrap, tool registration
│   │   └── tools/         # MCP tool implementations (9 tools) → See tools/AGENTS.md
│   ├── clients/           # API client factories: dlc, sts, workspace
│   ├── config/            # Settings schema (Zod), loader, writer
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
| Job validation logic | `src/utils/validate.ts` | Ownership, status checks, name generation |
| Credential redaction | `src/utils/sanitize.ts` | Security: redact before output |

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
- Types: PascalCase (`Settings`, `JobDefaults`)
- Functions: camelCase (`loadSettings`, `validateJobOwnership`)
- MCP tools: `pai_` prefix + snake_case (`pai_job_submit`)

## ANTI-PATTERNS (THIS PROJECT)

1. **Job name prefixes**: Do NOT include `projectPrefix` in `pai_job_submit` name parameter — system auto-prepends. Manual prefix = malformed name = ownership validation failure.

## UNIQUE STYLES

**Settings location**: `~/.config/aliyun-pai/settings.json` (not project root, not `.env`).

**Architecture**: Layered DI pattern — config → clients → tools. Settings loaded once, passed down.

**Security**: All tool outputs sanitized via `sanitizeObject()` or `sanitizeSettings()` before returning to agents.

**Tool registration**: Each tool file exports single `register*Tool(server, settings, ...clients)`. `codesource.ts` exception: registers 2 tools.

## COMMANDS

```bash
# Install
bun install

# Run CLI
bun run src/index.ts [init|server|doctor|dump-job-specs <jobId>]

# Development
bun run dev                 # Runs src/index.ts
bun run server              # Starts MCP server (stdio)

# Code quality
bun run typecheck           # TypeScript strict check
bun run format              # Biome format --write
bun run lint:fix            # Biome lint --write
bun run check               # Full Biome check

# MCP integration (Claude Code)
claude mcp add aliyun-pai -- bun run /path/to/aliyun-pai-mcp/src/index.ts server
```

## NOTES

**No tests** — Quality via TypeScript strict mode + Biome + Zod runtime validation.

**No CI/CD** — Manual testing/deployment.

**Bun-first** — Won't work with standard npm/Node.js without modifications.

**Settings initialization**: Run `bun run src/index.ts init` once to create `~/.config/aliyun-pai/settings.json`.
