# Changelog

All notable changes to this project are documented here.

This project follows the version in `package.json`. Add new entries under
`Unreleased` while developing, then move them to a dated version section before
running `npm run release`.

## Unreleased

### Changed

- Added the MIT license text to the repository.
- Ignored the `docs/` directory and stopped tracking existing local
  documentation artifacts.
- Normalized repository paths added with `daily-report config repos`.
- Treated empty repository input as the current directory in
  `daily-report config repos`.

### Fixed

- Rejected invalid repository paths in `daily-report config repos`.
- Prevented duplicate repository entries in `daily-report config repos`.

## 0.2.2 - 2026-06-16

### Fixed

- Rejected invalid times in the interactive schedule setup flow before writing
  scheduler config.
- Added scheduler test coverage for interactive invalid time handling.

## 0.2.1 - 2026-06-16

### Fixed

- Validated `daily-report schedule set` cron expressions before registration.
- Reported supported schedule formats when users pass malformed schedule input.
- Prevented partial, unquoted cron arguments from silently falling back to the
  default schedule.

## 0.2.0 - 2026-06-16

### Changed

- Normalized AI conversation summaries so generated reports use project-level
  activity metadata instead of noisy raw collector output.
- Moved template-summary responsibility into report generation for more
  consistent LLM fallback behavior.

### Fixed

- Completed template summaries for in-project AI conversations.

## 0.1.6 - 2026-06-15

### Fixed

- Registered scheduled jobs through the installed `daily-report` command instead
  of a workspace `dist/index.js` path.
- Added the package-owned `bin/daily-report` launcher for global installs.
- Improved launchd schedule generation and tests for macOS scheduled runs.

## 0.1.5 - 2026-06-08

### Added

- Added `npm run release` to build, pack, and install a global copy of the CLI.

### Changed

- Changed `daily-report --version` to read package metadata at runtime.
- Documented the development and release version model in README.

## 0.1.0 - 2026-06-02

### Added

- Initial TypeScript CLI for generating daily reports from local Git, GitHub,
  Claude Code, and Codex CLI activity.
- Added interactive setup, configuration management, privacy controls, report
  generation, and basic scheduling support.
