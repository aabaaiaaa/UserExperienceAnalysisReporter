# Iteration 9 — Tasks

### TASK-001: Fix e2e test missing `suppressOpen` and other required fields
- **Status**: done
- **Dependencies**: none
- **Description**: Add the missing fields (`verbose`, `suppressOpen`, `maxRetries`, `instanceTimeout`, `rateLimitRetries`, `append`) to the `ParsedArgs` object in `tests/e2e.test.ts:89-99`. The critical fix is `suppressOpen: true` which prevents the test from opening the HTML report in the browser. Other fields should match CLI defaults. See requirements Item 0.
- **Verification**: Run `npx vitest run tests/e2e.test.ts --passWithNoTests` (the e2e test requires Claude CLI so it won't run in CI, but type-check with `npx tsc --noEmit`). Grep for `suppressOpen` in the file to confirm it's present.

### TASK-002: Extract inline `formatDuration` from `orchestrator.ts`
- **Status**: done
- **Dependencies**: none
- **Description**: Remove the inline `formatDuration` arrow function at `orchestrator.ts:395-400`. Import `formatDuration` from `progress-display.ts` instead — add it to the existing `ProgressDisplay` import at line 27. See requirements Item 1.
- **Verification**: Run `npx vitest run tests/orchestrator.test.ts`. Grep `src/orchestrator.ts` and `src/plan-orchestrator.ts` for `const formatDuration` — should return zero matches.

### TASK-003: Handle signal interrupts gracefully in `index.ts`
- **Status**: done
- **Dependencies**: none
- **Description**: In `index.ts`, import `SignalInterruptError` from `orchestrator.js` and `PlanSignalInterruptError` from `plan-orchestrator.js`. In each `.catch()` handler, check if the error is a signal interrupt and silently return (the signal handler already sets `process.exitCode`). Only print "Fatal error:" and call `process.exit(1)` for non-signal errors. See requirements Item 2.
- **Verification**: Add a targeted test verifying that when `orchestrate` rejects with `SignalInterruptError`, `console.error` is NOT called with "Fatal error" and `process.exit(1)` is NOT called. Run `npx vitest run tests/index.test.ts` (create the test file if it doesn't exist, placing it alongside other test files).

### TASK-004: Remove dead auto-detect code in `plan-orchestrator.ts`
- **Status**: done
- **Dependencies**: none
- **Description**: Delete the dead `if (args.instances === 0 ...)` block at `plan-orchestrator.ts:93-101`. Remove the `extractAreasFromPlanChunk` import if it becomes unused. Remove the `MAX_AUTO_INSTANCES` import if it becomes unused. See requirements Item 3.
- **Verification**: Run `npx vitest run tests/plan-orchestrator.test.ts`. Grep `src/plan-orchestrator.ts` for `args.instances === 0` — should return zero matches.

### TASK-005: Shared arg parser for CLI
- **Status**: done
- **Dependencies**: none
- **Description**: Extract a shared `parseRawArgv(argv, booleanFlags, onError)` function in `cli.ts` that both `parseRawArgs` and `parsePlanRawArgs` delegate to. Define the boolean flag sets as constants. The two existing functions become thin wrappers. This is a pure refactoring — no behavior change. See requirements Item 6.
- **Verification**: Run `npx vitest run tests/cli.test.ts` — all existing tests pass. Grep `src/cli.ts` for `parseRawArgv` to confirm the shared function exists.

### TASK-006: Raise `instance-manager.ts` branch coverage — Promise rejection path
- **Status**: pending
- **Dependencies**: none
- **Description**: Add a test to `tests/instance-manager.test.ts` for the `Promise.allSettled` rejection path in `runParallelInstances()` at lines 277-279. Mock `spawnInstance` to reject (throw, not return a failure status). Verify the handler creates a proper failed result with the rejection reason as the error message. See requirements Item 5.
- **Verification**: Run `npx vitest run tests/instance-manager.test.ts` — all tests pass including the new one.

### TASK-007: Raise `instance-manager.ts` branch coverage — synthetic failure path
- **Status**: pending
- **Dependencies**: none
- **Description**: Add a test to `tests/instance-manager.test.ts` for the synthetic failure path at lines 435-440 in `runSingleInstanceWithRetries()`. Set up a scenario where `respawn()` catches an error internally so `latestState.result` is undefined but `latestState.error` is set. Verify the synthetic failure object has `stdout: ''`, `stderr` containing the error, `exitCode: 1`, `success: false`. See requirements Item 5.
- **Verification**: Run `npx vitest run --coverage tests/instance-manager.test.ts` — branch coverage should be above 95%.

### TASK-008: Add end-to-end test for plan subcommand
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: Create `tests/e2e-plan.test.ts` mirroring the structure of `tests/e2e.test.ts`. Start the test fixture web app, construct a complete `ParsedPlanArgs` object (with `suppressOpen: true` and all required fields), call `runPlanDiscovery(args)` with 1 instance and 1 round. Verify: `discovery.html` exists and has content, `plan.md` exists and has content, `discovery.html` contains at least one discovery area, `plan.md` contains structured plan sections. Clean up output and temp dirs. This test should NOT run in the normal `vitest run` suite — configure it like the existing e2e test. See requirements Item 4.
- **Verification**: Run `npx vitest run tests/e2e-plan.test.ts` (requires Claude CLI and Playwright MCP). The test should pass and no browser should open.
