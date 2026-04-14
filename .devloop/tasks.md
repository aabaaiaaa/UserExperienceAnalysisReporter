# Iteration 11 Tasks

### TASK-001: Add browser-open mock to orchestrator.test.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Add a module-level `vi.mock('../src/browser-open.js', () => ({ openInBrowser: vi.fn() }))` to `tests/orchestrator.test.ts` as a defensive safety net. This follows the same pattern already used in `tests/plan-orchestrator.test.ts` (lines 94-97). No new test assertions needed — this prevents real browser opens if any test accidentally sets `suppressOpen: false`. See requirements.md Item 1 for full context.
- **Verification**: Run `npx vitest run tests/orchestrator.test.ts` — all existing tests pass. Grep for `browser-open` in the file to confirm the mock is present.

### TASK-002: Raise instance-manager.ts branch coverage — retry exhaust path
- **Status**: done
- **Dependencies**: none
- **Description**: Add a targeted test covering the "round fails → retry loop → retries exhaust → permanently failed" path in `runInstanceRounds` (lines 562-568, 603, 611 of `src/instance-manager.ts`). First check `tests/round-execution.test.ts` and `tests/coverage-gaps.test.ts` for existing similar tests — add the missing coverage there if possible, otherwise add to `tests/instance-manager.test.ts`. The test should: configure `runInstanceRounds` with a small `maxRetries` (e.g., 1), mock `runClaude` to always fail with a non-rate-limit error, and assert that `permanentlyFailed: true`, `progress.onFailure` was called, `progress.onPermanentlyFailed` was called, and `retries[0].errors` has the expected entries. See requirements.md Item 2 for full context.
- **Verification**: Run `npx vitest run --coverage tests/instance-manager.test.ts tests/round-execution.test.ts tests/coverage-gaps.test.ts` and confirm `instance-manager.ts` branch coverage is above 95%.

### TASK-003: Raise html-report.ts branch coverage — empty refs fallback
- **Status**: done
- **Dependencies**: none
- **Description**: Add a targeted test in `tests/html-report.test.ts` covering the `refs.length === 0` fallback in `renderScreenshots` (lines 85-87 of `src/html-report.ts`). Call `formatHtmlReport` with a finding whose screenshot field is `" , , "` (whitespace and commas only — after split+filter, no valid refs remain). Verify the output contains the raw screenshot field as escaped HTML text, not `<img>` tags. See requirements.md Item 2 for full context.
- **Verification**: Run `npx vitest run --coverage tests/html-report.test.ts` and confirm `html-report.ts` branch coverage is above 95%.

### TASK-004: Raise progress-display.ts branch coverage — null mtime path
- **Status**: done
- **Dependencies**: none
- **Description**: Add a targeted test in `tests/progress-display.test.ts` covering the null `latestMtime` coalescing path in `pollCheckpoints` (lines 420-421 of `src/progress-display.ts`). Set up a `ProgressDisplay` with an instance directory where none of the expected files exist (no checkpoint, report, discovery, or screenshots files). Call `pollCheckpoints()` and verify the instance's `latestMtime` is `undefined`. See requirements.md Item 2 for full context.
- **Verification**: Run `npx vitest run --coverage tests/progress-display.test.ts` and confirm `progress-display.ts` branch coverage is above 95%.

