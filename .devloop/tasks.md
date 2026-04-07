# Iteration 5 — Tasks

### TASK-001: Fix flaky cross-run resume test timeouts
- **Status**: done
- **Dependencies**: none
- **Description**: In `tests/consolidation-resume.test.ts`, increase the timeout on the four cross-run resume tests (lines 788, 823, 847, 870) from `{ timeout: 15000 }` to `{ timeout: 30000 }`. These tests use `vi.importActual()` for real filesystem I/O and intermittently time out on Windows at the current 15-second limit. See requirements.md section 1 for full context.
- **Verification**: `npx vitest run tests/consolidation-resume.test.ts` — all tests pass. Confirm the four tests at lines 788, 823, 847, 870 now have `{ timeout: 30000 }`.

### TASK-002: Add single-quote escaping to escapeHtml
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/html-report.ts:43-48`, add `.replace(/'/g, '&#39;')` to the `escapeHtml()` function's escape chain, after the existing `&quot;` replacement. Then add or update a test in the HTML report test file to verify that single quotes are escaped to `&#39;`. See requirements.md section 2.
- **Verification**: `npx vitest run tests/html-report.test.ts` — all tests pass, including a test that asserts `escapeHtml("it's")` produces `it&#39;s`.

### TASK-003: Add parseConsolidatedReport unit tests
- **Status**: pending
- **Dependencies**: none
- **Description**: Add a new test file `tests/parse-consolidated-report.test.ts` with dedicated unit tests for `parseConsolidatedReport()` from `src/consolidation.ts`. Cover these cases: (1) empty input → empty array, (2) no finding headings → empty array, (3) single finding with all fields → correctly parsed, (4) missing severity line → still parsed, (5) multiple findings across multiple areas → correct area assignment, (6) deeply nested findings (####, #####, ######) → all heading levels recognized, (7) malformed heading without `UXR-` prefix → skipped, (8) area heading starting with `## UXR-` → treated as finding context not area heading, (9) multi-line description → full description captured. See requirements.md section 3.
- **Verification**: `npx vitest run tests/parse-consolidated-report.test.ts` — all new tests pass.

### TASK-004: Improve file-manager.ts coverage and fix bare catch block
- **Status**: pending
- **Dependencies**: none
- **Description**: Two changes in `src/file-manager.ts` plus new tests. (A) Fix the bare `catch` at line 104 in `hasExistingCheckpointData()`: change to `catch (err)` and add a `debug()` call logging the error before returning false. Import `debug` from `./logger.js` if not already imported. (B) Add tests (in a new or existing file-manager test file) that: (1) simulate an `EBUSY` error on the first `rmSync` call, verify `cleanupTempDir()` retries and succeeds on subsequent attempt; (2) simulate `EBUSY` on all 5 attempts, verify `cleanupTempDir()` throws; (3) verify `hasExistingCheckpointData()` returns false when `readdirSync` throws; (4) verify the debug log is called when the catch block fires. See requirements.md sections 4 and 6.
- **Verification**: `npx vitest run tests/file-manager*.test.ts` — all tests pass. Run `npx vitest run --coverage tests/file-manager*.test.ts` and confirm `file-manager.ts` coverage is above 95% statements.

### TASK-005: Remove unused countFindings re-export from progress-display.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Remove line 95 (`export { countFindings } from './report.js';`) from `src/progress-display.ts`. Before removing, verify with grep that no source or test file imports `countFindings` from `progress-display`. If any file does, update its import to reference `report.js` instead. See requirements.md section 5.
- **Verification**: `npx vitest run tests/progress-display*.test.ts` — all tests pass. Grep for `countFindings.*progress-display` across `src/` and `tests/` returns zero matches.

### TASK-006a: Refactor ConsolidationCheckpoint interface to use structured types
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: In `src/consolidation-checkpoint.ts`, change the `ConsolidationCheckpoint` interface fields from `string | null` to structured types for the three double-serialized fields: `dedupOutput: ConsolidationResult | null`, `reassignOutput: Finding[] | null`, `hierarchyOutput: UIAreaGroup[] | null`. Import the required types (`ConsolidationResult`, `Finding`, `UIAreaGroup`) from their source modules. Keep `formatReportOutput` and `discoveryMergeOutput` as `string | null` since they hold actual text content. Update `readConsolidationCheckpoint()` validation: for the three changed fields, validate they are objects/arrays or null instead of strings. Update `createEmptyConsolidationCheckpoint()` if needed (the null defaults should still work). See requirements.md section 7.
- **Verification**: `npx vitest run tests/consolidation-checkpoint*.test.ts` — all tests pass. `npx tsc --noEmit src/consolidation-checkpoint.ts` — no type errors.

### TASK-006b: Update orchestrator to use structured checkpoint data directly
- **Status**: pending
- **Dependencies**: TASK-006a
- **Description**: In `src/orchestrator.ts`, remove the `JSON.stringify()` wrappers when writing to checkpoint fields and remove the `JSON.parse()` calls when reading them. Specifically: (1) Line 348: change `checkpoint.dedupOutput = JSON.stringify(consolidation)` to `checkpoint.dedupOutput = consolidation`. (2) Line 385: change `checkpoint.reassignOutput = JSON.stringify(findings)` to `checkpoint.reassignOutput = findings`. (3) Line 398: change `checkpoint.hierarchyOutput = JSON.stringify(groups)` to `checkpoint.hierarchyOutput = groups`. (4) Line 320: change `consolidation = JSON.parse(checkpoint.dedupOutput)` to `consolidation = checkpoint.dedupOutput`. (5) Line 375: change `findings = JSON.parse(checkpoint.reassignOutput)` to `findings = checkpoint.reassignOutput`. (6) Line 394: change `groups = JSON.parse(checkpoint.hierarchyOutput)` to `groups = checkpoint.hierarchyOutput`. See requirements.md section 7.
- **Verification**: `npx vitest run tests/orchestrator*.test.ts tests/consolidation-resume.test.ts` — all tests pass. `npx tsc --noEmit src/orchestrator.ts` — no type errors.

### TASK-006c: Update consolidation checkpoint tests for structured types
- **Status**: pending
- **Dependencies**: TASK-006a
- **Description**: Update any existing tests that create `ConsolidationCheckpoint` objects with string values for `dedupOutput`, `reassignOutput`, or `hierarchyOutput`. These fields are now structured types (`ConsolidationResult | null`, `Finding[] | null`, `UIAreaGroup[] | null`). Update test fixtures to use the actual structured data instead of `JSON.stringify()`'d strings. Verify that round-trip tests (write checkpoint → read checkpoint) work with the structured data. See requirements.md section 7.
- **Verification**: `npx vitest run tests/consolidation-checkpoint*.test.ts tests/consolidation-resume.test.ts` — all tests pass.

### TASK-007: Add --version CLI flag
- **Status**: pending
- **Dependencies**: none
- **Description**: Add a `--version` flag to the CLI in `src/cli.ts`. (1) Add `--version` to the USAGE string after `--help`, with description `Show the version number`. (2) Add `'version'` to the boolean flag check at line 113. (3) Add `'version'` to the `knownFlags` set at line 145. (4) After the `--help` handler (line 134), add a `--version` handler that reads the version from `package.json` and prints it, then calls `process.exit(0)`. Use `createRequire(import.meta.url)` from `node:module` to load `package.json`, or `readFileSync` + `JSON.parse`. (5) Add tests: verify `--version` outputs the version from `package.json` and exits, and that `--version` appears in the usage text. See requirements.md section 8.
- **Verification**: `npx vitest run tests/cli*.test.ts` — all tests pass, including new `--version` tests.
