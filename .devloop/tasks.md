# Iteration 3 — Tasks

### TASK-001: Create MIT LICENSE file
- **Status**: done
- **Dependencies**: none
- **Description**: Create a standard MIT LICENSE file at the project root. Use the current year (2026) and "UX Analysis Reporter Contributors" as the copyright holder. Reference requirements.md change #1.
- **Verification**: `test -f LICENSE && head -1 LICENSE | grep -q "MIT" && echo "PASS" || echo "FAIL"`

### TASK-002: Move distributePlan inside the try block
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/orchestrator.ts`, move the `distributePlan()` call (currently line 114) inside the `try` block (currently line 132) so that the `finally` block handles cleanup if distribution fails. The `initWorkspace()` call can remain before the `try` block. Add a test verifying workspace cleanup occurs when `distributePlan` throws. Reference requirements.md change #2.
- **Verification**: `npx vitest run tests/orchestrator.test.ts 2>&1 | tail -5`

### TASK-003: Fix trailing whitespace on blank lines in consolidation
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/consolidation.ts:699`, change `.map(l => \`  \${l}\`)` to `.map(l => l.trim() === '' ? '' : \`  \${l}\`)` so blank separator lines in indented child findings have no trailing whitespace. Update consolidation tests to assert no trailing whitespace on blank lines. Reference requirements.md change #3.
- **Verification**: `npx vitest run tests/consolidation.test.ts 2>&1 | tail -5`

### TASK-004: Replace as-string cast with runtime check in CLI
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/cli.ts:177`, replace `(raw.get('output') as string) || './uxreview-output'` with a runtime type check (e.g., `const outputRaw = raw.get('output'); ... typeof outputRaw === 'string' ? outputRaw : './uxreview-output'`), consistent with how `instancesRaw` and `roundsRaw` are handled. Add a test verifying the output flag defaults correctly when omitted. Reference requirements.md change #4.
- **Verification**: `npx vitest run tests/cli.test.ts 2>&1 | tail -5`

### TASK-005: Add file size validation to resolveTextOrFile
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/cli.ts`, after `resolveTextOrFile` reads a file, check the content length. Warn to stderr if >1MB, throw an error if >10MB. Apply to `--intro`, `--plan`, and `--scope` file reads. Inline text (not file paths) should not be subject to the size check. Add tests for both thresholds and for inline text bypass. Reference requirements.md change #5.
- **Verification**: `npx vitest run tests/cli.test.ts 2>&1 | tail -5`

### TASK-006: Document 26-screenshot suffix limit in README
- **Status**: done
- **Dependencies**: none
- **Description**: Add a note in the README under the appropriate section documenting that screenshot suffixes support a maximum of 26 screenshots per finding (a-z). Reference requirements.md change #6.
- **Verification**: `grep -q "26" README.md && echo "PASS" || echo "FAIL"`

