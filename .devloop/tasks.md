# Tasks — Iteration 12

### TASK-001a: Add browser-open mock to integration-happy-path, integration-append-mode, integration-multi-instance
- **Status**: pending
- **Dependencies**: none
- **Description**: Add `vi.mock('../src/browser-open.js', () => ({ openInBrowser: vi.fn() }))` to the module-level mock block in each of these 3 test files: `tests/integration-happy-path.test.ts`, `tests/integration-append-mode.test.ts`, `tests/integration-multi-instance.test.ts`. Place it alongside existing `vi.mock` calls. See requirements.md Item 1 for full context.
- **Verification**: Run `npx vitest run tests/integration-happy-path.test.ts tests/integration-append-mode.test.ts tests/integration-multi-instance.test.ts` — all tests pass. Grep each file for `browser-open` to confirm the mock is present.

### TASK-001b: Add browser-open mock to integration-edge-cases, integration-failure-retry, integration-dedup-consolidation, consolidation-resume
- **Status**: pending
- **Dependencies**: none
- **Description**: Add `vi.mock('../src/browser-open.js', () => ({ openInBrowser: vi.fn() }))` to the module-level mock block in each of these 4 test files: `tests/integration-edge-cases.test.ts`, `tests/integration-failure-retry.test.ts`, `tests/integration-dedup-consolidation.test.ts`, `tests/consolidation-resume.test.ts`. Place it alongside existing `vi.mock` calls. See requirements.md Item 1 for full context.
- **Verification**: Run `npx vitest run tests/integration-edge-cases.test.ts tests/integration-failure-retry.test.ts tests/integration-dedup-consolidation.test.ts tests/consolidation-resume.test.ts` — all tests pass. Grep each file for `browser-open` to confirm the mock is present.

### TASK-002: Migrate browser-open.ts from exec() to execFile()
- **Status**: pending
- **Dependencies**: TASK-001a, TASK-001b
- **Description**: In `src/browser-open.ts`, replace `exec()` with `execFile()` from `node:child_process`. Platform-specific commands: Windows uses `execFile('cmd', ['/c', 'start', '""', filePath], cb)`, macOS uses `execFile('open', [filePath], cb)`, Linux uses `execFile('xdg-open', [filePath], cb)`. Update `tests/browser-open.test.ts` to mock `execFile` instead of `exec` and assert command + args array instead of a command string. Preserve all 5 existing test scenarios (3 platform + 2 error handling). See requirements.md Item 2 for full context.
- **Verification**: Run `npx vitest run tests/browser-open.test.ts` — all tests pass. Grep `src/browser-open.ts` for `execFile` (should be present) and `exec(` or `import.*\bexec\b` (should NOT be present — only `execFile`).

### TASK-003: Raise instance-manager/spawning.ts branch coverage above 95%
- **Status**: pending
- **Dependencies**: none
- **Description**: Add tests covering 3 uncovered branches in `src/instance-manager/spawning.ts`. (1) Custom `promptBuilder` test: call `spawnInstance` or `spawnInstanceWithResume` with a `promptBuilder` function in config, verify it's called and its return value is used as the prompt. (2) `stderr` truthy test: mock `runClaude` to return `{ success: false, stderr: 'Some error', exitCode: 1 }`, verify state.error uses stderr not the exitCode fallback. (3) Non-Error throw test: mock `runClaude` to throw a string value, verify state.error is `String(err)`. Check `tests/instance-manager.test.ts` and `tests/coverage-gaps.test.ts` first for where best to add these. See requirements.md Item 3.
- **Verification**: Run `npx vitest run --coverage tests/instance-manager.test.ts tests/coverage-gaps.test.ts` — confirm `instance-manager/spawning.ts` branch coverage is above 95%.

### TASK-004: Raise instance-manager/rounds.ts branch coverage above 95%
- **Status**: pending
- **Dependencies**: none
- **Description**: Add a test covering the full "initial spawn fails -> retry -> retries exhaust -> permanent failure" path in `src/instance-manager/rounds.ts`. Configure `runInstanceRounds` with `maxRetries: 1` and all progress callbacks (`onFailure`, `onPermanentlyFailed`). Mock `runClaude` to always fail (non-rate-limit). Assert: result has `permanentlyFailed: true`, `onFailure` was called, `onPermanentlyFailed` was called, and retry errors array has the expected entries. Check `tests/round-execution.test.ts` and `tests/coverage-gaps.test.ts` first for where best to add this. See requirements.md Item 4.
- **Verification**: Run `npx vitest run --coverage tests/round-execution.test.ts tests/coverage-gaps.test.ts` — confirm `instance-manager/rounds.ts` branch coverage is above 95%.
