# UX Analysis Reporter — Iteration 4 Requirements

## Overview

This iteration addresses all bugs and technical debt identified in the iteration 3 code review. There are no new features — the focus is entirely on fixing broken behavior, eliminating dead code, and improving code quality.

All changes build on the existing codebase. The prior iteration produced a fully functional tool with 835 of 840 tests passing across 32 test files. This iteration fixes the 5 failing tests, resolves a critical design flaw in resume-across-runs, fixes signal handler cleanup, adds rate-limit handling to consolidation, and performs several small code quality improvements.

---

## Bug Fixes

### 1. Fix 5 failing tests

**Problem:** After iteration 3, 5 tests fail due to stale API references:

- `tests/progress-recalibration.test.ts` — Multiple tests call `display.updateFromFiles(1)`, a method removed in TASK-012b when file-polling was replaced with event-driven progress via `updateProgress()`. Call sites at lines 128, 229, 262, 291, 308, 326, 354, 375.

- `tests/integration-dedup-consolidation.test.ts:1110` — Asserts `parent.children[0].id` instead of `parent.children[0].finding.id`. TASK-016a changed `HierarchicalFinding.children` from `Finding[]` to `HierarchicalFinding[]`.

- `tests/integration-dedup-consolidation.test.ts:1130-1152` — The `formatConsolidatedReport` test constructs children as raw `Finding` objects instead of `HierarchicalFinding` objects (which have `{ finding, children }` shape), causing a TypeError in the recursive renderer.

**Fix:**
- In `progress-recalibration.test.ts`: Replace all `display.updateFromFiles(N)` calls with the equivalent `display.updateProgress(instanceNumber, completedItems, inProgressItems, totalItems, findingsCount)` calls, using data derived from the mock checkpoint that each test sets up.
- In `integration-dedup-consolidation.test.ts:1110`: Change `parent.children[0].id` to `parent.children[0].finding.id`.
- In `integration-dedup-consolidation.test.ts:1130-1152`: Wrap each child in the `children` array as `{ finding: { ... }, children: [] }` to match the `HierarchicalFinding` interface.

**Testing:** All 5 previously failing tests pass. Full test suite passes.

---

### 2. Fix resume-across-runs design flaw

**Problem:** `initTempDir()` in `file-manager.ts:84-102` unconditionally calls `cleanupTempDir()` (line 89) before creating the temp directory structure. This wipes the entire `.uxreview-temp/` directory, including any consolidation checkpoint from a previous interrupted run. The orchestrator calls `initWorkspace()` (which calls `initTempDir()`) unconditionally at line 139.

This means re-running the command after an interruption always starts fresh — the consolidation checkpoint written by the previous run is destroyed before it can be read. The "Recovery and Resumption" section in the README documents behavior that cannot occur in practice.

**Fix:** Modify `initTempDir()` to detect and preserve existing checkpoint data before cleaning:

1. Before cleaning, check for `consolidation-checkpoint.json` and instance checkpoint files in `.uxreview-temp/`.
2. If checkpoint data exists, preserve it. Only clean directories for instances that will be re-initialized — do not wipe checkpoint files or completed instance output.
3. If no checkpoint data exists, clean as before (fresh run).
4. Update the orchestrator to detect a resumed run and log accordingly when verbose mode is enabled.
5. Update the README's "Recovery and Resumption" section if any documented behavior changes.

**Testing:** Add an integration test that simulates an interrupted run followed by a restart, verifying that checkpoint data survives the restart and consolidation resumes from the correct step.

---

### 3. Fix signal handler bypassing `finally` block

**Problem:** In `orchestrator.ts:147-151`, the SIGINT/SIGTERM signal handler calls `process.exit(130/143)` directly. `process.exit()` does not execute the `finally` block at line 388. This means:
- Signal listeners are not deregistered (lines 389-390)
- The progress display is not stopped (line 391)
- Temp directory cleanup never runs on interrupt, even when `--keep-temp` is false (lines 392-394)

Users accumulate `.uxreview-temp/` directories across interrupted runs.

**Fix:** Replace `process.exit()` with a flag-based approach:
1. In the signal handler, kill child processes, stop the display, and set `process.exitCode` to 130 (SIGINT) or 143 (SIGTERM).
2. Instead of calling `process.exit()`, allow the promise chain to unwind naturally so the `finally` block executes.
3. The `finally` block already handles listener removal, display stop, and temp cleanup — let it do its job.
4. The orchestrator's main async function should check the signal flag and reject/return early so the `try` block exits and `finally` runs.

**Testing:** Add a test that verifies the `finally` block executes when a signal is received (listeners removed, temp cleaned up when `--keep-temp` is false).

---

### 4. Add rate-limit retry handling to consolidation Claude calls

**Problem:** The 3+ Claude calls during consolidation (deduplication at `consolidation.ts:254`, hierarchy per area at `consolidation.ts:882`, discovery merge at `consolidation.ts:857`) have no rate-limit retry logic. Under heavy API load, these can fail and waste all the analysis work done by the instances. The `handleRateLimitRetries` helper exists in `instance-manager.ts:323` but is tightly coupled to instance state.

