# UX Analysis Reporter — Iteration 8 Tasks

See `.devloop/requirements.md` for full context on each item.

---

### TASK-001: Add `promptBuilder` field to InstanceConfig and RoundExecutionConfig
- **Status**: done
- **Dependencies**: none
- **Description**: Add an optional `promptBuilder?: (config: InstanceConfig) => string` field to both `InstanceConfig` and `RoundExecutionConfig` in `instance-manager.ts`. Modify `spawnInstance()` (line 233) to use `config.promptBuilder?.(config) ?? buildInstancePrompt(config)` instead of hardcoding `buildInstancePrompt(config)`. Modify `runInstanceRounds()` to pass `promptBuilder` from `RoundExecutionConfig` through to the `InstanceConfig` it constructs (around line 519-527). Also pass it through in the `respawn` lambda and `spawnInstanceWithResume`. See requirements Item 0 for full details.
- **Verification**: `npx vitest run tests/instance-manager.test.ts` — all existing tests pass. Add a test that creates an `InstanceConfig` with a custom `promptBuilder`, calls `spawnInstance`, and verifies the custom prompt builder was used (mock `runClaude` and check the prompt argument).

### TASK-002: Wire `buildDiscoveryPrompt` into plan orchestrator
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: In `plan-orchestrator.ts`, update the `RoundExecutionConfig` construction (around lines 232-243) to include `promptBuilder: buildDiscoveryPrompt`. Import `buildDiscoveryPrompt` from `instance-manager.js`. This ensures the plan subcommand uses the discovery-only prompt instead of the analysis prompt. See requirements Item 0.
- **Verification**: `npx vitest run tests/plan-orchestrator.test.ts` — all existing tests pass. The integration test added in TASK-012 will provide deeper verification.

### TASK-003: Fix `cleanupTempDir()` to catch ENOTEMPTY
- **Status**: done
- **Dependencies**: none
- **Description**: In `file-manager.ts:68-70`, add `ENOTEMPTY` to the list of retryable error codes alongside EBUSY and EPERM. Rename `isLockError` to `isRetryableError` for clarity. See requirements Item 2.
- **Verification**: `npx vitest run tests/file-manager.test.ts` — the previously failing test passes. Add a targeted test that mocks `rmSync` to throw ENOTEMPTY on the first call and succeed on the second, verifying the retry works.

### TASK-004: Add `debug()` logging to `discovery-html.ts` bare catch
- **Status**: done
- **Dependencies**: none
- **Description**: In `discovery-html.ts`, import `debug` from `./logger.js`. Change the bare catch at line 265-266 in `listAllScreenshots()` to `catch (err)` and add `debug(\`Failed to read screenshots directory ${screenshotsDir}: ${err}\`)` before returning `[]`. See requirements Item 3.
- **Verification**: `npx vitest run tests/discovery-html.test.ts` — all existing tests pass. Add a test that mocks `readdirSync` to throw, verifies `listAllScreenshots()` returns `[]`, and verifies `debug()` was called with the error message.

### TASK-005: Extract `buildProgressCallback()` to `progress-callbacks.ts`
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/progress-callbacks.ts` containing the shared `buildProgressCallback(display: ProgressDisplay): ProgressCallback` function (currently duplicated in `orchestrator.ts:86-125` and `plan-orchestrator.ts:40-79`). Remove the local definitions from both orchestrator files and replace with imports from the new module. See requirements Item 4.
- **Verification**: `npx vitest run tests/orchestrator.test.ts tests/plan-orchestrator.test.ts` — all existing tests pass.

### TASK-005b: Add tests for `progress-callbacks.ts`
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: Create `tests/progress-callbacks.test.ts` with targeted tests for the extracted `buildProgressCallback()`. Test that each callback method (onRoundStart, onRoundComplete, onFailure, onRetry, onRetrySuccess, onRateLimited, onRateLimitResolved, onCompleted, onPermanentlyFailed, onProgressUpdate) calls the corresponding `ProgressDisplay` method with the correct arguments. Use a mock `ProgressDisplay`.
- **Verification**: `npx vitest run tests/progress-callbacks.test.ts` — all tests pass.

### TASK-006: Extract signal handling to `signal-handler.ts`
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/signal-handler.ts` with a `createSignalManager(ErrorClass)` factory function that encapsulates the flag-based signal handling pattern duplicated between `orchestrator.ts:167-194` and `plan-orchestrator.ts:155-182`. The returned `SignalManager` object should provide: `raceSignal<T>(promise)`, `signalReceived` (readonly boolean), and `cleanup()`. Both orchestrators should import and use `createSignalManager()` instead of their inline implementations. `orchestrator.ts` passes `SignalInterruptError`, `plan-orchestrator.ts` passes `PlanSignalInterruptError`. See requirements Item 6a.
- **Verification**: `npx vitest run tests/orchestrator.test.ts tests/plan-orchestrator.test.ts` — all existing tests pass.

