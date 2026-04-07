# Iteration 2 — Tasks

### TASK-001: Rename output report file from consolidated-report.md to report.md
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/orchestrator.ts` (line ~175), change the output filename from `consolidated-report.md` to `report.md`. Search the codebase for any other references to `consolidated-report.md` (tests, constants, etc.) and update them all. See requirements.md change #1.
- **Verification**: `npx vitest run tests/orchestrator --reporter=verbose` passes, and grep confirms no remaining references to `consolidated-report.md` in src/ or tests/.

### TASK-002: Add files field to package.json
- **Status**: pending
- **Dependencies**: none
- **Description**: Add a `"files"` array to `package.json` restricting published contents to `["dist/", "README.md", "LICENSE"]`. This prevents test fixtures, `.devloop/`, and internal files from being included in npm publish. See requirements.md change #2.
- **Verification**: Run `npm pack --dry-run` and confirm only dist/, README.md, LICENSE, and package.json are listed.

### TASK-003: Remove shell: true from Claude CLI spawn
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/claude-cli.ts` (line ~40), remove the `shell: true` option from the `spawn` call. The `claude` command should be invoked directly without a shell wrapper. Ensure it works on both Windows and Unix — on Windows, the executable may need to be resolved as `claude.cmd` or the full path. Update any tests that depend on shell behavior. See requirements.md change #3.
- **Verification**: `npx vitest run tests/claude-cli --reporter=verbose` passes. Grep confirms no `shell: true` in `src/claude-cli.ts`.

### TASK-004: Add child process registry to instance manager
- **Status**: pending
- **Dependencies**: TASK-003
- **Description**: Modify `src/instance-manager.ts` (or `src/claude-cli.ts`) to maintain a registry of active child process references (the `ChildProcess` objects returned by `spawn`). Expose a function to kill all active child processes (e.g., `killAllChildProcesses()`). This is the prerequisite for the signal handler in TASK-005. See requirements.md change #4.
- **Verification**: `npx vitest run tests/instance-manager --reporter=verbose` passes. The new `killAllChildProcesses` function exists and is exported.

### TASK-005: Add SIGINT/SIGTERM handler in orchestrator
- **Status**: pending
- **Dependencies**: TASK-004
- **Description**: In `src/orchestrator.ts`, register process signal handlers for `SIGINT` and `SIGTERM` that: (1) call the `killAllChildProcesses()` function from TASK-004, (2) stop the progress display, (3) exit the process. The handler should be registered before instances are spawned and cleaned up in the finally block. Add tests that verify signal handling kills child processes. See requirements.md change #4.
- **Verification**: `npx vitest run tests/orchestrator --reporter=verbose` passes, including new signal handling tests.

### TASK-006: Raise coverage thresholds to 95%
- **Status**: pending
- **Dependencies**: none
- **Description**: In `vitest.config.ts`, change all four coverage threshold values (statements, branches, functions, lines) from 80 to 95. See requirements.md change #5.
- **Verification**: `npx vitest run --coverage` passes with thresholds at 95%.

### TASK-007: Add --keep-temp CLI flag and post-run cleanup
- **Status**: pending
- **Dependencies**: TASK-009
- **Description**: (1) Add `--keep-temp` boolean flag to CLI argument parsing in `src/cli.ts` (default: false). (2) Pass the flag value through to the orchestrator. (3) In the `finally` block of `orchestrate` in `src/orchestrator.ts`, call `cleanupTempDir()` when `--keep-temp` is false. (4) Update the README to document the new flag. (5) Add tests for both `--keep-temp true` (temp dir preserved) and default (temp dir cleaned up). See requirements.md change #6.
- **Verification**: `npx vitest run tests/cli tests/orchestrator --reporter=verbose` passes, including new --keep-temp tests.

### TASK-008: Remove placeholder.test.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Find and delete the placeholder test file (likely `tests/placeholder.test.ts` or `src/__tests__/placeholder.test.ts`). See requirements.md change #7.
- **Verification**: Glob confirms no file matching `**/placeholder.test.*` exists in the project.

### TASK-009: Make cleanupTempDir async and fix spin-wait busy loop
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/file-manager.ts`, make `cleanupTempDir` an async function. Replace the synchronous busy-wait loop (lines ~73-74) with `await new Promise(resolve => setTimeout(resolve, delay))`. Update all callers throughout the codebase to await the now-async function. Update tests accordingly. See requirements.md change #9.
- **Verification**: `npx vitest run tests/file-manager --reporter=verbose` passes. Grep confirms no `while (Date.now()` spin-wait pattern in `src/file-manager.ts`.

### TASK-010: Refactor duplicated rate-limit retry logic
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/instance-manager.ts`, extract the rate-limit detection and exponential backoff logic (duplicated at lines ~345-364 and ~396-415) into a shared helper function. Both call sites should use the shared helper. Rate-limit retries should be counted globally across the instance's execution, not reset per normal retry attempt. The helper can live in `src/rate-limit.ts` if that module already has related utilities, or as a private function in `src/instance-manager.ts`. Update tests to cover the refactored logic and verify global retry counting. See requirements.md change #8.
- **Verification**: `npx vitest run tests/instance-manager tests/rate-limit --reporter=verbose` passes. Grep confirms only one rate-limit retry loop exists (the shared helper), not two duplicate loops.

### TASK-011: Fix child finding indentation bug in consolidation
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/consolidation.ts` (lines ~698-699), fix the indentation logic for child findings in the hierarchical report. The current code `split('\n').map(l => l ? '  ' + l : l).join('\n')` skips blank lines. Change it to indent all lines uniformly. Use `.map(l => '  ' + l)` or equivalent. Update tests to verify correct indentation of child findings including blank lines. See requirements.md change #10.
- **Verification**: `npx vitest run tests/consolidation --reporter=verbose` passes, including a test that verifies blank lines in child findings are indented correctly.