**Fix:**
1. Extract a general-purpose rate-limit retry utility from `instance-manager.ts` into `rate-limit.ts` (or a new shared module). The utility should accept a function to retry and the max retry count, and apply exponential backoff with jitter (reusing the existing `calculateBackoff` function from `rate-limit.ts`).
2. Apply the retry wrapper to all consolidation Claude calls: dedup, hierarchy determination (each area call), and discovery merge.
3. The instance manager's `handleRateLimitRetries` should be refactored to use the shared utility internally.
4. Use the `RATE_LIMIT_RETRIES` config value as the default retry limit.

**Testing:** Test that consolidation Claude calls retry on rate-limit errors. Test that the retry budget is respected. Existing instance manager rate-limit tests should continue to pass.

---

### 5. Add code comment explaining sequential consolidation

**Problem:** The `for...of` loop in `organizeHierarchically()` (`consolidation.ts:882`) processes UI area groups sequentially. Reviews have repeatedly suggested parallelizing these calls with `Promise.all`. This is incorrect — consolidation involves multiple Claude instances touching shared files and parallelizing creates race conditions. The sequential nature is intentional but not documented in code.

**Fix:** Add a clear code comment above the `for...of` loop in `organizeHierarchically()` explaining:
- The loop is intentionally sequential
- Parallelizing would create race conditions with multiple Claude instances touching shared files
- The consolidation phase is short and does not benefit from parallelism

**Testing:** No tests needed — comment only.

---

## Code Quality Cleanup

### 6. Remove deprecated `POLL_INTERVAL_MS` from config

**Problem:** `config.ts:36` exports `POLL_INTERVAL_MS`, marked as `@deprecated` with a note to use `RENDER_INTERVAL_MS` instead. No file in the codebase imports `POLL_INTERVAL_MS`. It is dead code.

**Fix:** Remove the `POLL_INTERVAL_MS` export from `config.ts`.

**Testing:** Verify no imports reference `POLL_INTERVAL_MS`. Existing tests pass.

---

### 7. Deduplicate `countFindings` function

**Problem:** An identical `countFindings` function exists in both `instance-manager.ts:356` and `progress-display.ts:95`. Same regex pattern, same logic. The `progress-display.ts` version is exported but unused externally. The `instance-manager.ts` version is private.

**Fix:** Move `countFindings` to a shared location (e.g., `report.ts`, which already deals with finding/report logic). Export it from there. Update both `instance-manager.ts` and `progress-display.ts` to import from the shared location. Remove the duplicate definitions.

**Testing:** Existing tests that exercise `countFindings` behavior continue to pass. Verify with grep that no duplicate definitions remain.

---

### 8. Clean up backward-compat re-exports in `rate-limit.ts`

**Problem:** `rate-limit.ts:3-5,10` imports and re-exports `DEFAULT_BASE_DELAY_MS`, `MAX_BACKOFF_DELAY_MS`, and `MAX_RATE_LIMIT_RETRIES` from `config.ts`. All source files have been migrated to import from `config.ts` directly. The only remaining consumers of the re-exports are test files.

**Fix:** Update test file imports to reference `config.ts` (or the config module path) directly. Then remove the re-exports from `rate-limit.ts`. The module should still import these values for its own internal use (e.g., `calculateBackoff` default parameters at line 49-50) but not re-export them.

**Testing:** All existing tests pass with updated imports.

---

### 9. Enforce 26-screenshot limit in code

**Problem:** `buildNewScreenshotFilenames()` in `consolidation.ts:372-379` uses `String.fromCharCode(96 + i)` for suffixes (a-z), supporting only 26 screenshots per finding. The limit is documented in the README but not enforced in code. A finding with 27+ screenshots would produce non-alphabetic characters (`{`, `|`, etc.) that could break filename validation.

**Fix:** Add a guard at the top of `buildNewScreenshotFilenames()` that throws an error if count exceeds 26.

**Testing:** Test that calling `buildNewScreenshotFilenames` with count > 26 throws. Test that count = 26 works (boundary). Existing screenshot tests pass.

---

## Testing Strategy

All changes must maintain the 95% coverage threshold enforced by `vitest.config.ts`.

- **Test fixes (#1):** Update stale test references. Target: full suite green.
- **Resume fix (#2):** Integration test for cross-run resume.
- **Signal handler (#3):** Test that `finally` executes on signal.
- **Rate-limit in consolidation (#4):** Test retry behavior for consolidation calls.
- **Sequential comment (#5):** No tests.
- **Dead export (#6):** No new tests — grep verification only.
- **Dedup function (#7):** Existing tests pass with new import paths.
- **Re-export cleanup (#8):** Existing tests pass with updated imports.
- **Screenshot guard (#9):** Boundary and overflow tests.

---

## Dependencies Between Changes

- **#1 (fix failing tests) should be first** — establishes a green test baseline before making further changes.
- **#8 (re-export cleanup) before #4 (rate-limit in consolidation)** — both touch `rate-limit.ts`, cleaner to do the cleanup first then add the shared retry utility.
- **All other changes are independent** and can be done in any order after #1.

---

## Out of Scope

The following are deferred to future iterations:
- Finding severity filtering (`--min-severity`)
- Claude Agent SDK migration
- Structured IPC (replacing file-based communication)
- Report diffing for `--append` mode
- Consolidation as a separate CLI subcommand
