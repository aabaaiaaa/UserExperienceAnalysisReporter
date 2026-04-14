# UX Analysis Reporter — Iteration 11 Requirements

## Overview

This iteration addresses the 1 "must fix" item and 3 "should fix" / "nice to have" items from the iteration 10 code review, plus a structural refactoring of the second-largest file in the codebase. No new features are added. All changes are bug fixes, test safety improvements, coverage improvements, and refactoring.

The prior iteration left the project at 1033/1033 tests passing across 43 test files with 99.05% statement, 96.42% branch, 99.48% function coverage — all above the 95% threshold. The consolidation split from iteration 10 was clean and well-executed; this iteration applies the same pattern to `instance-manager.ts`.

---

## Item 1: Add browser-open mock to orchestrator.test.ts

### Problem

`tests/orchestrator.test.ts` does not mock `../src/browser-open.js`. While all test cases currently pass `suppressOpen: true` (preventing `openInBrowser` from being called), there is no safety net. If any test were to accidentally pass `suppressOpen: false` through the `makeArgs()` spread override, `openInBrowser` would fire for real, executing a shell command (`start "" "..."` on Windows) and attempting to open a file in the browser.

This is a latent risk: a future test change could trigger real browser opens during the test suite, causing test environment side effects and potential failures.

### Fix

Add a module-level `vi.mock('../src/browser-open.js', ...)` call to `tests/orchestrator.test.ts`, returning a no-op mock for `openInBrowser`. This follows the same pattern already used in `tests/plan-orchestrator.test.ts` (lines 94-97):

```typescript
vi.mock('../src/browser-open.js', () => ({
  openInBrowser: vi.fn(),
}));
```

No new test assertions are needed — this is a defensive mock to prevent real browser opens.

### Verification

Run `npx vitest run tests/orchestrator.test.ts` — all existing tests pass. Confirm the mock is present by grepping for `browser-open` in the file.

---

## Item 2: Raise per-module branch coverage to 95%

### Problem

Three modules remain below the 95% branch coverage target:

| Module | Current Branch % | Gap | Uncovered Lines |
|--------|-----------------|-----|-----------------|
| `instance-manager.ts` | 92.98% | 2.02% | 562-568, 603, 611 |
| `html-report.ts` | 94.59% | 0.41% | 86-87 |
| `progress-display.ts` | 93.8% | 1.2% | 420-421 |

### Fix: instance-manager.ts (lines 562-568, 603, 611)

The uncovered lines are the "round fails, retry loop executes, retries exhaust, instance permanently fails" path in `runInstanceRounds`:

- **Lines 562-568**: Entry into the failure/retry block: `cb?.onFailure?(...)`, `retryInfo` initialization
- **Line 603**: `retryInfo.errors.push(state.error || 'Unknown error')` — error accumulation after a retry attempt fails
- **Line 611**: `cb?.onPermanentlyFailed?.(...)` — the permanently failed callback

A test in `tests/instance-manager.test.ts` (or the existing `tests/round-execution.test.ts`) should:
1. Configure `runInstanceRounds` with `maxRetries: 1` (or similar small number)
2. Mock `runClaude` to always reject/fail (non-rate-limit failure)
3. Assert that the result has `permanentlyFailed: true`
4. Assert that `progress.onFailure` was called
5. Assert that `progress.onPermanentlyFailed` was called
6. Assert that `retries[0].errors` has the expected number of entries (initial + retry attempts)

Check `tests/round-execution.test.ts` and `tests/coverage-gaps.test.ts` first — similar tests may already exist and just need a small addition to cover the specific uncovered branches.

### Fix: html-report.ts (lines 86-87)

The uncovered branch is in `renderScreenshots` — the `refs.length === 0` fallback at line 85-86. This fires when the screenshot field contains only whitespace or commas (e.g., `" , , "`) so after splitting and filtering, no valid refs remain.

Add a test in `tests/html-report.test.ts` that calls `formatHtmlReport` with a finding whose screenshot field is `" , , "` (whitespace/commas only). Verify the output contains the raw screenshot field as escaped HTML text, not `<img>` tags.

### Fix: progress-display.ts (lines 420-421)