### TASK-005: Add debug logging to hierarchy fallback
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/consolidation/hierarchy.ts`, add a `debug()` call at line 207 (before the flat-structure fallback return) when `result.success` is false: `debug('Hierarchy determination failed — falling back to flat structure')`. Import `debug` from `../logger.js` if not already imported. See requirements.md Item 3 for full context.
- **Verification**: Run `npx vitest run tests/consolidation.test.ts` — all existing tests pass. Grep for `falling back to flat structure` in `src/consolidation/hierarchy.ts` to confirm the debug call is present.

### TASK-006a: Extract instance-manager types into instance-manager/types.ts
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: Create `src/instance-manager/types.ts` containing all type/interface exports from `src/instance-manager.ts`: `InstanceStatus` (line 12), `InstanceConfig` (lines 14-31), `InstanceState` (lines 33-40), `DEFAULT_MAX_RETRIES` (lines 42-43), `RetryInfo` (lines 45-54), `ProgressCallback` (lines 334-351), `RoundExecutionConfig` (lines 353-378), `RoundExecutionResult` (lines 380-394). Move these definitions exactly as-is. Import only what's needed from other modules (e.g., `ClaudeCliResult` from `../claude-cli.js`, `MAX_RETRIES` from `../config.js`). This is a pure extraction — zero behavior changes. See requirements.md Item 4 for full context.
- **Verification**: Run `npx tsc --noEmit` — no type errors.

### TASK-006b: Extract prompt builders into instance-manager/prompts.ts
- **Status**: done
- **Dependencies**: TASK-006a
- **Description**: Create `src/instance-manager/prompts.ts` containing `buildInstancePrompt` (lines 62-138) and `buildDiscoveryPrompt` (lines 146-221) from `src/instance-manager.ts`. Import types from `./types.js` and other dependencies from their original modules (`../file-manager.js`, `../discovery.js`, `../report.js`, `../screenshots.js`, `../checkpoint.js`). Move these functions exactly as-is. See requirements.md Item 4 for full context.
- **Verification**: Run `npx tsc --noEmit` — no type errors.

### TASK-006c: Extract instance spawning into instance-manager/spawning.ts
- **Status**: done
- **Dependencies**: TASK-006a
- **Description**: Create `src/instance-manager/spawning.ts` containing `spawnInstance` (lines 229-260), `spawnInstances` (lines 269-283), and `spawnInstanceWithResume` (lines 291-328) from `src/instance-manager.ts`. Import types from `./types.js`, `buildInstancePrompt` from `./prompts.js`, and other dependencies from their original modules (`../claude-cli.js`, `../file-manager.js`, `../checkpoint.js`, `../config.js`). Move these functions exactly as-is. See requirements.md Item 4 for full context.
- **Verification**: Run `npx tsc --noEmit` — no type errors.

### TASK-006d: Extract round execution into instance-manager/rounds.ts
- **Status**: pending
- **Dependencies**: TASK-006a, TASK-006b, TASK-006c
- **Description**: Create `src/instance-manager/rounds.ts` containing `handleRateLimitRetries` (private, lines 406-452), `emitProgressUpdate` (private, lines 458-476), and `runInstanceRounds` (exported, lines 490-639) from `src/instance-manager.ts`. Import types from `./types.js`, spawning functions from `./spawning.js`, and other dependencies from their original modules (`../checkpoint.js`, `../discovery.js`, `../report.js`, `../rate-limit.js`, `../config.js`, `../logger.js`). Move these functions exactly as-is. See requirements.md Item 4 for full context.
- **Verification**: Run `npx tsc --noEmit` — no type errors.

### TASK-006e: Create barrel index.ts, update all imports, delete original instance-manager.ts
- **Status**: pending
- **Dependencies**: TASK-006a, TASK-006b, TASK-006c, TASK-006d
- **Description**: Create `src/instance-manager/index.ts` as a barrel file re-exporting all public APIs from the submodules, plus the re-exports of `killAllChildProcesses` and `getActiveProcessCount` from `../claude-cli.js`. Update all import paths in 3 source files (`src/orchestrator.ts`, `src/plan-orchestrator.ts`, `src/progress-callbacks.ts`) and 9 test files (`tests/instance-manager.test.ts`, `tests/orchestrator.test.ts`, `tests/plan-orchestrator.test.ts`, `tests/coverage-gaps.test.ts`, `tests/failure-retry-resume.test.ts`, `tests/progress-recalibration.test.ts`, `tests/rate-limit.test.ts`, `tests/round-execution.test.ts`, `tests/verify-task-007.test.ts`) to use the new barrel path. Also update `vi.mock` paths in any test files that mock `instance-manager`. Delete the original `src/instance-manager.ts`. See requirements.md Item 4 for full context.
- **Verification**: Run `npx vitest run tests/instance-manager.test.ts tests/round-execution.test.ts tests/coverage-gaps.test.ts tests/failure-retry-resume.test.ts tests/verify-task-007.test.ts tests/progress-recalibration.test.ts tests/rate-limit.test.ts tests/orchestrator.test.ts tests/plan-orchestrator.test.ts` — all tests pass. Run `npx tsc --noEmit` — no type errors. Grep for remaining imports of `./instance-manager.js` or `../src/instance-manager.js` outside the new directory (should find none).
