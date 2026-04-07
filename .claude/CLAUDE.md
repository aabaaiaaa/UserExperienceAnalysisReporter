# CLAUDE.md

This file provides guidance to Claude Code when working in this workspace.

## Environment

- **Platform**: Windows
- **Workspace**: C:\Users\jeastaugh\source\repos\Experiments\UserExperienceAnalysisReporter
- Use Windows-compatible commands (e.g., use backslashes in paths, no Unix-specific commands)

## Current Task

You are helping the user plan their project. This happens in three phases.

**IMPORTANT: Do NOT implement the project. Do NOT write code, create source files, install packages, or build anything. Your ONLY job right now is to plan and write the requirements and task list. The actual implementation will happen later in a separate automated process.**

---

### Phase 1 — Discovery (do NOT write any files)

**IMPORTANT: Use the AskUserQuestion tool whenever you need the user to make a choice or decision.** This includes both technical choices and design decisions. Only use free-form conversation for open-ended discovery questions where multiple-choice doesn't make sense.

Start by asking the user to describe their project in their own words. Understand:

- What does the project do? Who uses it?
- What are all the features and how do they connect?
- What are the user flows end-to-end?
- What does "done" look like — what are the success criteria?
- Are there any edge cases or failure modes to handle?

Use natural conversation for open-ended questions — let the user explain freely and ask follow-up questions.

For standard technical choices, use the **AskUserQuestion tool** to present options rather than asking open-ended questions. These include things like:

- Language/runtime (TypeScript, Python, Go, etc.)
- Framework (React, Express, FastAPI, etc.)
- Testing approach (unit, integration, e2e) and framework (Jest, Vitest, pytest, etc.)
- Package manager, build tools, linting
- Database, auth strategy, deployment target

Present sensible defaults based on what you've learned about the project. The user can always pick "Other" to specify something different.

Once discovery feels complete, review the full picture before moving to Phase 2:

- Flag any inconsistencies between features (e.g., conflicting requirements, missing glue between components)
- Identify gaps — features that were mentioned but not fully explored
- Check that the technical choices work together coherently
- Present your findings to the user and resolve any issues before proceeding

Iterate until the user is satisfied with the plan.

**Do NOT write any files during Phase 1.**

---

### Phase 2 — Write requirements.md (when user confirms the plan)

When the user says the plan is ready, write a detailed, human-readable requirements document to `C:\Users\jeastaugh\source\repos\Experiments\UserExperienceAnalysisReporter\.devloop\requirements.md`.

This document should be a **narrative planning document** — NOT a task list. Write it in free-form markdown with sections, descriptions, technical decisions, and context. This is the reference document that developers (and Claude during implementation) will read to understand what needs to be built and why.

Include things like: feature descriptions, user flows, technical approach, testing strategy, edge cases, dependencies, and any decisions made during discovery.

**Do NOT include task format (TASK-001, etc.) in this file.** That comes in Phase 3.

---

### Phase 3 — Generate tasks.md (after requirements.md is written)

After writing requirements.md, convert the plan into a structured task list at `C:\Users\jeastaugh\source\repos\Experiments\UserExperienceAnalysisReporter\.devloop\tasks.md`.

Each task should reference the requirements document for full context. The task format is:

```markdown
### TASK-001: Task title here
- **Status**: pending
- **Dependencies**: none
- **Description**: Clear description of what needs to be done. Reference the requirements doc for detail.
- **Verification**: A specific, testable check to confirm the task is complete.

### TASK-002: Another task
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: This task depends on TASK-001 completing first.
- **Verification**: Run "npm test" and all tests pass.
```

### Task Rules

- Task IDs must be sequential: TASK-001, TASK-002, TASK-003, etc. For larger tasks that need to be broken down, use letter suffixes: TASK-001a, TASK-001b, etc.
- **Tasks must be small and focused** — each should be completable by an automated AI agent in approximately 10-20 minutes. If a task would take longer, break it into smaller subtasks using letter suffixes. Large tasks will time out and fail.
- Status must always be `pending` for new tasks
- Dependencies: `none` or comma-separated task IDs (e.g., `TASK-001, TASK-002`)
- Descriptions should be clear and actionable
- **Every task MUST have a Verification field** with a specific, **targeted** check. Run only the tests relevant to the task, NOT the full test suite. Examples:
  - Good: `npm test -- --grep "calculator"` or `npx jest src/calc.test.ts`
  - Bad: `npm test` (runs everything — slow, may fail for unrelated reasons)
  - Good: `tsc --noEmit src/calc.ts` (type-check just the changed file)
  - Bad: `tsc --noEmit` (type-checks entire project)
