# UX Analysis Reporter — Iteration 8 Requirements

## Overview

This iteration stabilizes the iteration 7 codebase: fixing a functional bug in the plan subcommand's prompt wiring, closing the test coverage gap, fixing a Windows-specific test failure, and extracting duplicated code from the two orchestrator modules into shared utilities.

No new features are added. All changes are bug fixes, test coverage, consistency fixes, and refactoring.

The prior iteration left the project at 980/981 tests passing across 39 test files (1 ENOTEMPTY test failure on Windows) with 96.89% statement coverage but 94.86% branch coverage — below the 95% threshold, primarily due to `plan-orchestrator.ts` at 82% statement / 64.7% function / 80% branch coverage.

---

## Item 0: Wire `buildDiscoveryPrompt` into plan orchestrator instance spawning

### Problem

`buildDiscoveryPrompt()` is exported from `instance-manager.ts:144` but is **never called anywhere in the codebase**. The plan orchestrator calls `runInstanceRounds()`, which internally calls `spawnInstance()`, which hardcodes `buildInstancePrompt(config)` at line 233. This means `uxreview plan` sends Claude the full analysis/findings prompt instead of the discovery-only prompt.

This is a functional bug — the plan subcommand's entire purpose is discovery-only exploration, but instances receive report-writing instructions they shouldn't.

### Fix

Add an optional `promptBuilder` field to `RoundExecutionConfig`:

```typescript
export interface RoundExecutionConfig {
  // ... existing fields ...
  /** Custom prompt builder function. Defaults to buildInstancePrompt. */
  promptBuilder?: (config: InstanceConfig) => string;
}
```

In `runInstanceRounds()` (line 529), pass the `promptBuilder` through when constructing the `InstanceConfig` and spawning. The simplest approach: add the same optional field to `InstanceConfig`, and modify `spawnInstance()` line 233 to use it:

```typescript
const prompt = config.promptBuilder?.(config) ?? buildInstancePrompt(config);
```

The plan orchestrator then passes `buildDiscoveryPrompt` in its `RoundExecutionConfig`:

```typescript
const configs: RoundExecutionConfig[] = chunks.map((chunk, i) => ({
  // ... existing fields ...
  promptBuilder: buildDiscoveryPrompt,
}));
```

The main orchestrator needs no changes — it doesn't set `promptBuilder`, so it defaults to `buildInstancePrompt` as before.

### Verification

Targeted test: mock `runClaude` and spawn an instance with `promptBuilder: buildDiscoveryPrompt`. Verify the prompt passed to `runClaude` contains discovery-only language ("UX explorer", "Areas to Explore") and does NOT contain analysis language ("report", "findings", "severity"). Run only the instance-manager and plan-orchestrator tests.

---

## Item 1: Raise `plan-orchestrator.ts` test coverage to 95%+

### Problem

`plan-orchestrator.ts` has 82% statement, 64.7% function, and 80% branch coverage. This pulls the project below the 95% branch coverage threshold (currently at 94.86%).

### Uncovered paths (from the review)

- `copyScreenshotsToOutput()` (lines 88-116) — both with and without screenshots present
- Dry-run output details (lines 200-228) — verify printed content
- Browser open logic (lines 336-343) — verify `exec` is called with correct platform command
- Error paths: all-instances-failed scenario (see Item 5), consolidation failure
- Signal handling branches not covered by existing tests

### Fix

Add tests to `tests/plan-orchestrator.test.ts` covering each uncovered path. Tests should use mocks for filesystem operations, `exec`, and Claude calls — same patterns used in the existing test file.

**Important:** Some of these paths will be moved by the refactoring in Items 4 and 6 (e.g., browser open logic moves to `browser-open.ts`, `buildProgressCallback` moves to `progress-callbacks.ts`). Write tests for the *new* locations after the refactoring is done. Tests for paths that stay in `plan-orchestrator.ts` (dry-run details, `copyScreenshotsToOutput`, all-instances-failed) should target plan-orchestrator directly.

### Verification

Run `npx vitest run --coverage` and confirm:
- `plan-orchestrator.ts` is at 95%+ statement, branch, and function coverage
- Overall project branch coverage is at 95%+
- No new test failures

---

## Item 2: Fix `cleanupTempDir()` to catch ENOTEMPTY

### Problem

`cleanupTempDir()` in `file-manager.ts:65-77` retries `rmSync` on EBUSY and EPERM but not ENOTEMPTY. On Windows, `rmSync` with `{ recursive: true }` can throw ENOTEMPTY when a directory isn't fully empty yet (race condition during deletion). This causes the sole test failure in the suite.

### Fix

Add ENOTEMPTY to the retryable error codes at `file-manager.ts:68-70`:

```typescript
const isLockError = err instanceof Error && 'code' in err &&
  ((err as NodeJS.ErrnoException).code === 'EBUSY' ||
   (err as NodeJS.ErrnoException).code === 'EPERM' ||
   (err as NodeJS.ErrnoException).code === 'ENOTEMPTY');
```

Consider renaming `isLockError` to `isRetryableError` since ENOTEMPTY is not a lock error — it's a race condition.

### Verification

Run `npx vitest run tests/file-manager.test.ts` — the previously failing test (`initTempDir > creates the temp directory structure for 3 instances`) should now pass. Add a targeted test verifying that `cleanupTempDir()` retries on ENOTEMPTY.

---

## Item 3: Add `debug()` logging to `discovery-html.ts` bare catch

### Problem

`listAllScreenshots()` in `discovery-html.ts:265-267` silently returns `[]` on `readdirSync` failure. This is the same pattern that was explicitly fixed in 3 other locations across iterations 5-7:
- `file-manager.ts` (iteration 5)
- `checkpoint.ts` (iteration 6)
- `consolidation-checkpoint.ts` and `safeStatMtimeMs` (iteration 7, items A2/A3)

### Fix

Change the catch block to capture the error and log it:

```typescript
} catch (err) {
  debug(`Failed to read screenshots directory ${screenshotsDir}: ${err}`);
  return [];
}
```

Import `debug` from `./logger.js` if not already imported (it is not currently imported in `discovery-html.ts`).

### Verification

Targeted test: mock `readdirSync` to throw, verify `listAllScreenshots()` returns `[]` and `debug()` is called with the error. Run only `npx vitest run tests/discovery-html.test.ts`.

---

## Item 4: Extract `buildProgressCallback()` to `progress-callbacks.ts`

### Problem

`buildProgressCallback()` is defined identically in both `plan-orchestrator.ts:40-79` and `orchestrator.ts:86-125`. The function wires `ProgressCallback` events to `ProgressDisplay` methods.

### Fix

Create a new module `src/progress-callbacks.ts` with the shared function:

```typescript
import { ProgressDisplay } from './progress-display.js';
import { ProgressCallback } from './instance-manager.js';

export function buildProgressCallback(display: ProgressDisplay): ProgressCallback {
  // ... the existing implementation (identical in both files)
}
```

Update both `orchestrator.ts` and `plan-orchestrator.ts` to import from the new module instead of defining the function locally. Remove the local definitions.

### Verification

Run `npx vitest run tests/orchestrator.test.ts tests/plan-orchestrator.test.ts` — all existing tests pass. Add a targeted test in `tests/progress-callbacks.test.ts` verifying the callback wiring (each callback method calls the corresponding display method).

---

## Item 5: Guard consolidation against all-instances-failed

### Problem

In `plan-orchestrator.ts:278`, consolidation runs unconditionally after instance execution. If every instance failed and produced no discovery docs, `consolidateDiscoveryDocs` returns empty content, and the plan orchestrator writes empty `plan.md` and `discovery.html` files — confusing to the user.

### Fix

After processing instance results (around line 272), check if any instance succeeded:

```typescript
const anySucceeded = results.some(r => r.status === 'completed');
if (!anySucceeded) {
  display.stop();
  console.error('\nAll discovery instances failed — no output generated.');
  console.error('Check --verbose output for details, or retry with fewer instances.\n');
  process.exitCode = 1;
  return;
}
```

This prints a clear error message and exits with code 1 without writing empty output files. The `finally` block still runs for cleanup.

### Verification

Targeted test: mock all instances to fail, verify that `process.exitCode` is set to 1, the error message is printed, and no output files are written. Run only `npx vitest run tests/plan-orchestrator.test.ts`.

---

## Item 6: Extract shared orchestration utilities

### Problem

Four patterns are duplicated between `orchestrator.ts` and `plan-orchestrator.ts`:

1. **Signal handling** — Flag-based signal setup, `raceSignal()`, signal handler, and cleanup (orchestrator 167-194, plan-orchestrator 155-182)
2. **Browser open** — Platform-specific `exec()` to open an HTML file (orchestrator 483-490, plan-orchestrator 336-343)
3. **`formatDuration()`** — `plan-orchestrator.ts:314-319` defines its own version when `progress-display.ts:52-60` already exports one

### Fix — Three new modules

**6a. `src/signal-handler.ts`** — Shared signal management

Extract the signal handling pattern into a reusable class or factory function. It needs to:
- Create a `signalPromise` with a rejection function
- Register SIGINT/SIGTERM handlers that set a flag, kill child processes, set exit code, and reject the promise
- Provide a `raceSignal<T>(promise)` helper that races any promise against the signal
- Provide a cleanup method that removes signal listeners
- Accept the error class to throw (so orchestrator uses `SignalInterruptError` and plan-orchestrator uses `PlanSignalInterruptError`)