### TASK-007: Create config module with centralized constants
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/config.ts` exporting all hardcoded constants currently scattered across the codebase. Include at minimum: `INSTANCE_TIMEOUT_MS` (30 min), `DEFAULT_CLI_TIMEOUT_MS` (5 min), `POLL_INTERVAL_MS` (1 sec), `MAX_RETRIES` (3), `MAX_RATE_LIMIT_RETRIES` (10), `DEFAULT_BASE_DELAY_MS` (10 sec), `MAX_BACKOFF_DELAY_MS` (5 min), `SPINNER_INTERVAL_MS`. Move or re-export the existing constants from `rate-limit.ts`. Do NOT update consumers yet — that's TASK-007a. Add a test that imports the config and asserts expected default values. Reference requirements.md change #7.
- **Verification**: `npx vitest run tests/config.test.ts 2>&1 | tail -5`

### TASK-007a: Migrate all hardcoded constants to use config module
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Update all source files that reference hardcoded constants to import from `src/config.ts` instead. Files to update: `orchestrator.ts`, `instance-manager.ts`, `rate-limit.ts`, `progress-display.ts`, `claude-cli.ts`. Remove the old constant declarations from `rate-limit.ts` (they now live in config). Ensure all existing tests still pass with the refactored imports. Reference requirements.md change #7.
- **Verification**: `npx vitest run 2>&1 | tail -5`

### TASK-008a: Add CLI flags for retry limits and timeouts — parsing
- **Status**: done
- **Dependencies**: TASK-007a
- **Description**: Add `--max-retries <n>`, `--instance-timeout <minutes>`, and `--rate-limit-retries <n>` to CLI argument parsing in `src/cli.ts`. Add the fields to `ParsedArgs` with defaults from `config.ts`. Validate that values are positive integers. Update the USAGE string. Add parsing tests for valid values, invalid values, and defaults. Reference requirements.md change #8.
- **Verification**: `npx vitest run tests/cli.test.ts 2>&1 | tail -5`

### TASK-008b: Thread configurable retry/timeout values through execution
- **Status**: done
- **Dependencies**: TASK-008a
- **Description**: Thread the new `ParsedArgs` fields (`maxRetries`, `instanceTimeout`, `rateLimitRetries`) from the orchestrator through to `instance-manager.ts` and rate-limit logic. Replace references to config defaults with the values from args. Update `RoundExecutionConfig` to include the new fields. Update the README to document the new flags. Add tests verifying custom values override defaults in instance execution. Reference requirements.md change #8.
- **Verification**: `npx vitest run tests/instance-manager.test.ts 2>&1 | tail -5`

### TASK-009a: Create logger utility module
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/logger.ts` with a simple logging utility. Export a `setVerbose(enabled: boolean)` function and a `debug(message: string, ...args: unknown[])` function that writes to stderr only when verbose mode is enabled. Keep it lightweight — no external dependencies. Add tests verifying debug output appears when verbose is on and is suppressed when off. Reference requirements.md change #9.
- **Verification**: `npx vitest run tests/logger.test.ts 2>&1 | tail -5`

### TASK-009b: Add --verbose CLI flag and wire logging into modules
- **Status**: done
- **Dependencies**: TASK-009a
- **Description**: Add `--verbose` boolean flag to CLI parsing in `src/cli.ts`. Add `verbose` to `ParsedArgs`. Call `setVerbose(args.verbose)` in the orchestrator before any work begins. Add debug logging calls to key points: subprocess spawn/exit in `claude-cli.ts`, file reads/writes in `file-manager.ts`, retry decisions in `instance-manager.ts`, checkpoint operations in `checkpoint.ts`, phase timing in `orchestrator.ts`. Update the USAGE string and README. Add a test verifying verbose output for at least one key operation (e.g., subprocess spawn). Reference requirements.md change #9.
- **Verification**: `npx vitest run tests/cli.test.ts tests/orchestrator.test.ts 2>&1 | tail -5`

