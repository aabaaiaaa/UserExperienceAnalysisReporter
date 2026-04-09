# UX Analysis Reporter — Iteration 5 Requirements

## Overview

This iteration addresses all remaining bugs, test gaps, code quality issues, and technical debt identified in the iteration 4 code review. It also adds a `--version` CLI flag. There are no new analysis features — the focus is on stability, test reliability, defensive coding, and cleanup.

All changes build on the existing codebase. The prior iteration left the project at 847/847 tests passing across 32 test files with 98.18% statement coverage. This iteration improves test reliability, closes coverage gaps, hardens HTML escaping, eliminates double-serialized checkpoint data, and adds a version flag.

---

## Bug Fixes

### 1. Fix flaky cross-run resume test timeouts

**Problem:** Two cross-run resume tests in `tests/consolidation-resume.test.ts` intermittently time out on Windows. The tests at lines 788 and 870 use `vi.importActual()` to bypass mocks and call the real `initTempDir()`, which involves filesystem I/O including directory creation and cleanup. The current 15-second per-test timeout is occasionally insufficient on Windows.

**Fix:** Increase the timeout on the four cross-run resume tests (lines 788, 823, 847, 870) from `{ timeout: 15000 }` to `{ timeout: 30000 }`. Alternatively, set `{ timeout: 30000 }` on the parent `describe('cross-run resume: initTempDir preserves checkpoint data')` block at line 771 to apply uniformly.

**Testing:** Run the cross-run resume tests multiple times; they should no longer time out intermittently.

---

### 2. Add single-quote escaping to `escapeHtml()`

**Problem:** `escapeHtml()` in `src/html-report.ts:43-48` escapes `&`, `<`, `>`, and `"` but does not escape single quotes (`'`). Currently safe because all HTML attribute values in the template use double quotes. However, if the template is ever changed to use single-quoted attributes, this becomes an XSS vector.

**Fix:** Add `.replace(/'/g, '&#39;')` to the escape chain in `escapeHtml()`, after the existing `&quot;` replacement.

**Testing:** Update or add a test that verifies single quotes are escaped to `&#39;`. Existing HTML report tests should continue to pass.

---

## Test Improvements

### 3. Add `parseConsolidatedReport()` unit tests

**Problem:** `parseConsolidatedReport()` in `src/consolidation.ts:402` is exported and used in append mode, but only tested indirectly via integration tests. Edge cases like malformed headings, missing severity lines, empty input, and deeply nested findings lack dedicated unit tests.

**Fix:** Add a focused test file (or a new `describe` block in an existing consolidation test file) with unit tests covering:

- Empty input string → returns empty array
- Input with no finding headings → returns empty array
- Standard single finding with all fields (id, title, severity, area, description) → correctly parsed
- Finding with missing severity line → still parsed, severity defaults or is empty
- Multiple findings across multiple areas → all parsed with correct area assignment
- Deeply nested findings (####, #####, ######) → all heading levels recognized
- Malformed heading (missing `UXR-` prefix) → skipped
- Area heading that starts with `## UXR-` → treated as finding context, not area heading (the fragile regex at line 414)
- Finding description spans multiple lines → full description captured

**Testing:** All new tests pass. Existing tests unaffected.

---

### 4. Improve `file-manager.ts` test coverage

**Problem:** `file-manager.ts` has the lowest coverage in the project at 89% statements/lines. The uncovered code is:
- Windows file-locking retry loop in `cleanupTempDir()` (lines 68-78): the `EBUSY`/`EPERM` retry logic
- Bare `catch` block in `hasExistingCheckpointData()` (lines 104-106): swallows all errors without logging

**Fix:**
1. Add a test that simulates an `EBUSY` error on the first `rmSync` call, verifying that `cleanupTempDir()` retries and eventually succeeds.
2. Add a test that simulates an `EBUSY` error on all attempts, verifying that `cleanupTempDir()` throws after exhausting retries.
3. Fix the bare `catch` block in `hasExistingCheckpointData()` (line 104): add `debug()` logging of the error before returning false. This turns a silent failure into a debuggable one.
4. Add a test that verifies `hasExistingCheckpointData()` returns false when `readdirSync` throws (e.g., permission error).

**Testing:** `file-manager.ts` coverage improves above 95%. All new and existing tests pass.

---

## Code Quality

### 5. Remove unused `countFindings` re-export from `progress-display.ts`

**Problem:** `progress-display.ts:95` has `export { countFindings } from './report.js';`. No external consumer uses this re-export. The canonical location is `report.ts`, and internal consumers already import from there. This is a stale indirection left over from the deduplication in iteration 4.

**Fix:** Remove line 95 from `progress-display.ts`. Verify with grep that no file imports `countFindings` from `progress-display`.

**Testing:** All existing tests pass. Grep confirms no remaining imports of `countFindings` from `progress-display`.

---

### 6. Fix bare catch block in `file-manager.ts`

**Problem:** `hasExistingCheckpointData()` at `src/file-manager.ts:104` has a bare `catch` that swallows all errors identically without logging. If `readdirSync` fails for an unexpected reason (permissions, corrupted filesystem), the error is silently eaten and the function returns `false`, potentially causing a fresh run when resume was intended.

**Fix:** Change the bare `catch` to `catch (err)` and add a `debug()` call logging the error before returning `false`. This makes the failure visible in verbose mode without changing the function's behavior (it still returns `false` on error).

**Note:** This is bundled with item #4 (file-manager coverage) since they touch the same code. Implementation should happen in the same task.

---

## Technical Debt

### 7. Eliminate double-serialized checkpoint data

**Problem:** In `src/orchestrator.ts`, the consolidation checkpoint stores intermediate outputs as JSON strings inside a JSON object. For example:
- Line 348: `checkpoint.dedupOutput = JSON.stringify(consolidation);`
- Line 385: `checkpoint.reassignOutput = JSON.stringify(findings);`
- Line 398: `checkpoint.hierarchyOutput = JSON.stringify(groups);`

When the checkpoint itself is written to disk via `writeConsolidationCheckpoint()` (which calls `JSON.stringify(checkpoint)`), these fields are double-serialized: a JSON string containing another JSON string. When reading back, the orchestrator must `JSON.parse()` the field value (lines 320, 375, 394) to recover the structured data.

This is fragile and confusing. The checkpoint interface (`ConsolidationCheckpoint` in `src/consolidation-checkpoint.ts:35-50`) types these fields as `string | null`, forcing the serialize/deserialize dance.

**Fix:**
1. Change the `ConsolidationCheckpoint` interface to use structured types instead of `string | null`:
   - `dedupOutput: ConsolidationResult | null`
   - `reassignOutput: Finding[] | null`
   - `hierarchyOutput: UIAreaGroup[] | null`
   - `formatReportOutput` and `discoveryMergeOutput` remain `string | null` since they hold actual string content (markdown/text)
2. In `orchestrator.ts`, remove the `JSON.stringify()` calls when writing to checkpoint fields (lines 348, 385, 398) — assign the structured data directly.
3. In `orchestrator.ts`, remove the `JSON.parse()` calls when reading checkpoint fields (lines 320, 375, 394) — use the data directly.
4. In `readConsolidationCheckpoint()` (`consolidation-checkpoint.ts:74`), update the validation for the changed fields: instead of checking `typeof field === 'string'`, check that the field is an object/array or null. Since `JSON.parse` during `readConsolidationCheckpoint` already deserializes the entire checkpoint from disk, the fields will arrive as their actual types.
5. No backward compatibility — old checkpoint files will fail validation and be treated as corrupted (returning `null`), which triggers a fresh consolidation. This is acceptable.

**Testing:** Existing consolidation checkpoint tests updated for the new types. The resume integration tests should verify that structured data round-trips correctly through write → read → resume.

---

## New Feature

### 8. Add `--version` CLI flag

**Problem:** The CLI has no `--version` flag. Users cannot check which version they're running.

**Fix:**
1. Add `--version` to the USAGE string in `src/cli.ts` (after `--help`), with description: `Show the version number`.
2. Add `'version'` to the boolean flag list at line 113.
3. Add `'version'` to the `knownFlags` set at line 145.
4. In `parseArgs()`, after the `--help` check (line 134), add a `--version` handler that reads `version` from `package.json` using `createRequire` (or a static import of the package.json) and prints it, then calls `process.exit(0)`.
5. Since this is an ES module project (`"type": "module"` in `package.json`), use `createRequire(import.meta.url)` from `node:module` to load `package.json`, or use a `readFileSync` + `JSON.parse` approach. Either works — the key is that the version comes from `package.json` at runtime, not a hardcoded string.

**Testing:** Add a test that verifies `--version` prints the version from `package.json` and exits. Add a test that `--version` appears in the help/usage text.

---

## Dependencies Between Changes

- **#4 and #6 are the same task** — both touch `file-manager.ts` coverage and the bare catch block. Implement together.
- **#7 (checkpoint refactor) should come after #1 (flaky test fix)** — the flaky tests are in the consolidation-resume test file, and #7 will modify checkpoint types that those tests exercise. Fix the timeouts first so the test suite is stable before refactoring.
- **All other changes are independent** and can be done in any order.

---

## Testing Strategy

All changes must maintain the 95% coverage threshold enforced by `vitest.config.ts`.

- **#1 (flaky timeouts):** Increase timeout values. No new tests — verification is that existing tests stop timing out.
- **#2 (single-quote escape):** Add/update escapeHtml test.
- **#3 (parseConsolidatedReport tests):** New dedicated unit test file or describe block.
- **#4 + #6 (file-manager coverage):** New tests for EBUSY retry and error logging. Target: file-manager.ts above 95%.
- **#5 (remove re-export):** Grep verification only.
- **#7 (checkpoint refactor):** Update existing checkpoint tests for new types. Existing resume tests verify round-trip.
- **#8 (--version flag):** New CLI tests for version output.

---

## Out of Scope

The following remain deferred to future iterations:
- Finding severity filtering (`--min-severity`)
- Claude Agent SDK migration
- Structured IPC (replacing file-based communication)
- Report diffing for `--append` mode
- Consolidation as a separate CLI subcommand
- AbortController for cancellation
- Large dataset / performance testing
- Concurrent write race condition tests
- Filesystem error tests (EACCES, ENOSPC) beyond EBUSY
