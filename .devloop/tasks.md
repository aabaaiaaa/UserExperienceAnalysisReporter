# Iteration 6 Tasks

### TASK-001: Add screenshot counting to progress display
- **Status**: done
- **Dependencies**: none
- **Description**: In `progress-display.ts`, modify `pollCheckpoints()` to count screenshots for each running instance using `listScreenshots()` from `screenshots.ts`. Store the total count. In `formatProgressLine()`, append `, N screenshots` after the findings count when N > 0. See requirements.md §1 for display format and design decisions.
- **Verification**: `npx vitest run tests/progress-display.test.ts` — all existing tests pass plus new test(s) verifying screenshot count appears in the formatted progress line when count > 0 and is absent when count is 0.

### TASK-002: Add file liveness signal to progress display
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: In `progress-display.ts`, extend `pollCheckpoints()` to check `mtime` (via `fs.statSync`) of each running instance's files: `discovery.md`, `report.md`, `checkpoint.json`, and the `screenshots/` directory. Track the most recent mtime across all instances. In `formatProgressLine()`, append ` · active Xs ago` when file activity has been observed, where X is seconds since the most recent mtime. Silently skip files that don't exist yet; catch `statSync` errors to avoid crashing the render loop. See requirements.md §2 for full details.
- **Verification**: `npx vitest run tests/progress-display.test.ts` — all existing tests pass plus new test(s) verifying liveness signal appears with correct format when files have recent mtime, and is absent when no activity.

### TASK-003: Strengthen checkpoint update prompt in instance-manager
- **Status**: done
- **Dependencies**: none
- **Description**: In `instance-manager.ts`, rewrite the checkpoint instruction section in `buildInstancePrompt()` (currently around line 102: "After each significant step, write a JSON checkpoint"). Replace with explicit, emphatic instructions demanding checkpoint updates after EVERY page navigation, EVERY screenshot, and EVERY finding. Emphasize that the checkpoint is how the user tracks progress in real time. See requirements.md §3 for tone and design decisions. The checkpoint JSON structure itself does not change.
- **Verification**: `npx vitest run tests/instance-manager.test.ts` — existing tests pass. Add or update a test verifying the prompt string no longer contains "significant step" and does contain the stronger checkpoint language (e.g., check for keywords like "every screenshot" or "every navigation").

### TASK-004a: Create shared test cleanup helper with EBUSY retry
- **Status**: done
- **Dependencies**: none
- **Description**: Create `tests/test-helpers.ts` with an async `cleanTestDirs(testBase: string)` function that mirrors the retry logic in `file-manager.ts:57-78`: up to 5 attempts, catches EBUSY/EPERM errors, linear backoff (100ms * attempt), throws immediately on other errors or after max attempts exhausted. Export this function for use by integration test files.
- **Verification**: `npx vitest run tests/test-helpers.test.ts` — add a small test file verifying: (1) successful deletion on first attempt, (2) retry on EBUSY then success, (3) throw after max attempts. Mock `rmSync` to simulate errors.

### TASK-004b: Replace cleanTestDirs in integration-happy-path and integration-failure-retry
- **Status**: pending
- **Dependencies**: TASK-004a
- **Description**: In `tests/integration-happy-path.test.ts` and `tests/integration-failure-retry.test.ts`, replace the local `cleanTestDirs()` function with an import of the shared helper from `tests/test-helpers.ts`. Update the `afterEach` hook to be async (use `async () => { await cleanTestDirs(TEST_BASE); }`). Remove the old `cleanTestDirs` function and any now-unused `rmSync` import.
- **Verification**: `npx vitest run tests/integration-happy-path.test.ts tests/integration-failure-retry.test.ts` — all tests pass.

### TASK-004c: Replace cleanTestDirs in integration-edge-cases and integration-append-mode
- **Status**: pending
- **Dependencies**: TASK-004a
- **Description**: Same as TASK-004b but for `tests/integration-edge-cases.test.ts` and `tests/integration-append-mode.test.ts`. Replace local `cleanTestDirs()` with the shared helper, make `afterEach` async, remove old function and unused imports.
- **Verification**: `npx vitest run tests/integration-edge-cases.test.ts tests/integration-append-mode.test.ts` — all tests pass.

### TASK-004d: Replace cleanTestDirs in remaining 3 integration test files
- **Status**: pending
- **Dependencies**: TASK-004a
- **Description**: Same as TASK-004b but for `tests/integration-dedup-consolidation.test.ts`, `tests/integration-multi-instance.test.ts`, and `tests/consolidation-resume.test.ts`. Replace local `cleanTestDirs()` with the shared helper, make `afterEach` async, remove old function and unused imports.
- **Verification**: `npx vitest run tests/integration-dedup-consolidation.test.ts tests/integration-multi-instance.test.ts tests/consolidation-resume.test.ts` — all tests pass.

### TASK-005: Fix bare catch block in checkpoint.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `checkpoint.ts`, change the bare `catch` block in `readCheckpoint()` (line 61) to `catch (err)` and add a `debug()` call logging the error before returning `null`. Import `debug` from `./logger.js` if not already imported. This matches the pattern applied to `file-manager.ts` in iteration 5. See requirements.md §5.
- **Verification**: `npx vitest run tests/checkpoint.test.ts` — all existing tests pass plus a new test verifying `readCheckpoint()` returns `null` when the checkpoint file contains invalid JSON.

### TASK-006: Remove redundant undefined check in consolidation-checkpoint.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `consolidation-checkpoint.ts:112`, simplify the validation condition from `if (parsed[field] !== null && (typeof parsed[field] !== 'object' || parsed[field] === undefined))` to `if (parsed[field] !== null && typeof parsed[field] !== 'object')`. The `=== undefined` check is redundant because `typeof undefined` is `'undefined'`, which already fails the `typeof !== 'object'` check. See requirements.md §6.
- **Verification**: `npx vitest run tests/consolidation-resume.test.ts` — all existing checkpoint validation tests pass.

### TASK-007: Add help and show-default-scope to knownFlags set in cli.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: In `cli.ts:157`, add `'help'` and `'show-default-scope'` to the `knownFlags` set. These flags are handled before the unknown-flag check but are missing from the set. See requirements.md §7.
- **Verification**: `npx vitest run tests/cli.test.ts` — all existing CLI tests pass.
