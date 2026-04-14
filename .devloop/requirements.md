# UX Analysis Reporter — Iteration 12 Requirements

## Overview

This iteration fixes a recurring test safety issue (real browser opens during tests), eliminates a long-standing shell injection risk, and closes two branch coverage gaps introduced by the iteration 11 instance-manager split. No new features are added. All changes are bug fixes, test safety improvements, coverage improvements, and a small security hardening.

The prior iteration left the project at 1036/1036 tests passing across 43 test files with 99.18% statement, 96.61% branch, 99.48% function coverage — all above the 95% threshold. The instance-manager split from iteration 11 was clean but exposed two submodules (`spawning.ts` at 89.28% and `rounds.ts` at 93.15%) below the 95% branch coverage target.

---

## Item 1: Add browser-open mock to ALL integration test files

### Problem

**This is the third time this has been reported.** Seven integration test files call `orchestrate()` (which imports `openInBrowser` from `browser-open.js`) without mocking `browser-open.js`. They rely solely on `suppressOpen: true` in their `makeArgs()` helper to prevent real browser opens. There is no safety net — if any test changes or overrides `suppressOpen`, a real shell command will execute (`start "" "..."` on Windows) and attempt to open a file in the default browser.

The affected test files are:

| Test file | Calls to orchestrate |
|---|---|
| `tests/integration-happy-path.test.ts` | 12 calls |
| `tests/integration-append-mode.test.ts` | multiple |
| `tests/integration-multi-instance.test.ts` | multiple |
| `tests/integration-edge-cases.test.ts` | multiple |
| `tests/integration-failure-retry.test.ts` | multiple |
| `tests/integration-dedup-consolidation.test.ts` | multiple |
| `tests/consolidation-resume.test.ts` | multiple |

These files already mock `claude-cli.js`, `file-manager.js`, and `progress-display.js` at the module level. Only `orchestrator.test.ts` and `plan-orchestrator.test.ts` currently have the `browser-open.js` mock.

### Fix

Add a module-level `vi.mock` to each of the 7 files, following the established pattern from `orchestrator.test.ts` (line 110):

```typescript
vi.mock('../src/browser-open.js', () => ({
  openInBrowser: vi.fn(),
}));
```

This should be placed alongside the existing `vi.mock` calls at the top of each file.

### Verification

For each file, run the file's tests and confirm they pass. Grep the file for `browser-open` to confirm the mock is present.

---

## Item 2: Migrate browser-open.ts from exec() to execFile()

### Problem

`src/browser-open.ts` (16 lines) uses `child_process.exec()` to construct platform-specific shell commands:

- Windows: `start "" "${filePath}"`
- macOS: `open "${filePath}"`
- Linux: `xdg-open "${filePath}"`