The uncovered branch is the null `latestMtime` coalescing path in `pollCheckpoints`. Lines 419-421:
```typescript
if (mt != null && (latestMtime == null || mt > latestMtime)) {
  latestMtime = mt;
}
```

The uncovered path is when ALL `safeStatMtimeMs` calls return null for a given instance (no checkpoint, report, discovery, or screenshots files exist yet). In this case, `latestMtime` remains null and line 423 coalesces it: `progress.latestMtime = latestMtime ?? undefined`.

Add a test in `tests/progress-display.test.ts` that sets up a `ProgressDisplay` with an instance directory where none of the expected files exist (no stat results). Call `pollCheckpoints()` and verify that the instance's `latestMtime` is `undefined`.

### Verification

- `npx vitest run --coverage tests/instance-manager.test.ts tests/round-execution.test.ts tests/coverage-gaps.test.ts` — confirm `instance-manager.ts` branch coverage is above 95%
- `npx vitest run --coverage tests/html-report.test.ts` — confirm `html-report.ts` branch coverage is above 95%
- `npx vitest run --coverage tests/progress-display.test.ts` — confirm `progress-display.ts` branch coverage is above 95%

---

## Item 3: Add debug logging to hierarchy fallback

### Problem

`src/consolidation/hierarchy.ts:206-208` — when Claude fails to provide hierarchy relationships (the `runClaude` call returns `success: false`), `determineHierarchy` silently falls back to a flat structure (all findings as top-level). There is no log message, making it difficult to diagnose why findings appear in a flat structure during debugging.

```typescript
if (!result.success) {
  // On failure, fall back to flat structure (all top-level)
  return findings.map((f) => ({ finding: f, children: [] }));
}
```

### Fix

Add a `debug()` call before the fallback return:

```typescript
if (!result.success) {
  debug('Hierarchy determination failed — falling back to flat structure');
  return findings.map((f) => ({ finding: f, children: [] }));
}
```

Import `debug` from `../logger.js` (add to existing imports if not already present).

### Verification

Run `npx vitest run tests/consolidation.test.ts` — all existing tests pass. Optionally verify the debug call is present by grepping for "falling back to flat structure" in the source.

---

## Item 4: Split instance-manager.ts into submodules

### Problem

`instance-manager.ts` is 639 lines — now the largest file in the codebase after the consolidation split — and combines 4 distinct concerns:

1. **Types and interfaces** (lines 12-55, 334-394): `InstanceStatus`, `InstanceConfig`, `InstanceState`, `RetryInfo`, `ProgressCallback`, `RoundExecutionConfig`, `RoundExecutionResult`, plus `DEFAULT_MAX_RETRIES`
2. **Prompt builders** (lines 62-221): `buildInstancePrompt`, `buildDiscoveryPrompt`
3. **Instance spawning** (lines 229-328): `spawnInstance`, `spawnInstances`, `spawnInstanceWithResume`
4. **Round execution and retry logic** (lines 396-639): `handleRateLimitRetries` (private), `emitProgressUpdate` (private), `runInstanceRounds`

Additionally, line 2 re-exports `killAllChildProcesses` and `getActiveProcessCount` from `claude-cli.js`.

### Fix

Split into an `instance-manager/` directory with focused submodules:

```
src/instance-manager/
  index.ts       — Barrel re-exports of all public APIs (~30 lines)
  types.ts       — All interfaces, type aliases, and constants (~85 lines)
  prompts.ts     — buildInstancePrompt, buildDiscoveryPrompt (~165 lines)
  spawning.ts    — spawnInstance, spawnInstances, spawnInstanceWithResume (~105 lines)
  rounds.ts      — handleRateLimitRetries (private), emitProgressUpdate (private), runInstanceRounds (~250 lines)
```

The `index.ts` barrel file re-exports everything that the rest of the codebase imports from `instance-manager.ts`, maintaining the same public API. This includes the re-exports of `killAllChildProcesses` and `getActiveProcessCount` from `claude-cli.js`.

### Import Updates Required

**Source files** (3 files):
- `src/orchestrator.ts:10` — imports `runInstanceRounds`, `killAllChildProcesses`, `getActiveProcessCount`, `RoundExecutionResult`
- `src/plan-orchestrator.ts:11` — imports `runInstanceRounds`, `killAllChildProcesses`, `getActiveProcessCount`, `RoundExecutionResult`
- `src/progress-callbacks.ts:2` — imports `ProgressCallback`

