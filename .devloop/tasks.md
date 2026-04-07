# Iteration 4 — Tasks

### TASK-001a: Fix failing tests in progress-recalibration.test.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Replace all `display.updateFromFiles(N)` calls in `tests/progress-recalibration.test.ts` with the equivalent `display.updateProgress(instanceNumber, completedItems, inProgressItems, totalItems, findingsCount)` calls. Derive the arguments from the mock checkpoint data each test sets up (e.g., a checkpoint with 3 items where 1 is complete → `updateProgress(1, 1, 1, 3, 0)`). Call sites are at lines 128, 229, 262, 291, 308, 326, 354, 375. See requirements.md change #1 for full context.
- **Verification**: `npx vitest run tests/progress-recalibration.test.ts`

### TASK-001b: Fix failing tests in integration-dedup-consolidation.test.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Two fixes in `tests/integration-dedup-consolidation.test.ts`: (1) Line 1110: change `parent.children[0].id` to `parent.children[0].finding.id`. (2) Lines 1130-1152: wrap each child object in the `children` array as `{ finding: { ...existingObject }, children: [] }` to match the `HierarchicalFinding` interface. See requirements.md change #1 for full context.
- **Verification**: `npx vitest run tests/integration-dedup-consolidation.test.ts`

### TASK-002a: Modify initTempDir to preserve checkpoint data on re-run
- **Status**: done
- **Dependencies**: TASK-001a, TASK-001b
- **Description**: In `src/file-manager.ts`, modify `initTempDir()` so it does not unconditionally wipe `.uxreview-temp/`. Before calling `cleanupTempDir()`, check for `consolidation-checkpoint.json` and instance checkpoint files. If checkpoint data exists, preserve checkpoint files and completed instance output directories — only clean instance directories that will be re-initialized. If no checkpoint data exists, clean as before (fresh run). See requirements.md change #2 for full context.
- **Verification**: `npx vitest run tests/file-manager.test.ts`

### TASK-002b: Add integration test for cross-run resume
- **Status**: done
- **Dependencies**: TASK-002a
- **Description**: Add an integration test that simulates an interrupted run followed by a restart. The test should: (1) Set up a `.uxreview-temp/` directory with a consolidation checkpoint indicating partial completion (e.g., dedup done, hierarchy not started). (2) Call `initTempDir()` / `initWorkspace()`. (3) Verify the consolidation checkpoint file survives. (4) Verify consolidation resumes from the correct step. See requirements.md change #2 for full context.
- **Verification**: `npx vitest run tests/consolidation-resume.test.ts`

### TASK-003a: Replace process.exit with flag-based signal handling
- **Status**: done
- **Dependencies**: TASK-001a, TASK-001b
- **Description**: In `src/orchestrator.ts:147-151`, replace `process.exit(130/143)` in the signal handler with a flag-based approach. The handler should: (1) kill child processes, (2) stop the display, (3) set `process.exitCode` to 130 or 143, (4) set a signal flag that causes the main async function to reject/return early so the `try` block exits and `finally` runs. The `finally` block at line 388 already handles listener removal, display stop, and temp cleanup. See requirements.md change #3 for full context.
- **Verification**: `npx vitest run tests/orchestrator.test.ts`

### TASK-003b: Add test for signal handler finally-block execution
- **Status**: done
- **Dependencies**: TASK-003a
- **Description**: Add a test in the orchestrator test suite that verifies the `finally` block executes when a signal is received. The test should confirm: (1) signal listeners are deregistered, (2) temp directory cleanup runs when `--keep-temp` is false. See requirements.md change #3 for full context.
- **Verification**: `npx vitest run tests/orchestrator.test.ts`