### TASK-010a: Define consolidation checkpoint schema and read/write functions
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/consolidation-checkpoint.ts` with a `ConsolidationCheckpoint` interface tracking step completion and intermediate outputs. Steps: `dedup`, `reassign`, `hierarchy`, `format-report`, `discovery-merge`, `write-discovery`. Include `writeConsolidationCheckpoint()` and `readConsolidationCheckpoint()` functions that persist to `.uxreview-temp/consolidation-checkpoint.json`. Handle corruption (return null) consistent with the existing `checkpoint.ts` pattern. Add unit tests for write, read, corruption handling, and missing file cases. Reference requirements.md change #10.
- **Verification**: `npx vitest run tests/consolidation-checkpoint.test.ts 2>&1 | tail -5`

### TASK-010b: Integrate consolidation checkpointing into orchestrator
- **Status**: done
- **Dependencies**: TASK-010a
- **Description**: Refactor the consolidation section of `src/orchestrator.ts` (lines 171-194) to checkpoint after each step. Before each step, check the consolidation checkpoint — if the step is already marked complete, load the persisted result and skip the Claude call. After each step completes, write the checkpoint with the step's output. The consolidation steps in order: dedup (`consolidateReports`), reassign (`reassignAndRemapScreenshots`), hierarchy (`organizeHierarchically`), format report, discovery merge (`consolidateDiscoveryDocs`), write discovery. Reference requirements.md change #10.
- **Verification**: `npx vitest run tests/orchestrator.test.ts 2>&1 | tail -5`

### TASK-010c: Add consolidation checkpoint integration tests
- **Status**: done
- **Dependencies**: TASK-010b
- **Description**: Add integration tests for consolidation resumability. Test scenarios: (1) full consolidation produces checkpoints at each step, (2) resume after dedup skips dedup and runs remaining steps, (3) resume after hierarchy skips dedup+hierarchy, (4) resume after discovery merge writes final output, (5) corrupted checkpoint triggers full reconsolidation, (6) missing checkpoint triggers full consolidation. Reference requirements.md change #10.
- **Verification**: `npx vitest run tests/consolidation-resume.test.ts 2>&1 | tail -5`

### TASK-011: Add recovery documentation to README
- **Status**: done
- **Dependencies**: TASK-010b
- **Description**: Add a "Recovery and Resumption" section to the README covering: what happens on interruption during instance execution, what happens on interruption during consolidation, how to re-run to resume, how `--keep-temp` preserves intermediate state, where raw instance data lives (`.uxreview-temp/instance-*`). Reference requirements.md change #11.
- **Verification**: `grep -q "Recovery" README.md && echo "PASS" || echo "FAIL"`

### TASK-012a: Extend ProgressCallback with item-level progress events
- **Status**: done
- **Dependencies**: none
- **Description**: Extend the `ProgressCallback` interface in `src/instance-manager.ts` to include item-level progress updates: `onProgressUpdate(instanceNumber, completedItems, inProgressItems, totalItems, findingsCount)`. Call this callback from the instance execution flow at the same points where checkpoints are written, so progress data is pushed rather than polled. Reference requirements.md change #12.
- **Verification**: `npx vitest run tests/instance-manager.test.ts 2>&1 | tail -5`

### TASK-012b: Remove file-polling from ProgressDisplay
- **Status**: done
- **Dependencies**: TASK-012a
- **Description**: Remove `updateFromFiles()` and `updateAllFromFiles()` methods from `src/progress-display.ts`. Replace them with a new `updateProgress(instanceNumber, completedItems, inProgressItems, totalItems, findingsCount)` method that receives data from the callback. The timer tick should only handle rendering (ETA, spinner animation), not data fetching. Remove the imports of `readCheckpoint`, `readReportContent`, etc. from `progress-display.ts`. Make the render interval configurable via `config.ts`. Update the orchestrator's `buildProgressCallback` to wire the new `onProgressUpdate` event to the display. Update all affected tests. Reference requirements.md change #12.
- **Verification**: `npx vitest run tests/progress-display.test.ts tests/orchestrator.test.ts 2>&1 | tail -5`

### TASK-013a: Add --append CLI flag and preserve output directory
- **Status**: done
- **Dependencies**: none
- **Description**: Add `--append` boolean CLI flag to `src/cli.ts`. Add `append` to `ParsedArgs`. In `src/file-manager.ts`, modify `initOutputDir` to skip deleting the existing output directory when append mode is true (still create it if it doesn't exist). Update the USAGE string. Add tests for flag parsing and output directory preservation. Reference requirements.md change #13.
- **Verification**: `npx vitest run tests/cli.test.ts tests/file-manager.test.ts 2>&1 | tail -5`

### TASK-013b: Read existing findings and continue ID numbering in append mode
- **Status**: done
- **Dependencies**: TASK-013a
- **Description**: When `--append` is true, read the existing `report.md` from the output directory and parse out existing findings with their IDs. Determine the next available `UXR-NNN` number. Pass the existing findings and next ID offset into the consolidation pipeline so new findings get non-colliding sequential IDs. Handle edge cases: missing output directory (fresh run), corrupt/unparseable report (warn and start fresh). Add tests for ID continuation and edge cases. Reference requirements.md change #13.
- **Verification**: `npx vitest run tests/consolidation.test.ts 2>&1 | tail -5`

### TASK-013c: Cross-run deduplication and merged output in append mode
- **Status**: done
- **Dependencies**: TASK-013b
- **Description**: When `--append` is true, run deduplication across both existing and new findings (using the existing `detectDuplicates` Claude call). Merge screenshots without overwriting existing files. Merge the discovery document with the existing one. Regenerate the full report with all findings (old + new) organized hierarchically. Update the README to document the `--append` flag. Add integration tests for cross-run dedup, screenshot accumulation, and merged report output. Reference requirements.md change #13.
- **Verification**: `npx vitest run tests/consolidation.test.ts tests/integration-*.test.ts 2>&1 | tail -5`

### TASK-014a: Create HTML report generator module
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/html-report.ts` with a `formatHtmlReport(groups: UIAreaGroup[], metadata: ReportMetadata)` function. This is a pure code transformation — no Claude calls. Generate a self-contained HTML string with: inline CSS styling, table of contents with anchor links, severity color coding (critical=red, major=orange, minor=yellow, info=blue), `<details>`/`<summary>` collapsible sections per UI area, and a metadata header (URL, date, instance count, round count). Define a `ReportMetadata` interface for the metadata fields. Add tests that verify the output is valid HTML containing expected structure (TOC, sections, severity colors). Reference requirements.md change #14.
- **Verification**: `npx vitest run tests/html-report.test.ts 2>&1 | tail -5`