### TASK-006b: Add tests for `signal-handler.ts`
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Create `tests/signal-handler.test.ts` with targeted tests: (1) `raceSignal` resolves when the wrapped promise resolves, (2) `raceSignal` rejects with the ErrorClass when signal fires, (3) `signalReceived` is false initially and true after signal, (4) `cleanup()` removes the signal listeners, (5) multiple calls to the signal handler are idempotent (second call is a no-op). Mock `process.on`/`process.removeListener` and `killAllChildProcesses`.
- **Verification**: `npx vitest run tests/signal-handler.test.ts` — all tests pass.

### TASK-007: Extract browser open to `browser-open.ts`
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/browser-open.ts` with an `openInBrowser(filePath: string): void` function that uses the platform-specific `exec()` pattern (`win32` → `start ""`, `darwin` → `open`, else → `xdg-open`). Import `debug` from `./logger.js` for error logging. Update both `orchestrator.ts:483-490` and `plan-orchestrator.ts:336-343` to use `openInBrowser()` instead of inline `exec()`. See requirements Item 6b.
- **Verification**: `npx vitest run tests/orchestrator.test.ts tests/plan-orchestrator.test.ts` — all existing tests pass.

### TASK-007b: Add tests for `browser-open.ts`
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Create `tests/browser-open.test.ts` with targeted tests: (1) on `win32`, `exec` is called with `start "" "path"`, (2) on `darwin`, `exec` is called with `open "path"`, (3) on linux, `exec` is called with `xdg-open "path"`, (4) when `exec` callback reports an error, `debug()` is called. Mock `process.platform`, `exec`, and `debug`.
- **Verification**: `npx vitest run tests/browser-open.test.ts` — all tests pass.

### TASK-008: Remove inline `formatDuration` from `plan-orchestrator.ts`
- **Status**: done
- **Dependencies**: none
- **Description**: Remove the inline `formatDuration` function at `plan-orchestrator.ts:314-319` and replace with an import of `formatDuration` from `./progress-display.js` (already exported at line 52). The progress-display version pads seconds (e.g., `1m05s` vs `1m 5s`) — this is the preferred format. See requirements Item 6c.
- **Verification**: `npx vitest run tests/plan-orchestrator.test.ts` — all existing tests pass.

### TASK-009: Guard consolidation against all-instances-failed
- **Status**: done
- **Dependencies**: none
- **Description**: In `plan-orchestrator.ts`, after the instance results processing loop (around line 272), add a check: if no instance has `status === 'completed'`, stop the display, print an error message ("All discovery instances failed — no output generated."), set `process.exitCode = 1`, and return early before the consolidation phase. The `finally` block still handles cleanup. See requirements Item 5.
- **Verification**: `npx vitest run tests/plan-orchestrator.test.ts` — add a targeted test that mocks all instances to fail, verifies `process.exitCode` is 1, the error message is printed to stderr, and no output files (`plan.md`, `discovery.html`) are written.

### TASK-010: Raise `plan-orchestrator.ts` test coverage — `copyScreenshotsToOutput`
- **Status**: done
- **Dependencies**: TASK-002, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009
- **Description**: Add tests to `tests/plan-orchestrator.test.ts` for `copyScreenshotsToOutput()`: (1) copies PNG files from instance screenshot directories to output directory, (2) returns correct count of copied files, (3) skips instances with no screenshots directory, (4) handles `readdirSync`/`copyFileSync` errors via debug logging. See requirements Item 1.
- **Verification**: `npx vitest run tests/plan-orchestrator.test.ts` — all tests pass.

### TASK-011: Raise `plan-orchestrator.ts` test coverage — dry-run and remaining paths
- **Status**: done
- **Dependencies**: TASK-002, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009
- **Description**: Add tests to `tests/plan-orchestrator.test.ts` for remaining uncovered paths: (1) dry-run output — verify printed content includes URL, instance count, rounds, areas, and scope, (2) consolidation failure path, (3) any remaining uncovered branches after the refactoring. Target 95%+ statement, branch, and function coverage for `plan-orchestrator.ts`. See requirements Item 1.
- **Verification**: `npx vitest run --coverage tests/plan-orchestrator.test.ts` — `plan-orchestrator.ts` shows 95%+ on all coverage metrics.

### TASK-012: Integration test verifying discovery prompt wiring
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: Add an integration test in `tests/plan-orchestrator.test.ts` that calls `runPlanDiscovery()` with mocked dependencies and captures the prompt passed to `runClaude`. Assert the prompt contains discovery-specific content ("UX explorer" or "Areas to Explore") and does NOT contain analysis-specific content ("## Report", "findings", "severity rating"). See requirements Item 7.
- **Verification**: `npx vitest run tests/plan-orchestrator.test.ts` — the new integration test passes.

### TASK-013: Final coverage verification
- **Status**: pending
- **Dependencies**: TASK-010, TASK-011, TASK-012, TASK-003, TASK-004, TASK-005b, TASK-006b, TASK-007b
- **Description**: Run the full test suite with coverage and verify: (1) all tests pass (981+ tests, 0 failures), (2) overall branch coverage is 95%+, (3) `plan-orchestrator.ts` is at 95%+ on all metrics, (4) no regressions in any other module's coverage. If any gaps remain, add targeted tests to close them.
- **Verification**: `npx vitest run --coverage` — all tests pass, all coverage thresholds met.
