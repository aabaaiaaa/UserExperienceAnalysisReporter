# Iteration 7 Tasks

## Part A: Technical Debt

### TASK-001: Move markRateLimited tests to dedicated file
- **Status**: done
- **Dependencies**: none
- **Description**: Move the two `ProgressDisplay.markRateLimited` tests from `tests/coverage-gaps.test.ts:255-276` to a new file `tests/progress-display-rate-limit.test.ts`. The new file uses a static `import { ProgressDisplay } from '../src/progress-display.js'` — no dynamic import, no mocks. Remove the `// ─── progress-display: markRateLimited` section from coverage-gaps.test.ts entirely. See requirements.md section A1.
- **Verification**: `npx vitest run tests/progress-display-rate-limit.test.ts tests/coverage-gaps.test.ts --reporter=verbose` — both files pass, no timeouts.

### TASK-002: Add debug logging to safeStatMtimeMs bare catch
- **Status**: done
- **Dependencies**: none
- **Description**: In `progress-display.ts:379-384`, change `catch` to `catch (err)` and add `debug()` call before returning `null`. Import `debug` from `./logger.js` if not already imported. Add a targeted test verifying `safeStatMtimeMs()` returns `null` on error and calls `debug()`. See requirements.md section A2.
- **Verification**: `npx vitest run tests/progress-display.test.ts --reporter=verbose` — all tests pass including the new one.

### TASK-003: Add debug logging to consolidation-checkpoint.ts bare catch
- **Status**: done
- **Dependencies**: none
- **Description**: In `consolidation-checkpoint.ts:130`, change outer `catch` to `catch (err)` and add `debug()` call before returning `null`. Import `debug` from `./logger.js` if not already imported. Add a targeted test verifying `readConsolidationCheckpoint()` returns `null` on invalid JSON and calls `debug()`. See requirements.md section A3.
- **Verification**: `npx vitest run tests/consolidation-checkpoint.test.ts --reporter=verbose` — all tests pass including the new one.

### TASK-004: Preserve original stderr on subprocess timeout
- **Status**: done
- **Dependencies**: none
- **Description**: In `claude-cli.ts:98-101`, when the subprocess times out and stderr already contains content, preserve both the timeout message and the original stderr. When stderr is empty, use just the timeout message. Add tests for both cases (stderr non-empty and stderr empty on timeout). See requirements.md section A4.
- **Verification**: `npx vitest run tests/claude-cli.test.ts --reporter=verbose` — all tests pass including the new ones.

### TASK-005: Fix fragile area heading regex in consolidation.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `consolidation.ts:412-414`, change the `^## UXR-` exclusion pattern to `^## UXR-\d+:` (or similar) so it only skips actual finding ID headings (like `## UXR-001: Title`), not area names that happen to start with "UXR-". Add a test verifying an area named "UXR-Custom Area" is correctly parsed, while `## UXR-001: Finding` is still skipped. See requirements.md section A5.
- **Verification**: `npx vitest run tests/consolidation.test.ts --reporter=verbose` — all tests pass including the new one.

### TASK-006: Remove duplicate display.stop() call
- **Status**: done
- **Dependencies**: none
- **Description**: In `orchestrator.ts`, remove the `display.stop()` call from the signal handler (line ~188). The `finally` block (line ~495) already calls `display.stop()` and runs regardless of exit path. The signal handler should only set the cancellation flag. See requirements.md section A6.
- **Verification**: `npx vitest run tests/orchestrator.test.ts --reporter=verbose` — all existing tests pass.

## Part B: Plan Subcommand

### TASK-007a: Add plan subcommand parsing to CLI
- **Status**: done
- **Dependencies**: none
- **Description**: Modify `cli.ts` to detect `plan` as the first positional argument (first arg not starting with `--`). When detected, parse the remaining flags and route to a plan subcommand handler. The plan subcommand accepts: `--url` (required), `--intro`, `--scope`, `--plan`, `--instances` (default 1), `--rounds` (default 1), `--output` (default `.`), `--keep-temp`, `--verbose`, `--suppress-open`, `--dry-run`. Validation: `--url` required; if `--instances > 1` without `--plan`, warn and fall back to 1; `--append` with plan warns it's not applicable. Export a parsed config type for the plan subcommand. Do NOT implement the orchestration — just the CLI parsing and validation. See requirements.md section B2.
- **Verification**: `npx vitest run tests/cli.test.ts --reporter=verbose` — all existing tests pass plus new tests for plan subcommand parsing, validation, and edge cases.

### TASK-007b: Add plan subcommand CLI tests
- **Status**: done
- **Dependencies**: TASK-007a
- **Description**: Add tests to the CLI test file for the plan subcommand: (1) `uxreview plan --url <url>` parses correctly with defaults (instances=1, rounds=1, output='.'), (2) missing `--url` produces error, (3) `--instances 3` without `--plan` warns and falls back to 1, (4) `--append` with plan subcommand warns, (5) all valid flags are accepted. See requirements.md section B2 testing.
- **Verification**: `npx vitest run tests/cli.test.ts --reporter=verbose` — all tests pass.