Example API:
```typescript
export interface SignalManager {
  raceSignal<T>(promise: Promise<T>): Promise<T>;
  readonly signalReceived: boolean;
  cleanup(): void;
}

export function createSignalManager(
  ErrorClass: new (signal: string) => Error,
): SignalManager;
```

Both orchestrators replace their inline signal setup with `createSignalManager(SignalInterruptError)` / `createSignalManager(PlanSignalInterruptError)`.

**6b. `src/browser-open.ts`** — Browser open utility

Extract the platform-specific browser open logic:
```typescript
export function openInBrowser(filePath: string): void;
```

Uses the same `exec()` pattern with platform detection (`win32` → `start ""`, `darwin` → `open`, else → `xdg-open`). Logs failures via `debug()`.

Both orchestrators replace their inline browser open with `openInBrowser(path)`.

**6c. Reuse `formatDuration` from `progress-display.ts`**

`progress-display.ts:52-60` already exports `formatDuration()`. Remove the inline definition from `plan-orchestrator.ts:314-319` and import from `progress-display.ts` instead. The slight formatting difference (padded seconds in progress-display vs unpadded in plan-orchestrator) should be resolved by using the progress-display version — padded seconds (`1m05s`) are more readable.

### Verification

- `signal-handler.ts`: Targeted tests verifying signal registration, `raceSignal` behavior, flag setting, and cleanup.
- `browser-open.ts`: Targeted tests verifying correct platform command for win32, darwin, and linux.
- `formatDuration`: No new tests needed — `progress-display.ts`'s version is already tested. Just verify `plan-orchestrator.ts` uses the import.
- All existing orchestrator and plan-orchestrator tests continue to pass.

---

## Item 7: Integration test verifying `buildDiscoveryPrompt` is used by plan orchestrator

### Problem

Even after Item 0 wires `buildDiscoveryPrompt` correctly, there's no integration-level test confirming the plan orchestrator actually uses the discovery prompt (not the analysis prompt) when spawning instances.

### Fix

Add an integration test in `tests/plan-orchestrator.test.ts` that:
1. Calls `runPlanDiscovery()` with mocked dependencies (same pattern as existing integration tests)
2. Captures the prompt passed to `runClaude`
3. Asserts the prompt contains discovery-specific content:
   - Contains "UX explorer" or "Areas to Explore"
   - Does NOT contain "report" instructions, "findings", or "severity"
4. Confirms `buildDiscoveryPrompt` was the prompt builder used (not `buildInstancePrompt`)

### Verification

Run only `npx vitest run tests/plan-orchestrator.test.ts`.

---

## Dependencies Between Items

```
Item 0 (prompt wiring bug) ── independent, but Item 7 depends on it
Item 2 (ENOTEMPTY fix)     ── independent
Item 3 (bare catch logging)── independent
Item 4 (extract buildProgressCallback) ── independent
Item 5 (all-failed guard)  ── independent
Item 6 (extract shared utilities) ── independent of Items 0-5
Item 1 (coverage) ── depends on Items 0, 4, 5, 6 (coverage tests should target final code locations)
Item 7 (integration test)  ── depends on Item 0
```

Items 0, 2, 3, 4, 5, and 6 are all independent of each other and can be done in any order. Item 1 (coverage) should come last since the refactoring in Items 4 and 6 moves code to new modules, and coverage tests should target the final locations. Item 7 depends on Item 0.

---

## Testing Strategy

All changes must maintain the 95% coverage threshold. The primary goal of this iteration is to get coverage *above* that threshold (currently at 94.86% branch).

### New test files
- `tests/progress-callbacks.test.ts` — tests for extracted `buildProgressCallback()`
- `tests/signal-handler.test.ts` — tests for extracted signal management
- `tests/browser-open.test.ts` — tests for extracted browser open utility

### Modified test files
- `tests/plan-orchestrator.test.ts` — new tests for dry-run details, `copyScreenshotsToOutput`, all-instances-failed, integration test for discovery prompt wiring
- `tests/instance-manager.test.ts` — test for `promptBuilder` field in `spawnInstance`
- `tests/file-manager.test.ts` — test for ENOTEMPTY retry, fix existing test failure
- `tests/discovery-html.test.ts` — test for `debug()` logging on `readdirSync` failure

---

## Out of Scope

The following remain deferred:
- Finding severity filtering (`--min-severity`)
- Claude Agent SDK migration
- Structured IPC (replacing file-based communication)
- Report diffing for `--append` mode
- `validate-plan` subcommand
- `--from-plan` pipeline flag
- Incremental discovery (`--append` for plan mode)
- Consolidation as a separate CLI subcommand
- AbortController for cancellation
- Large dataset / performance testing
- Concurrent write race condition tests
- Filesystem error tests (EACCES, ENOSPC) beyond EBUSY/ENOTEMPTY