**Test files** (9 files):
- `tests/instance-manager.test.ts:13`
- `tests/orchestrator.test.ts:111`
- `tests/plan-orchestrator.test.ts:128`
- `tests/coverage-gaps.test.ts:57`
- `tests/failure-retry-resume.test.ts:10`
- `tests/progress-recalibration.test.ts:29`
- `tests/rate-limit.test.ts:19`
- `tests/round-execution.test.ts:9`
- `tests/verify-task-007.test.ts:11`

All imports change from `./instance-manager.js` (or `../src/instance-manager.js`) to `./instance-manager/index.js` (or `../src/instance-manager/index.js`).

### Key Constraints

- **This is a pure refactoring** — zero behavior changes. Every function signature, every export, every return value must remain identical.
- **All existing tests must pass without modification** (except import path updates). No test logic changes.
- **The barrel `index.ts` must export everything** that `instance-manager.ts` currently exports. No public API changes.
- **Delete the original `instance-manager.ts`** after the split is complete and verified.

### Verification

Run `npx vitest run tests/instance-manager.test.ts tests/round-execution.test.ts tests/coverage-gaps.test.ts tests/failure-retry-resume.test.ts tests/verify-task-007.test.ts` — all tests pass. Run `npx tsc --noEmit` — no type errors. Grep for any remaining imports of the old `./instance-manager.js` path (should find none except in the new `instance-manager/` directory itself).

---

## Dependencies Between Items

```
Item 1 (browser-open mock)        — independent
Item 2 (branch coverage)          — independent, but instance-manager coverage tests
                                     should be done BEFORE the split (Item 4)
Item 3 (hierarchy debug logging)  — independent
Item 4 (instance-manager split)   — should come LAST since it's the largest change
                                     and Item 2 adds tests for instance-manager
```

Items 1-3 are independent and can be done in any order. Item 4 should be done after Item 2 since Item 2 adds new tests for `instance-manager.ts` that would need additional import path updates if done after the split.

---

## Testing Strategy

All changes must maintain the 95% overall coverage threshold (currently at 96.42% branch). Item 2 should raise individual module coverage above 95%.

### Modified test files
- `tests/orchestrator.test.ts` — add browser-open mock (Item 1)
- `tests/instance-manager.test.ts` or `tests/round-execution.test.ts` or `tests/coverage-gaps.test.ts` — new test for retry-exhaust path (Item 2)
- `tests/html-report.test.ts` — new test for empty refs fallback (Item 2)
- `tests/progress-display.test.ts` — new test for null mtime path (Item 2)
- All 9 test files listed above — import path updates only (Item 4)

### Modified source files
- `src/consolidation/hierarchy.ts` — add debug() call (Item 3)
- `src/orchestrator.ts` — import path update (Item 4)
- `src/plan-orchestrator.ts` — import path update (Item 4)
- `src/progress-callbacks.ts` — import path update (Item 4)

### New source files
- `src/instance-manager/index.ts` — barrel re-exports (Item 4)
- `src/instance-manager/types.ts` — interfaces and constants (Item 4)
- `src/instance-manager/prompts.ts` — prompt builders (Item 4)
- `src/instance-manager/spawning.ts` — instance spawning (Item 4)
- `src/instance-manager/rounds.ts` — round execution and retry logic (Item 4)

### Deleted source files
- `src/instance-manager.ts` — replaced by `src/instance-manager/` directory (Item 4)

### New test files
None.

---

## Out of Scope

The following remain deferred:
- Shell metacharacter risk in `browser-open.ts:9-11` (pre-existing accepted risk, low severity)
- `Number() || fallback` masking instance 0 in `checkpoint.ts:54` (unreachable, instance numbering starts at 1)
- `rate-limit.ts` at 75% function coverage (`sleep()` always mocked — methodology artifact)
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
- Base orchestrator / composition pattern
- Persistent rate-limit retry budget across sequential runs
- Lightweight arg parsing library migration (`node:util parseargs`)
- Global test timeout configuration