This has been carried as an accepted low-severity risk across multiple iterations. While output paths are tool-generated (not arbitrary user input), `exec()` passes the command through a shell, so a path containing shell metacharacters (`"`, `$`, `` ` ``, etc.) could theoretically break out of the quoted string.

### Fix

Replace `exec()` with `execFile()`, which bypasses the shell entirely:

```typescript
import { execFile } from 'node:child_process';
```

Platform-specific commands:
- **Windows**: `execFile('cmd', ['/c', 'start', '""', filePath], callback)`
- **macOS**: `execFile('open', [filePath], callback)`
- **Linux**: `execFile('xdg-open', [filePath], callback)`

The Windows case needs `cmd /c start "" <path>` because `start` is a shell built-in, not an executable. The empty `""` argument is the window title parameter that `start` requires before the path.

### Test Updates

`tests/browser-open.test.ts` currently mocks `exec` and asserts the command string. After the migration:
- Mock `execFile` instead of `exec`
- Assert the command and arguments array (not a command string)
- Preserve all 5 existing test cases (3 platform tests + 2 error handling tests)

### Verification

Run `npx vitest run tests/browser-open.test.ts` — all tests pass. Confirm `exec` is no longer imported (only `execFile`).

---

## Item 3: Raise instance-manager/spawning.ts branch coverage above 95%

### Problem

`src/instance-manager/spawning.ts` is at 89.28% branch coverage (5.72% below target). Three specific branches are uncovered:

1. **Line 85**: `config.promptBuilder?.(config) ?? buildInstancePrompt(config)` — the truthy path where a custom `promptBuilder` is provided and used instead of the default `buildInstancePrompt`. This same optional-chaining pattern exists in `spawnInstance` (line 20).

2. **Line 105**: `state.error = result.stderr || \`Instance exited with code ${result.exitCode}\`` — when `runClaude` returns a result (not throws) but with a truthy `stderr` value.

3. **Line 109**: `state.error = err instanceof Error ? err.message : String(err)` — the `String(err)` fallback path when `runClaude` throws a non-Error value.

### Fix

Add tests in `tests/instance-manager.test.ts` (or `tests/coverage-gaps.test.ts` if that's a better fit — check which file already has similar tests):

1. **Custom promptBuilder test**: Call `spawnInstanceWithResume` (or `spawnInstance`) with a `promptBuilder` function in the config. Verify the custom builder is called and its return value is passed to `runClaude` as the prompt.

2. **stderr truthy test**: Mock `runClaude` to return `{ success: false, stderr: 'Some error message', exitCode: 1 }`. Verify the resulting state has `error: 'Some error message'` (using stderr, not the exitCode fallback).

3. **Non-Error throw test**: Mock `runClaude` to throw a string (e.g., `throw 'connection lost'`). Verify the resulting state has `error: 'connection lost'` (via `String(err)`).

### Verification

Run `npx vitest run --coverage tests/instance-manager.test.ts tests/coverage-gaps.test.ts` — confirm `instance-manager/spawning.ts` branch coverage is above 95%.

---

## Item 4: Raise instance-manager/rounds.ts branch coverage above 95%

### Problem

`src/instance-manager/rounds.ts` is at 93.15% branch coverage (1.85% below target). The uncovered lines are all in the retry failure path:

1. **Lines 176-182**: Entry into the normal retry block when initial spawn fails — `cb?.onFailure?.(...)` callback and `RetryInfo` initialization with the error message.

2. **Line 217**: `retryInfo.errors.push(state.error || 'Unknown error')` — error accumulation when a retry attempt fails.

3. **Line 225**: `cb?.onPermanentlyFailed?.(config.instanceNumber, state.error || 'Unknown error')` — the permanently-failed callback when all retries are exhausted.

### Fix

Add a test (in `tests/round-execution.test.ts` or `tests/coverage-gaps.test.ts` — check which already has similar retry tests) that exercises the full "initial spawn fails -> retry -> retries exhaust -> permanent failure" path:

1. Configure `runInstanceRounds` with `maxRetries: 1` and all progress callbacks provided (`onFailure`, `onPermanentlyFailed`, etc.)
2. Mock `runClaude` to always fail (non-rate-limit failure, so it doesn't enter the rate-limit retry path)
3. Assert:
   - Result has `permanentlyFailed: true`
   - `onFailure` callback was called with the instance number, round, and error message
   - `onPermanentlyFailed` callback was called with the instance number and error message
   - `retryInfo.errors` has the expected number of entries (initial failure + retry attempts)

Check `tests/round-execution.test.ts` and `tests/coverage-gaps.test.ts` first — similar tests may already exist and just need the progress callbacks asserted to cover the specific uncovered lines.

### Verification

Run `npx vitest run --coverage tests/round-execution.test.ts tests/coverage-gaps.test.ts` — confirm `instance-manager/rounds.ts` branch coverage is above 95%.

---

## Dependencies Between Items

```
Item 1 (browser-open mock in integration tests)  — independent
Item 2 (exec → execFile migration)               — independent of Items 3-4,
                                                    but should come AFTER Item 1
                                                    (Item 1 ensures all tests mock
                                                    browser-open, so Item 2's source
                                                    changes can't leak into integration tests)
Item 3 (spawning.ts coverage)                     — independent
Item 4 (rounds.ts coverage)                       — independent
```

Item 1 should be done first as it's the most critical safety issue. Item 2 should come after Item 1 since Item 1 ensures all test files mock browser-open (preventing Item 2's source changes from affecting integration tests). Items 3 and 4 are independent of each other and of Items 1-2.

---

## Testing Strategy

All changes must maintain the 95% overall coverage threshold (currently at 96.61% branch). Items 3 and 4 should raise their respective submodule branch coverage above 95%.

### Modified test files
- `tests/integration-happy-path.test.ts` — add browser-open mock (Item 1)
- `tests/integration-append-mode.test.ts` — add browser-open mock (Item 1)
- `tests/integration-multi-instance.test.ts` — add browser-open mock (Item 1)
- `tests/integration-edge-cases.test.ts` — add browser-open mock (Item 1)
- `tests/integration-failure-retry.test.ts` — add browser-open mock (Item 1)
- `tests/integration-dedup-consolidation.test.ts` — add browser-open mock (Item 1)
- `tests/consolidation-resume.test.ts` — add browser-open mock (Item 1)
- `tests/browser-open.test.ts` — update to test execFile instead of exec (Item 2)
- `tests/instance-manager.test.ts` or `tests/coverage-gaps.test.ts` — new tests for spawning.ts branches (Item 3)
- `tests/round-execution.test.ts` or `tests/coverage-gaps.test.ts` — new tests for rounds.ts retry path (Item 4)

### Modified source files
- `src/browser-open.ts` — replace exec() with execFile() (Item 2)

### New source files
None.

### New test files
None.

### Deleted source files
None.

---

## Out of Scope

The following remain deferred:
- `checkpoint.ts` at 84% branch coverage (unreachable type coercion fallbacks)
- `rate-limit.ts` at 75% function coverage (`sleep()` always mocked — methodology artifact)
- `discovery-html.ts` at 94.44% branch coverage (screenshot matching fallback)
- `progress-display.ts` at 94.82% branch coverage (timer setup and poll loop edge cases)
- Global test timeout configuration (`testTimeout: 10000`)
- Lightweight arg parsing library migration (`node:util parseArgs`)
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