### TASK-008: Build discovery-only instance prompt
- **Status**: done
- **Dependencies**: none
- **Description**: Add a `buildDiscoveryPrompt()` function to `instance-manager.ts` (or a new `plan-prompt.ts` module if instance-manager is too large). This prompt variant shares structure with `buildInstancePrompt()` but: (1) removes `buildReportInstructions()` entirely — no findings, no report.md, (2) reframes plan chunk as "Areas to Explore", (3) reframes scope as exploration guidance not evaluation criteria, (4) replaces the analysis process instructions with discovery-focused instructions (navigate, screenshot, document areas/elements/features, go deep into sub-pages and modals), (5) when no plan chunk is provided (single instance, no --plan), instructs Claude to explore the entire site freely. Includes the same checkpoint and screenshot instructions as the main prompt. See requirements.md section B3.
- **Verification**: `npx vitest run tests/instance-manager.test.ts --reporter=verbose` — new tests verify prompt includes discovery/screenshot/checkpoint instructions but NOT report instructions, with and without plan chunk.

### TASK-009: Build plan template generation
- **Status**: done
- **Dependencies**: none
- **Description**: Add a function (e.g., `generatePlanTemplate()`) that takes consolidated discovery content and uses a Claude call (via `withRateLimitRetry`) to produce a clean plan template in `--plan`-compatible format: `## Area` headings with `- Sub-item` bullets. The prompt instructs Claude to structure areas hierarchically, order logically (navigation first, settings last), keep entries concise. Fallback: if Claude call fails, return the raw consolidated discovery content. See requirements.md section B5.
- **Verification**: `npx vitest run tests/consolidation.test.ts --reporter=verbose` — new tests verify prompt format, output structure, and fallback behavior when Claude fails.

### TASK-010: Build discovery HTML report generator
- **Status**: done
- **Dependencies**: none
- **Description**: Add a `formatDiscoveryHtml()` function (in a new `discovery-html.ts` module or in `html-report.ts`). Takes consolidated discovery markdown and a screenshots directory path. Produces a self-contained HTML document with: (1) header with metadata (URL, date, instance count, rounds), (2) nested table of contents reflecting area hierarchy, (3) collapsible `<details>` sections for each area showing navigation path, elements found, criteria noted, and inline base64 screenshots, (4) nested sub-areas as child `<details>`, (5) same CSS foundation as existing report.html for visual consistency. Screenshots matched to areas by filename references in discovery content; unmatched screenshots shown in a general section. See requirements.md section B6.
- **Verification**: `npx vitest run tests/discovery-html.test.ts --reporter=verbose` — tests verify HTML includes TOC, nested sections, embedded screenshots, handles missing screenshots gracefully.

### TASK-011a: Build plan orchestration flow
- **Status**: done
- **Dependencies**: TASK-007a, TASK-008, TASK-009, TASK-010
- **Description**: Add a `runPlanDiscovery()` function (in `orchestrator.ts` or a new `plan-orchestrator.ts` module) that implements the plan subcommand flow: (1) initialize temp and output dirs, (2) distribute plan if provided and instances > 1 (reuse `distributePlan()`), (3) spawn instances with discovery-only prompt via `runInstanceRounds()` using the new `buildDiscoveryPrompt()`, (4) consolidate discoveries via `consolidateDiscoveryDocs()`, (5) generate plan template via `generatePlanTemplate()`, (6) generate discovery HTML via `formatDiscoveryHtml()`, (7) copy/rename screenshots to output dir, (8) write plan.md and discovery.html to output dir, (9) open discovery.html unless `--suppress-open`, (10) cleanup temp unless `--keep-temp`. Progress display runs during instance execution same as main command. See requirements.md section B4.
- **Verification**: `npx vitest run tests/plan-orchestrator.test.ts --reporter=verbose` — integration-style test with mocked Claude calls verifying the full flow: instances spawned, discoveries consolidated, both output files written.

### TASK-011b: Wire plan orchestration to CLI entry point
- **Status**: done
- **Dependencies**: TASK-011a
- **Description**: Connect the CLI plan subcommand handler (from TASK-007a) to the `runPlanDiscovery()` orchestration function (from TASK-011a). When `uxreview plan` is invoked, the CLI parses args, constructs the config, and calls `runPlanDiscovery()`. Handle dry-run mode (print what would happen, exit). Handle errors with the same pattern as the main command (print error, exit with code 1). See requirements.md sections B2 and B4.
- **Verification**: `npx vitest run tests/cli.test.ts tests/plan-orchestrator.test.ts --reporter=verbose` — all tests pass, including end-to-end wiring test.