### TASK-014b: Add screenshot base64 embedding to HTML report
- **Status**: done
- **Dependencies**: TASK-014a
- **Description**: Extend the HTML report generator to embed screenshots as base64 `<img>` tags. Read screenshot files from the output directory's screenshots folder, encode as base64 with the appropriate MIME type (image/png). Insert `<img>` tags at the appropriate positions next to their associated findings. Handle missing screenshots gracefully (skip the image, don't error). Add tests for base64 encoding, correct placement, and missing screenshot handling. Reference requirements.md change #14.
- **Verification**: `npx vitest run tests/html-report.test.ts 2>&1 | tail -5`

### TASK-014c: Add --format CLI flag and wire HTML output into orchestrator
- **Status**: pending
- **Dependencies**: TASK-014b
- **Description**: Add `--format <markdown|html>` CLI option to `src/cli.ts` (default: `markdown`). Add `format` to `ParsedArgs`. In the orchestrator, after consolidation, call either `formatConsolidatedReport` (existing markdown) or `formatHtmlReport` (new) based on the format flag. Write to `report.md` or `report.html` accordingly. Update the USAGE string and README. Add tests for flag parsing, validation (reject unknown formats), and correct output filename. Reference requirements.md change #14.
- **Verification**: `npx vitest run tests/cli.test.ts tests/orchestrator.test.ts 2>&1 | tail -5`

### TASK-015: Add --dry-run mode
- **Status**: pending
- **Dependencies**: TASK-007a
- **Description**: Add `--dry-run` boolean CLI flag to `src/cli.ts`. Add `dryRun` to `ParsedArgs`. In the orchestrator, when dry-run is true: call `distributePlan` normally (one Claude call), then print to stdout the instance count, round count, plan chunks per instance, extracted areas per instance, and the evaluation scope. Skip instance spawning and consolidation. Clean up any temp directory or skip creating it. Exit cleanly with code 0. Update the USAGE string and README. Add tests verifying distribution runs, instances don't spawn, and output contains expected content. Reference requirements.md change #15.
- **Verification**: `npx vitest run tests/cli.test.ts tests/orchestrator.test.ts 2>&1 | tail -5`

### TASK-016a: Update HierarchicalFinding to support recursive nesting
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/consolidation.ts`, change the `HierarchicalFinding` interface so `children` is `HierarchicalFinding[]` instead of `Finding[]`. Update `buildHierarchy()` to construct a tree of arbitrary depth from flat `CHILD_OF` mappings. Add cycle detection — if a finding would be its own ancestor, break the cycle by keeping it at the top level. Update the hierarchy prompt to remove the "A finding cannot be both a parent and a child" constraint (line ~529). Add tests for multi-level tree building, cycle detection, and backward compatibility with single-level hierarchies. Reference requirements.md change #16.
- **Verification**: `npx vitest run tests/consolidation.test.ts 2>&1 | tail -5`

### TASK-016b: Update report formatting for multi-level hierarchy
- **Status**: pending
- **Dependencies**: TASK-016a, TASK-014a
- **Description**: Update `formatConsolidatedReport()` in `src/consolidation.ts` to render multi-level indentation. Each nesting level adds one indent level. Heading levels increase with depth (`###` top-level, `####` children, `#####` grandchildren), capping at `######`. Update `formatHtmlReport()` in `src/html-report.ts` to render multi-level nesting with corresponding indentation and nested collapsible sections. Add tests for markdown and HTML output at multiple nesting depths. Reference requirements.md change #16.
- **Verification**: `npx vitest run tests/consolidation.test.ts tests/html-report.test.ts 2>&1 | tail -5`
