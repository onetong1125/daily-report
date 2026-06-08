# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # tsc compilation (src/ → dist/)
npm run dev -- --dry-run  # tsx hot-reload execution with CLI flags
npm test               # vitest run (single pass, 117 tests)
npm run test:watch     # vitest in watch mode
npm run test:coverage  # vitest with coverage report
```

- `npm run dev -- <args>` passes flags directly to the CLI (e.g. `--date 2026-06-01`, `--verbose`, `--dry-run`).
- To run a single test file: `npx vitest run tests/formatter.test.ts`

## Architecture

This is a TypeScript CLI tool (`daily-report`) that aggregates daily activity from local Git, GitHub, Claude Code, and Codex CLI, then calls an LLM to generate a Chinese-language daily report.

**Pipeline (in order):**
1. **Config** (`config.ts`) — loads/saves `~/.daily-report/config.json`, resolves `${ENV_VAR}` placeholders in `apiKey`
2. **Time boundary** (`timeboundary.ts`) — computes the UTC half-open interval for a given date + timezone
3. **Collectors** (`collectors/*.ts`) — each collector scans its source and emits `SanitizedEvent[]`:
   - `git-collector` — `git log` in configured repos
   - `github-collector` — `gh` CLI for PRs, issues, reviews, commits
   - `claude-collector` — reads `~/.claude/projects/<hash>/<uuid>.jsonl` session files
   - `codex-collector` — reads `~/.codex/sessions/<year>/<month>/<day>/*.jsonl`
4. **Sanitizer** (`sanitizer.ts`) — strips fields not in `privacy.allowedFields` whitelist; drops events missing required fields
5. **Merger** (`merger.ts`) — deduplicates events sharing `entity_type:entity_id` key, prioritizing by source order: git > github > claude > codex
6. **Generator** (`generator.ts`) — builds a prompt from grouped events, calls OpenAI-compatible `/chat/completions`, parses the response into `DailyReport`; falls back to template mode if no API key or on API failure
7. **Formatter** (`formatter.ts`) — renders to ANSI-colored terminal output or Markdown file

**Entry point:** `src/index.ts` — Commander.js CLI with default command (generate report) and subcommands: `setup`, `config {show,repos,llm,privacy,schedule}`, `schedule {on,off,set,status}`.

**Core types** (`types.ts`): `SanitizedEvent`, `GroupedEvents`, `DailyReport`, `DailyReportConfig` (with `LLMConfig`, `ReportConfig`, `PrivacyConfig`, `ScheduleConfig` sub-types), `TimeBoundary`.

**Scheduler** (`scheduler.ts`): macOS launchd via `~/Library/LaunchAgents/com.daily-report.plist`; Linux crontab.

**Privacy:** Collectors extract only metadata (commit SHA, PR number, topic keywords) — source code, prompt bodies, and conversation content never leave the machine. Topic extraction in Claude/Codex collectors uses local keyword-frequency analysis (no LLM calls).

## Key conventions

- All file I/O and child process calls are wrapped in try-catch with graceful degradation (source unavailable → skip with warning, not crash).
- API keys support `${ENV_VAR}` syntax so secrets aren't written to config files.
- The LLM prompt includes a strict output format (TL;DR / GIT_SECTION / GITHUB_SECTION / CLAUDE_SECTION / CODEX_SECTION / TOMORROW), parsed by regex in `parseResponse()`.
- Tests use vitest with `globals: true` — no explicit `import { describe, it, expect }` needed in test files.
