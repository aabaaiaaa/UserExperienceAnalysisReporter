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
