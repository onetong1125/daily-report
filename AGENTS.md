# Repository Guidelines

## Project Structure & Module Organization

This is a TypeScript CLI project for generating daily activity reports. Source files live in `src/`; `src/index.ts` is the Commander.js entry point. Core modules include `config.ts`, `sanitizer.ts`, `merger.ts`, `generator.ts`, `formatter.ts`, `scheduler.ts`, and collectors under `src/collectors/`. Tests live in `tests/*.test.ts`. Build output is generated in `dist/` and should not be edited manually. Design notes live under `docs/superpowers/`.

## Build, Test, and Development Commands

- `npm install`: install runtime and development dependencies.
- `npm run dev -- --dry-run`: run the CLI through `tsx` without calling the LLM.
- `npm run build`: compile TypeScript from `src/` to `dist/`.
- `npm start -- --dry-run`: run the compiled CLI from `dist/index.js`.
- `npm run release`: build, pack, install globally from the `.tgz`, then remove the archive.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: run Vitest in watch mode.
- `npm run test:coverage`: generate V8 coverage.
- `npx vitest run tests/formatter.test.ts`: run a single test file.

## Coding Style & Naming Conventions

Use strict TypeScript with CommonJS output and ES2022 targets. Follow the existing two-space indentation, double quotes, semicolon style, and named exports. Keep modules focused on one pipeline responsibility. Use kebab-case filenames such as `git-collector.ts`; use clear type names like `DailyReportConfig`. Prefer graceful degradation: unavailable sources should warn and skip, not crash the report. Keep CLI version behavior tied to installed package metadata.

## Testing Guidelines

Vitest is configured with Node environment and globals, so tests can use `describe`, `it`, and `expect` without imports. Place tests in `tests/` with the `*.test.ts` suffix. Add focused unit tests near changed behavior, especially for collectors, sanitization, parsing, time boundaries, and retry/error paths. Run `npm test` before submitting changes.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style subjects such as `feat: 版本号改为运行时从 package.json 读取`, `docs: sync README with LLM retry feature`, and `test: add retryWithBackoff unit tests`. Keep subjects imperative and scoped (`feat`, `fix`, `test`, `docs`, `chore`). Pull requests should include a behavior summary, test results, linked issues or design docs when relevant, and screenshots or sample CLI output for formatting changes.

## Security & Configuration Tips

Never commit API keys or generated private reports. Configuration belongs in `~/.daily-report/config.json`; prefer `${ENV_VAR}` placeholders for secrets. Preserve the privacy boundary: collectors should emit sanitized metadata only, and prompts must not include source code, raw conversation bodies, or secret values.