- **Do NOT create any files other than requirements.md and tasks.md** — no source code, no config files, no project scaffolding

After writing both documents, tell the user they need to exit this Claude session (Ctrl+C or /exit) to continue — DevLoop will commit the files and set up the workspace for task execution with "devloop run".

## Prior Work (Iteration 1)

The following work was completed in a previous iteration. Use this context to inform the new plan.

**Build on the existing codebase. Do NOT re-implement completed work unless the user requests changes.**

### Previous Requirements

```markdown
# UX Analysis Reporter — Iteration 2 Requirements

## Overview

This iteration addresses bugs, code quality issues, and configuration mismatches identified in the post-iteration-1 code review. No new features are added. The goal is to harden the existing codebase for production readiness.

All changes build on the existing codebase. The prior iteration produced a fully functional tool with 628 tests and 96.54% coverage. This iteration fixes specific issues without altering the tool's architecture or behavior.

---

## Changes

### 1. Rename output report file

**Problem:** `src/orchestrator.ts` (line ~175) writes the final consolidated report as `consolidated-report.md`. The requirements specification and README both document the output filename as `report.md`. Users following the docs will look for `report.md` and not find it.

**Fix:** Change the output filename string from `consolidated-report.md` to `report.md` in the orchestrator. Update any tests that assert on the old filename.

**Scope:** `src/orchestrator.ts`, affected test files.

---

### 2. Add `files` field to `package.json`

**Problem:** Without a `files` field or `.npmignore`, running `npm publish` ships everything in the repo — test fixtures, `.devloop/`, internal docs, debug logs. This bloats the published package and could expose internal files.

**Fix:** Add a `files` array to `package.json` that restricts published contents to:
- `dist/`
- `README.md`
- `LICENSE`

**Scope:** `package.json` only.

---

### 3. Remove `shell: true` from Claude CLI spawn

**Problem:** `src/claude-cli.ts` (line ~40) spawns the Claude CLI subprocess with `shell: true`. This routes the subprocess through the system shell, which is unnecessary since `claude` can be invoked directly. The `shell: true` option introduces a theoretical command injection surface (though the actual risk is minimal since prompts go via stdin). More importantly, `shell: true` prevents direct PID control over the child process, which is needed for the signal handling work in change #4.

**Fix:** Remove the `shell: true` option from the `spawn`/`execFile` call. Ensure the `claude` command is resolved correctly without a shell wrapper on both Windows and Unix. Update tests if they depend on shell behavior.

**Scope:** `src/claude-cli.ts`, affected test files.

---

### 4. Add SIGINT/SIGTERM handler for child process cleanup

**Problem:** If the user hits Ctrl+C while the tool is running, spawned Claude Code subprocesses become orphaned and continue consuming API quota. The `finally` block in the orchestrator's `orchestrate` function only stops the progress display timer — it does not terminate child processes.

**Fix:** Register process signal handlers (`SIGINT`, `SIGTERM`) in the orchestrator that:
1. Kill all tracked child processes (using the PIDs now available after removing `shell: true` in change #3)
2. Stop the progress display
3. Clean up gracefully before exiting

The orchestrator or instance manager needs to maintain a registry of active child process references so the signal handler can iterate and kill them. On Windows, use `process.kill(pid)` or `child.kill()`. Ensure the handler runs before the process exits.

**Scope:** `src/orchestrator.ts`, `src/instance-manager.ts` (or `src/claude-cli.ts` depending on where process refs are tracked), new tests for signal handling behavior.

---

### 5. Raise coverage thresholds to 95%

**Problem:** `vitest.config.ts` sets all coverage thresholds (statements, branches, functions, lines) to 80%, which is the hard minimum from the original requirements. The actual coverage is 96.54%. The user wants the threshold raised to 95% to prevent regression.

**Fix:** Change all four threshold values in `vitest.config.ts` from 80 to 95.

**Scope:** `vitest.config.ts` only.

---

### 6. Post-run temp directory cleanup with `--keep-temp` flag

**Problem:** The `.uxreview-temp/` working directory persists after a run completes. It is only cleaned up at the start of the *next* run. This leaves intermediate data (discovery docs, checkpoints, instance reports, screenshots) on disk between runs.

**Fix:**
1. Add a `--keep-temp` CLI flag (boolean, default `false`). When false (the default), the temp directory is deleted after the run completes. When true, the temp directory is preserved for debugging.
2. Add `cleanupTempDir()` to the `finally` block in the orchestrator's `orchestrate` function, gated on the `--keep-temp` flag.
3. Update CLI argument parsing to accept `--keep-temp`.
4. Update the README to document the new flag.
5. Update tests to cover both behaviors.

**Scope:** `src/cli.ts`, `src/orchestrator.ts`, `src/file-manager.ts`, README, affected test files.

---

### 7. Remove `placeholder.test.ts`

**Problem:** A no-op placeholder test file still exists from initial project scaffolding. It serves no purpose now that 628 real tests exist.

**Fix:** Delete the file.

**Scope:** The placeholder test file (likely `tests/placeholder.test.ts` or similar).

---

### 8. Refactor duplicated rate-limit retry logic

**Problem:** `src/instance-manager.ts` contains two nearly identical rate-limit retry loops (lines ~345-364 and ~396-415). This duplication means:
- The two paths could diverge in behavior if one is updated and the other isn't
- In the worst case, the nested loops can produce up to 30 retry attempts (10 rate-limit retries x 3 normal retries)
- The code is harder to reason about

**Fix:** Extract the rate-limit detection and exponential backoff logic into a shared helper function (either in `src/rate-limit.ts` or as a private function in `src/instance-manager.ts`). Both call sites should use the shared helper. The total retry behavior should be well-defined: rate-limit retries should be counted globally across the instance's execution, not reset per normal retry attempt.

**Scope:** `src/instance-manager.ts`, possibly `src/rate-limit.ts`, affected test files.

---

### 9. Fix spin-wait busy loop in file-manager.ts

**Problem:** `src/file-manager.ts` (lines ~73-74) uses a synchronous busy-wait loop (`while (Date.now() - start < delay) { /* spin */ }`) for Windows file lock retry during temp directory cleanup. This blocks the Node.js event loop entirely during the wait, preventing any async work from progressing.

**Fix:** Make `cleanupTempDir` async and replace the spin-wait with an async delay (e.g., `await new Promise(resolve => setTimeout(resolve, delay))`). Update all callers to await the async function. If `cleanupTempDir` is called in contexts where it must be synchronous (e.g., a `finally` block that can't be async), evaluate whether those contexts can be made async or whether a different approach is needed.

**Scope:** `src/file-manager.ts`, callers of `cleanupTempDir`, affected test files.

---

### 10. Fix child finding indentation bug in consolidation

**Problem:** `src/consolidation.ts` (lines ~698-699) uses `split('\n').map(l => l ? '  ' + l : l).join('\n')` to indent child finding metadata in the hierarchical report. The truthy check on `l` skips blank lines, so the empty line between the heading and metadata block is not indented. This produces inconsistent indentation in the final report where child findings have some lines indented and some not.

**Fix:** Change the indentation logic to indent all lines uniformly, including blank lines. For example: `.map(l => '  ' + l)` or handle the blank-line case explicitly if trailing whitespace on blank lines is undesirable.

**Scope:** `src/consolidation.ts`, affected test files.

---

## Testing Strategy

All changes must maintain or improve the existing 96.54% coverage. The new enforced threshold is 95%.

- Changes #1, #2, #5, #7, #10 are small/trivial and primarily require updating existing tests to match new behavior.
- Changes #3, #4 require new tests for subprocess spawning without shell and signal handling behavior.
- Change #6 requires tests for both `--keep-temp true` and default (false) paths.
- Change #8 requires updating rate-limit retry tests to use the refactored helper and verify global retry counting.
- Change #9 requires updating file-manager tests for async cleanup behavior.

All existing tests must continue to pass after the changes.

---

## Out of Scope

The following item from the review was explicitly excluded from this iteration:

- **Rate-limit handling in consolidation phase** — Skipped per user decision. The consolidation phase runs after instances complete, when API load is typically lower.

The following review recommendations are deferred to a future iteration:

- Streaming progress from Claude instances
- Incremental output (append to existing output directory)
- Configurable retry limits and timeouts as CLI options
- HTML report output
- Finding severity filtering
- Claude Agent SDK migration
- Structured IPC (replacing file-based communication)
- Parallel hierarchy determination
- Async file I/O throughout
- Structured logging / `--verbose` flag

```