### TASK-004a: Clean up backward-compat re-exports in rate-limit.ts
- **Status**: done
- **Dependencies**: TASK-001a, TASK-001b
- **Description**: Update all test file imports that reference `DEFAULT_BASE_DELAY_MS`, `MAX_BACKOFF_DELAY_MS`, or `MAX_RATE_LIMIT_RETRIES` from `rate-limit.ts` (or `../rate-limit.js`) to import from `config.ts` (or `../config.js`) instead. Then remove the re-export line from `src/rate-limit.ts:10` (`export { DEFAULT_BASE_DELAY_MS, MAX_BACKOFF_DELAY_MS, MAX_RATE_LIMIT_RETRIES }`). Keep the internal imports on lines 3-5 since `calculateBackoff` uses them as default parameters. See requirements.md change #8 for full context.
- **Verification**: `npx vitest run tests/rate-limit.test.ts`

### TASK-004b: Extract shared rate-limit retry utility
- **Status**: done
- **Dependencies**: TASK-004a
- **Description**: Extract a general-purpose rate-limit retry function from `instance-manager.ts:323` (`handleRateLimitRetries`) into `src/rate-limit.ts`. The new utility should accept: (1) an async function to retry, (2) a max retry count (default from `MAX_RATE_LIMIT_RETRIES` config), and (3) use exponential backoff with jitter via the existing `calculateBackoff`. It should detect rate-limit errors using the existing `isRateLimitError` function. Refactor `instance-manager.ts` to use the shared utility internally. See requirements.md change #4.
- **Verification**: `npx vitest run tests/rate-limit.test.ts && npx vitest run tests/instance-manager.test.ts`

### TASK-004c: Apply rate-limit retries to consolidation Claude calls
- **Status**: done
- **Dependencies**: TASK-004b
- **Description**: Apply the shared rate-limit retry utility (from TASK-004b) to all Claude calls in `src/consolidation.ts`: dedup call (~line 254), hierarchy determination per area (~line 882 inside the `for...of` loop), and discovery merge (~line 857). Wrap each `callClaude` invocation with the retry utility. See requirements.md change #4.
- **Verification**: `npx vitest run tests/consolidation.test.ts`

### TASK-005: Add code comment explaining sequential consolidation
- **Status**: done
- **Dependencies**: none
- **Description**: Add a code comment above the `for...of` loop in `organizeHierarchically()` at `src/consolidation.ts:882` explaining: (1) the loop is intentionally sequential, (2) parallelizing with Promise.all would create race conditions with multiple Claude instances touching shared files, (3) the consolidation phase is short and does not benefit from parallelism. See requirements.md change #5.
- **Verification**: `npx vitest run tests/consolidation.test.ts`

### TASK-006: Remove deprecated POLL_INTERVAL_MS from config
- **Status**: done
- **Dependencies**: none
- **Description**: Remove the `POLL_INTERVAL_MS` export from `src/config.ts:36`. No consumer imports it — it is dead code. The `@deprecated` annotation already points to `RENDER_INTERVAL_MS` as the replacement. See requirements.md change #6.
- **Verification**: `npx vitest run tests/config.test.ts`

### TASK-007: Deduplicate countFindings function
- **Status**: pending
- **Dependencies**: none
- **Description**: Move the `countFindings` function to `src/report.ts` (which already handles finding/report logic) and export it. Update `src/instance-manager.ts:356` and `src/progress-display.ts:95` to import from `report.ts` instead of defining their own copies. Remove both duplicate definitions. The function uses a regex to count `### UXR-` headings in report content. See requirements.md change #7.
- **Verification**: `npx vitest run tests/report.test.ts && npx vitest run tests/instance-manager.test.ts && npx vitest run tests/progress-display.test.ts`

### TASK-008: Enforce 26-screenshot limit in code
- **Status**: pending
- **Dependencies**: none
- **Description**: Add a guard at the top of `buildNewScreenshotFilenames()` in `src/consolidation.ts:372` that throws an error if `count > 26`: `throw new Error('Maximum 26 screenshots per finding (got ${count})')`. Add tests: (1) count = 27 throws, (2) count = 26 succeeds (boundary case). See requirements.md change #9.
- **Verification**: `npx vitest run tests/consolidation.test.ts`