### Previous Tasks (11 tasks)

- TASK-001: Rename output report file from consolidated-report.md to report.md
- TASK-002: Add files field to package.json
- TASK-003: Remove shell: true from Claude CLI spawn
- TASK-004: Add child process registry to instance manager
- TASK-005: Add SIGINT/SIGTERM handler in orchestrator
- TASK-006: Raise coverage thresholds to 95%
- TASK-007: Add --keep-temp CLI flag and post-run cleanup
- TASK-008: Remove placeholder.test.ts
- TASK-009: Make cleanupTempDir async and fix spin-wait busy loop
- TASK-010: Refactor duplicated rate-limit retry logic
- TASK-011: Fix child finding indentation bug in consolidation

### Review & Recommendations

The following review was generated after the previous iteration completed. Use these findings and recommendations to guide the next iteration.

```markdown
# Code Review Report — UX Analysis Reporter (Iteration 2)

**Date**: 2026-04-07
**Reviewer**: Claude (automated review)
**Branch**: master
**Scope**: Full codebase review after iteration 2 completion (all 11 tasks done)

---

## Requirements vs Implementation

### Iteration 2 Requirements — All Met

All 10 changes from the iteration 2 requirements document have been implemented and verified:

| # | Requirement | Status | Notes |
|---|------------|--------|-------|
| 1 | Rename output report file to `report.md` | **Done** | `orchestrator.ts:185` writes `report.md`. No references to `consolidated-report.md` remain. |
| 2 | Add `files` field to `package.json` | **Done** | `["dist/", "README.md", "LICENSE"]` restricts published contents. |
| 3 | Remove `shell: true` from Claude CLI spawn | **Done** | `claude-cli.ts:63` spawns directly with `spawn(command, args, ...)`. Platform detection uses `claude.cmd` on Windows. |
| 4 | Add SIGINT/SIGTERM handler for child process cleanup | **Done** | `orchestrator.ts:122-128` registers handlers; `claude-cli.ts:4-19` maintains active process registry with `killAllChildProcesses()`. Handlers removed in `finally` block. |
| 5 | Raise coverage thresholds to 95% | **Done** | `vitest.config.ts` sets all four thresholds to 95. |
| 6 | Post-run temp directory cleanup with `--keep-temp` | **Done** | `cli.ts:86,178` parses the flag; `orchestrator.ts:199-201` conditionally cleans up in `finally`. README documents the flag. |
| 7 | Remove `placeholder.test.ts` | **Done** | No placeholder test file exists in the project. |
| 8 | Refactor duplicated rate-limit retry logic | **Done** | `instance-manager.ts:311-336` contains the shared `handleRateLimitRetries()` helper. Both the initial spawn and normal retry paths use it with a shared `RateLimitRetryState` for global retry counting. |
| 9 | Fix spin-wait busy loop in `file-manager.ts` | **Done** | `cleanupTempDir()` is now `async`, uses `await new Promise(resolve => setTimeout(resolve, delay))` for retry delays. All callers (`initTempDir`, `orchestrate` finally block) properly `await` it. |
| 10 | Fix child finding indentation bug in consolidation | **Done** | `consolidation.ts:699` uses `.map(l => \`  \${l}\`)` which uniformly indents all lines including blank separators. |

### Original Requirements (Iteration 1) — Verified

All original requirements from the iteration 1 spec remain correctly implemented:

- **CLI argument parsing**: All parameters parsed, validated, and documented. File-vs-inline detection works via `resolveTextOrFile()`. Unknown flags rejected.
- **Default evaluation scope**: All 10 UX criteria present in `src/default-scope.ts`.
- **File organization**: `.uxreview-temp/` and output directory structures match spec.
- **Claude Code CLI utility**: Subprocess spawning without shell, stdin prompt passing, stdout/stderr capture, timeout handling, process registry.
- **Work distribution**: Single-instance bypass, multi-instance Claude-based splitting with `---CHUNK---` delimiter.
- **Instance spawning**: 30-minute timeout, `--allowedTools` restriction, per-instance working directories.
- **Checkpoint system**: JSON schema with validation, corruption handling (returns null), resume prompt generation.
- **Discovery documents**: Structured markdown format, round accumulation, parsing, extraction for progress recalibration.
- **Per-instance reports**: Instance-scoped IDs (`I{N}-UXR-{NNN}`), severity validation, markdown format.
- **Screenshot integration**: Naming convention with alphabetic suffixes, capture instructions for Claude.
- **Multi-round execution**: Round 2+ includes discovery context, progress scale recalibration from discovery items.
- **Failure detection, retry, resume**: Checkpoint-based resume, corrupted checkpoint fallback, max retry limit (default 3), permanent failure marking.
- **Progress display**: Per-instance progress bars with round tracking, percentage, stats, ETA, color states (white/red/green/yellow), consolidation spinner.
- **Report consolidation**: Deduplication via Claude, ID reassignment (`UXR-{NNN}`), screenshot remapping/copying, hierarchical grouping by UI area.
- **Discovery consolidation**: Merging via Claude, hierarchical restructuring, single-doc fallback.
- **Parallel orchestration**: `Promise.allSettled` for independent failure handling.
- **Rate limit handling**: Pattern-based detection, exponential backoff with jitter, global retry budget across rounds.
- **README**: Comprehensive with examples, prerequisites, installation, scope customization, discovery reuse workflow, `--keep-temp` documentation.

### Scope Creep

No scope creep detected. The iteration 2 changes are strictly limited to the 10 items in the requirements document. No unnecessary features, refactors, or abstractions were added.

### Explicitly Excluded Items (Documented)

The following were intentionally excluded from iteration 2 per the requirements document:

- Rate-limit handling in the consolidation phase (3 Claude calls without backoff)
- Streaming progress from Claude instances
- Incremental output / append-to-existing mode
- Configurable retry limits and timeouts as CLI options
- HTML report output
- Finding severity filtering
- Claude Agent SDK migration
- Structured IPC (replacing file-based communication)
- Parallel hierarchy determination
- Full async file I/O
- Structured logging / `--verbose` flag

---

## Code Quality

### Architecture

The codebase is well-structured with clean separation of concerns across 15 focused source modules:

| Module | Responsibility | Lines |
|--------|---------------|-------|
| `index.ts` | Entry point, arg parsing, error handling | ~12 |
| `cli.ts` | CLI argument parsing and validation | ~181 |
| `claude-cli.ts` | Claude Code subprocess management | ~115 |
| `orchestrator.ts` | Top-level orchestration flow | ~203 |
| `instance-manager.ts` | Instance spawning, rounds, retries | ~487 |
| `work-distribution.ts` | Plan splitting across instances | ~126 |
| `file-manager.ts` | Directory management, cleanup | ~133 |
| `checkpoint.ts` | Checkpoint read/write/resume | ~125 |
| `discovery.ts` | Discovery document management | ~349 |
| `report.ts` | Finding report management | ~254 |
| `consolidation.ts` | Dedup, ID reassignment, hierarchy | ~848 |
| `screenshots.ts` | Screenshot naming and listing | ~119 |
| `rate-limit.ts` | Rate limit detection and backoff | ~64 |
| `progress-display.ts` | Terminal progress UI | ~379 |
| `default-scope.ts` | Built-in evaluation criteria | ~78 |

The data flow is clear: CLI -> orchestrator -> work distribution -> parallel instance execution -> consolidation -> output. Each module has a well-defined interface. The `Promise.allSettled` pattern in the orchestrator ensures one instance failure doesn't cascade.

### Bugs and Logic Issues

| # | Location | Issue | Severity |
|---|----------|-------|----------|
| 1 | `package.json:9` | **Missing LICENSE file**: The `files` field includes `"LICENSE"` but no LICENSE file exists at the project root. `npm pack --dry-run` will list it, but the published package will be missing the license file. | Medium |
| 2 | `orchestrator.ts:110-114` | **Workspace leak on early failure**: `initWorkspace()` and `distributePlan()` are called before the `try` block (line 132). If `distributePlan()` throws (e.g., Claude CLI failure), the created workspace directories are never cleaned up because the `finally` block only runs for code inside `try`. | Low |
| 3 | `consolidation.ts:699` | **Trailing whitespace on blank lines**: The indentation fix `formatFindingMetadata(child).split('\n').map(l => \`  \${l}\`).join('\n')` produces `"  "` (two spaces) on blank separator lines in the hierarchical report. This is cosmetically fine in markdown rendering, but some linters or editors will flag trailing whitespace. | Info |
| 4 | `consolidation.ts:650-659` | **Sequential hierarchy determination**: `organizeHierarchically()` calls Claude once per UI area group in a sequential `for...of` loop. With many UI areas, this creates a serial bottleneck. These calls are independent and could be parallelized with `Promise.all`. | Low |
| 5 | `consolidation.ts:372-379` | **Screenshot suffix limited to 26**: `buildNewScreenshotFilenames()` uses `String.fromCharCode(96 + i)` for suffixes, which only supports 26 screenshots per finding (a-z). A finding with 27+ screenshots would produce non-alphabetic characters. Extremely unlikely in practice, but undocumented. | Info |
| 6 | `cli.ts:177` | **Output flag cast**: `(raw.get('output') as string)` — the `as string` cast is safe because `parseRawArgs` ensures non-boolean flags have string values, but the cast obscures this safety guarantee. A runtime check would be clearer. | Info |

### Error Handling

Error handling is thorough and well-considered:

- **Checkpoint corruption**: Returns `null`, triggering round restart from scratch. Tested with both invalid JSON and valid JSON with missing fields.
- **Claude CLI failures**: Throw descriptive errors with exit codes and stderr content. Work distribution and deduplication failures propagate with context.
- **File I/O**: Discovery and report reads use try/catch, return null on failure. Checkpoint reads validate field types.
- **Promise rejections**: `Promise.allSettled` prevents one instance crash from killing others. Rejected promises are caught and converted to permanent failure results.
- **Hierarchy determination**: Falls back to flat structure (all top-level) if Claude fails — good graceful degradation.
- **Signal handling**: SIGINT/SIGTERM handlers kill all child processes, stop the progress display, and exit with correct codes (130/143). Handlers are properly deregistered in the `finally` block to avoid leaks.
- **Rate limit handling**: Global retry budget shared across rounds and normal retries. Clear separation between rate-limit retries (don't count against normal limit) and normal retries.

One gap: If `initWorkspace` succeeds but `distributePlan` fails, the `finally` block doesn't execute, leaving stale workspace directories. This would be cleaned up on the next run (since `initTempDir` calls `cleanupTempDir` first), but is a minor leak.

### Security

| # | Issue | Risk | Details |
|---|-------|------|---------|
| 1 | `shell: true` removed | **Resolved** | The iteration 1 concern about command injection via `shell: true` has been addressed. `claude-cli.ts` now spawns the process directly. |
| 2 | `resolveTextOrFile` reads any file | Info | The `--intro`, `--plan`, and `--scope` parameters can read any file the user has access to. Expected for a CLI tool, but worth noting if ever exposed as a service. No size limit on file reads. |
| 3 | `files` field in `package.json` | **Resolved** | Test fixtures, `.devloop/`, and internal files are now excluded from `npm publish`. |
| 4 | Prompt injection surface | Info | User-provided intro, plan, and scope text are interpolated directly into Claude prompts. A malicious user could craft inputs to manipulate Claude's behavior. This is inherent to the tool's design and acceptable for a CLI tool where the user controls all inputs. |

### Code Style and Consistency

- TypeScript strict mode is enabled with comprehensive compiler options.
- ESM modules used consistently (`"type": "module"` in package.json, `.js` extensions in imports).
- Functions are well-documented with JSDoc comments explaining purpose, parameters, and behavior.
- Consistent error message formatting across modules.
- No dead code or unused imports observed.
- The re-export pattern in `instance-manager.ts:2` (`export { killAllChildProcesses, getActiveProcessCount }` from `claude-cli.js`) keeps the orchestrator's import clean but adds an indirect layer. Acceptable given the module boundary design.

---

## Testing

### Coverage

The test suite consists of 26 test files (excluding `e2e.test.ts` from coverage):

| Category | Files | Description |
|----------|-------|-------------|
| Unit tests | 12 | Individual module tests (checkpoint, claude-cli, cli, consolidation, discovery, file-manager, progress-display, rate-limit, report, screenshots, work-distribution) |
| Round execution | 3 | Multi-round, retry, progress recalibration |
| Integration tests | 5 | Happy path, multi-instance, dedup/consolidation, edge cases, failure/retry |
| Coverage/verification | 3 | Coverage gaps, task verification |
| E2E | 1 | Full tool run with real Claude instances |

Coverage thresholds are set to 95% for statements, branches, functions, and lines. The previous iteration measured 96.54% coverage, and the iteration 2 changes (async cleanup, refactored rate-limit logic, signal handling) all have corresponding tests.

### Test Quality — Strengths

1. **Clean mock isolation**: Tests mock `claude-cli.js` at the module level using `vi.mock()`, providing deterministic responses for each prompt type (analysis, hierarchy, discovery consolidation, deduplication).

2. **Realistic mock behavior**: Integration tests write actual files (discovery docs, reports, screenshots) as side effects of mock `runClaude` calls, exercising the full read-write-parse pipeline.

3. **Round-trip parsing tests**: Discovery and report modules have format -> write -> read -> parse tests that verify data integrity through the full cycle.

4. **Failure scenario coverage**: Thorough testing of crashes, timeouts, corrupted checkpoints, missing checkpoints, rate limits, max retry exhaustion, and mixed success/failure across instances.

5. **State transition verification**: Integration tests track the exact sequence of progress display state changes (running -> failed -> retrying -> running -> completed) to verify correct UI behavior.

6. **Global rate-limit budget tests**: Dedicated tests verify that rate-limit retries are counted globally across rounds and normal retries, preventing the 30-attempt worst case from iteration 1.

7. **E2E test**: Real end-to-end test with a fixture web app containing intentional UX issues, verifying the full pipeline produces valid output with real Claude instances.

8. **Test isolation**: Each test suite uses its own isolated temp directory (e.g., `.uxreview-integ-happy-test`, `.uxreview-temp-ratelimit-test`) with proper `beforeEach`/`afterEach` cleanup, preventing cross-test contamination.

### Test Quality — Gaps

| # | Gap | Impact |
|---|-----|--------|
| 1 | **No test for workspace leak on `distributePlan` failure** | Low — If `distributePlan` throws after `initWorkspace` but before the `try` block, the workspace isn't cleaned up. No test verifies this edge case. |
| 2 | **No test for very large plan inputs** | Low — No negative test for extremely large plan text or very high instance counts (e.g., `--instances 100`). The tool would work but might exhaust resources. |
| 3 | **No test for concurrent file access** | Low — The progress display polls checkpoint/report files on a 1-second interval. No test verifies behavior when a file is being written by a Claude instance while being read by the poll. In practice, partial reads would produce parse failures handled by the null-return paths. |
| 4 | **E2E test requires real Claude API access** | Expected — Cannot run in CI without credentials. The 45-minute timeout is appropriate but means the test is infrequently exercised. |
| 5 | **Mock prompt content not validated** | Low — Integration tests verify that mock `runClaude` is called with expected prompt fragments, but don't validate the complete prompt structure against what real Claude would understand. This is inherent to the mock-based testing approach. |
| 6 | **No test for `--show-default-scope` output** | Info — The `--show-default-scope` path calls `process.exit(0)` which makes it hard to test in-process. The `DEFAULT_SCOPE` constant is used directly, so the risk is minimal. |

### Test Infrastructure

- **Vitest** with V8 coverage provider — fast, native TypeScript support.
- **Separate E2E config** (`vitest.e2e.config.ts`) with 45-minute timeout, correctly excludes E2E from unit coverage.
- **E2E fixture server** (`tests/fixtures/e2e-app/server.ts`) — lightweight HTTP server with path traversal protection, random port assignment. 4 HTML pages with intentional UX issues spanning navigation, forms, listings, and detail views.
- **No external test dependencies** — all mocking uses Vitest's built-in `vi.mock()` and `vi.fn()`.

---

## Recommendations

### Must Fix

1. **Create a LICENSE file**: The `package.json` `files` field references `LICENSE`, but no LICENSE file exists at the project root. Since the package is MIT-licensed (`"license": "MIT"`), create a standard MIT LICENSE file. Without it, `npm publish` will warn about the missing file, and users won't have the actual license text.

### Should Fix

2. **Move `distributePlan` inside the `try` block**: In `orchestrator.ts`, `distributePlan()` is called before the `try` block (line 114). If it throws, the workspace directories created by `initWorkspace()` won't be cleaned up. Move the call inside the `try` block, or wrap the entire orchestration body in a single `try`/`finally` that ensures cleanup.

3. **Add rate-limit handling to consolidation phase**: The 3 Claude calls in consolidation (deduplication at `consolidation.ts:255`, hierarchy at `consolidation.ts:629`, discovery merge at `consolidation.ts:829`) have no rate-limit retry logic. Under heavy API load, these can fail. This was explicitly excluded from iteration 2, but should be addressed before production use. The shared `handleRateLimitRetries` helper from `instance-manager.ts` could be extracted to `rate-limit.ts` and reused here.

4. **Parallelize hierarchy determination**: `organizeHierarchically()` at `consolidation.ts:650-659` calls Claude sequentially for each UI area. These calls are independent and could use `Promise.all` for significant speedup on reports with many areas.

### Nice to Have

5. **Add `--verbose` flag for debug logging**: The tool has no structured logging. Adding a debug log level would aid troubleshooting without cluttering normal output. Log subprocess spawn/exit, file reads/writes, retry decisions, and timing data.

6. **Validate plan/intro file size**: `resolveTextOrFile()` reads entire files into memory without size limits. A guard (e.g., warn if >1MB, reject if >10MB) would prevent accidental misuse.

7. **Document the 26-screenshot suffix limit**: `buildNewScreenshotFilenames()` only supports 26 suffixes (a-z). Either document this limitation or extend the scheme (e.g., `aa`, `ab`, ...).

---

## Future Considerations

### Features and Improvements

- **Streaming progress from Claude instances**: Replace the 1-second file-polling interval with a structured channel (e.g., JSON lines on stderr) for more responsive progress updates.

- **Incremental output**: Allow appending to an existing output directory instead of always overwriting. This enables iterative refinement across multiple runs.

- **Configurable retry limits and timeouts**: Expose `--max-retries`, `--instance-timeout`, and `--rate-limit-retries` as CLI options. Different apps and API quotas may need different tuning.

- **HTML report output**: Add `--format html` for styled reports with embedded screenshots, making findings easier to share with non-technical stakeholders.

- **Finding severity filtering**: Add `--min-severity major` to exclude low-severity findings from the final report.

- **`--dry-run` mode**: Show the work distribution and instance prompts without actually running Claude. Useful for validating plans and scopes.

### Architectural Decisions to Revisit

- **Claude CLI subprocess model**: Each instance is a separate `claude -p` invocation with independent bootstrapping. As the tool scales, migrating to the Claude Agent SDK would enable shared context, token reuse, and finer-grained control over instance lifecycle.

- **File-based IPC**: Checkpoints, discovery docs, and reports are communicated via filesystem writes/reads. This introduces polling latency and potential read-during-write issues. A structured IPC mechanism (e.g., JSON-RPC over stdin/stdout) would be more robust at scale.

- **Synchronous file I/O in progress polling**: The `ProgressDisplay.updateFromFiles()` method does synchronous file reads (`readCheckpoint`, `readReportContent`) on every 1-second poll tick. This blocks the event loop briefly. Converting to async reads would improve responsiveness, especially with many instances.

- **Single-level hierarchy constraint**: The current hierarchy model (`consolidation.ts:529`) explicitly limits nesting to one level: "A finding cannot be both a parent and a child." For complex apps, deeper nesting might be valuable (e.g., page -> section -> component issues).

### Technical Debt

| Item | Location | Description |
|------|----------|-------------|
| Magic numbers | Multiple files | Instance timeout (30 min), default CLI timeout (5 min), poll interval (1 sec), max retries (3), rate limit retries (10), spinner frames — all hardcoded. Could be centralized in a config module. |
| No structured logging | Throughout | `console.error` in `index.ts` is the only error output. No debug-level logging for troubleshooting. |
| Sequential consolidation calls | `consolidation.ts:650-659` | `organizeHierarchically` calls Claude sequentially per UI area. Independent calls should be parallelized. |
| No consolidation rate-limit handling | `consolidation.ts:255,629,829` | Three Claude calls without backoff-retry logic. |
| Synchronous progress polling | `progress-display.ts:291-308` | `updateFromFiles` blocks the event loop with sync reads. |
| Screenshot suffix limit | `consolidation.ts:372-379` | Only supports 26 screenshots per finding (a-z suffixes). |
| Missing LICENSE file | Project root | `package.json` references it but it doesn't exist. |

---

## Summary

The project is in strong shape after iteration 2. All 10 iteration 2 requirements were implemented correctly, and the original iteration 1 functionality remains intact. The codebase demonstrates professional patterns:

- **Clean module architecture** with well-defined interfaces between 15 focused modules
- **Thorough error handling** with graceful degradation (checkpoint corruption, Claude failures, rate limits)
- **Strong test coverage** (95%+ threshold enforced) across 26 test files with unit, integration, and E2E coverage
- **Correct signal handling** for child process cleanup on SIGINT/SIGTERM
- **Refactored rate-limit logic** with global retry budget preventing the 30-attempt worst case

The main items to address before production use:

1. **Create the missing LICENSE file** (required for npm publish)
2. **Fix the workspace leak** when `distributePlan` fails before the `try` block
3. **Add rate-limit handling to consolidation** (3 unprotected Claude calls)

None of these are blocking for development or testing use, but items 1 and 2 should be addressed before publishing the package.

```

