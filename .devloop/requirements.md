# UX Analysis Reporter — Iteration 10 Requirements

## Overview

This iteration addresses the 2 "should fix" items and 2 "nice to have" items from the iteration 9 code review, plus a structural refactoring of the largest file in the codebase. No new features are added. All changes are bug fixes, test coverage improvements, and refactoring.

The prior iteration left the project at 1025/1026 tests passing across 43 test files with 98.83% statement, 96.05% branch, 99.48% function coverage — all above the 95% threshold. The single failing test is the flaky test addressed by Item 1 below.

---

## Item 1: Stabilize the flaky consolidation-resume checkpoint preservation test

### Problem

`tests/consolidation-resume.test.ts:788-821` has a test "preserves consolidation checkpoint when initTempDir is called on existing temp dir" that fails intermittently on Windows. The test:

1. Creates a file manager and calls `initTempDir(2)` to create the temp directory
2. Writes a consolidation checkpoint file at `{tempDir}/consolidation-checkpoint.json`
3. Calls `hasExistingCheckpointData()` — expects `true`
4. Calls `initTempDir(2)` again (simulating a restart/resume)
5. Asserts the checkpoint file still exists and content is intact

The failure (`expected false to be true` at line 815) indicates `existsSync(cpPath)` returns false — the checkpoint file was deleted despite `hasExistingCheckpointData()` returning true on the previous check.

### Root Cause

This is a time-of-check-to-time-of-use (TOCTTOU) issue specific to Windows filesystem behavior. The `initTempDir` function at `src/file-manager.ts:120-144`:

1. Calls `hasExistingCheckpointData()` at line 124 — reads filesystem, returns true
2. Skips `cleanupTempDir()` since checkpoint data was found
3. Calls `mkdirSync(tempDir, { recursive: true })` at line 134

On Windows, the `mkdirSync` with `{ recursive: true }` on an existing directory, combined with rapid sequential filesystem operations, can interfere with file handles that haven't been fully released from the previous operations. The `cleanupTempDir()` function (lines 62-76) already has retry logic for `EBUSY`, `EPERM`, `ENOTEMPTY` errors on Windows, indicating file lock contention is a known issue in this codebase.

### Fix

The test itself needs to be more resilient to Windows filesystem timing. Two approaches (implementer should pick the most appropriate):

**Option A: Add a small filesystem settle delay.** After writing the checkpoint file and before calling `initTempDir(2)` the second time, add a brief `await` to let Windows release file handles. This is the simplest fix.

**Option B: Restructure the test to avoid rapid re-initialization.** Instead of calling `initTempDir` twice in quick succession, verify the checkpoint preservation logic more directly — e.g., call `hasExistingCheckpointData()` and verify it returns true, then verify that the `initTempDir` code path skips cleanup when checkpoint data exists.

Either approach should make the test pass reliably on Windows. The test should be run multiple times to confirm stability.

### Verification

Run `npx vitest run tests/consolidation-resume.test.ts` — all tests pass, including the previously flaky test. Run it 3 times to confirm stability.

---

## Item 2: Raise `instance-manager.ts` branch coverage above 95%

### Problem

`instance-manager.ts` has 91.15% branch coverage, the lowest among core modules. The uncovered branch is at line 166 — the `buildDiscoveryPrompt` function's scope-empty path:

```typescript
const scopeSection = config.scope.trim().length > 0
  ? `## Exploration Guidance\n\n${config.scope}`
  : '';  // <-- uncovered
```

And the corresponding conditional inclusion at line 179:
```typescript
${scopeSection ? '\n' + scopeSection + '\n' : ''}  // <-- falsy path uncovered
```

### Fix

Add a targeted test to `tests/instance-manager.test.ts` that calls `buildDiscoveryPrompt` with an empty or whitespace-only scope string. Verify the returned prompt does NOT contain an "Exploration Guidance" section.

Add a second test with a non-empty scope to verify the section IS included (this may already exist — check first).

### Verification

Run `npx vitest run --coverage tests/instance-manager.test.ts` and confirm branch coverage is above 95%.

---

## Item 3: Raise `html-report.ts` branch coverage above 95%

### Problem

`html-report.ts` has 91.89% branch coverage. Uncovered paths:

1. **`encodeScreenshotBase64` function (lines ~58-59)**: The fallback when `existsSync(filePath)` returns false — function returns `null`.
2. **`encodeScreenshotBase64` function (lines ~65-66)**: The catch block when `readFileSync` throws — function returns `null`.
3. **`renderScreenshots` function (lines ~85-86)**: When all screenshot references fail to encode (all return `null`), the function falls back to rendering the field as escaped plain text.

### Fix

Add targeted tests to the html-report test file:

1. **Missing screenshot file**: Call `encodeScreenshotBase64` with a path that doesn't exist. Verify it returns `null`.
2. **Unreadable screenshot file**: Mock `readFileSync` to throw an error. Verify `encodeScreenshotBase64` returns `null`.
3. **All screenshots missing**: Call `renderScreenshots` with screenshot references where none of the referenced files exist. Verify the output contains the raw reference text as escaped HTML, not `<img>` tags.

### Verification

Run `npx vitest run --coverage tests/html-report.test.ts` and confirm branch coverage is above 95%.

---

## Item 4: Raise `progress-display.ts` branch coverage above 95%

### Problem

`progress-display.ts` has 92.85% branch coverage. Uncovered lines:

1. **Lines 431-432**: Edge case in checkpoint polling where the checkpoint file exists but is corrupted/unparseable. The code can't extract progress from it but can still count findings files. It updates only `findingsCount`, preserving other metrics.
2. **Lines 440-441**: The `setInterval` timer setup for periodic polling and rendering.

### Fix

Add targeted tests:

1. **Corrupt checkpoint**: Set up a scenario where the checkpoint file exists but contains invalid JSON (or is missing expected fields). Verify the progress display still updates `findingsCount` from the filesystem without crashing.
2. **Timer setup**: Verify that `start()` creates the polling interval and that `pollCheckpoints()` + `renderToTerminal()` are called. This may require timer mocking with `vi.useFakeTimers()`.

### Verification

Run `npx vitest run --coverage tests/progress-display.test.ts` and confirm branch coverage is above 95%.

---

## Item 5: Split `consolidation.ts` into submodules

### Problem

`consolidation.ts` is 1153 lines — the largest file in the codebase — and combines 5 distinct concerns:

1. **Deduplication** (lines ~51-313): Finding duplicate findings across instances, merging duplicates via Claude prompts
2. **ID Reassignment & Screenshots** (lines ~315-662): Reassigning findings to sequential UXR-NNN IDs, copying/renaming screenshots, cross-run dedup for append mode
3. **Hierarchical Organization** (lines ~664-969): Grouping findings by UI area, determining parent-child dependencies via Claude, formatting as nested markdown
4. **Discovery Consolidation** (lines ~971-1153): Merging per-instance discovery documents, generating plan templates
5. **Types & Shared Logic** (lines ~1-50): Interface definitions (`DuplicateGroup`, `DeduplicationResult`, `ConsolidationResult`), shared imports

### Fix

Split into a `consolidation/` directory with focused submodules:

```
src/consolidation/
  index.ts          — Re-exports all public APIs (barrel file)
  types.ts          — Shared interfaces and type definitions
  deduplication.ts  — Dedup logic (buildDeduplicationPrompt, parseDeduplicationResponse, mergeDuplicateGroup, applyDeduplication, collectFindings, detectDuplicates, consolidateReports)
  reassignment.ts   — ID reassignment + screenshot logic (buildFinalId, parseScreenshotRefs, extractInstanceFromScreenshot, buildNewScreenshotFilenames, parseConsolidatedReport, detectCrossRunDuplicates, filterCrossRunDuplicates, parseExistingReportIds, reassignIds, copyScreenshots, reassignAndRemapScreenshots)
  hierarchy.ts      — Hierarchical grouping (groupFindingsByArea, buildHierarchyPrompt, parseHierarchyResponse, buildHierarchy, determineHierarchy, organizeHierarchically, formatFindingMetadata, renderHierarchicalFindingMd, formatConsolidatedReport)
  discovery.ts      — Discovery doc consolidation (readAllDiscoveryDocs, buildDiscoveryConsolidationPrompt, consolidateDiscoveryDocs, writeConsolidatedDiscovery, generatePlanTemplate)
```

The `index.ts` barrel file re-exports everything that the rest of the codebase imports from `consolidation.ts`, maintaining the same public API. All imports throughout the codebase that reference `./consolidation.js` should be updated to `./consolidation/index.js` (or just `./consolidation/` depending on module resolution).

### Key Constraints

- **This is a pure refactoring** — zero behavior changes. Every function signature, every export, every return value must remain identical.
- **All existing tests must pass without modification** (except import path updates). The test file `tests/consolidation.test.ts` and related test files will need their import paths updated.
- **The barrel `index.ts` must export everything** that `consolidation.ts` currently exports. No public API changes.
- **Delete the original `consolidation.ts`** after the split is complete and verified.

### Verification

Run `npx vitest run tests/consolidation.test.ts tests/consolidation-resume.test.ts` — all tests pass. Run `npx tsc --noEmit` — no type errors. Grep for any remaining imports of the old `./consolidation.js` path (should find none except in the new `consolidation/` directory itself).

---

## Dependencies Between Items

```
Item 1 (flaky test)              — independent
Item 2 (instance-manager cov)    — independent
Item 3 (html-report cov)         — independent
Item 4 (progress-display cov)    — independent
Item 5 (consolidation split)     — independent, but should come LAST since it's the largest change
                                   and Items 1 touches consolidation-resume tests
```

Items 1-4 are independent and can be done in any order. Item 5 should be done after Item 1 since Item 1 modifies a consolidation test file.

---

## Testing Strategy

All changes must maintain the 95% coverage threshold (currently at 96.05% branch). Items 2-4 should raise individual module coverage above 95%.

### Modified test files
- `tests/consolidation-resume.test.ts` — stabilize flaky test (Item 1)
- `tests/instance-manager.test.ts` — new test for scope-empty path (Item 2)
- `tests/html-report.test.ts` — new tests for screenshot encoding fallbacks (Item 3)
- `tests/progress-display.test.ts` — new tests for edge states (Item 4)
- `tests/consolidation.test.ts` — import path updates only (Item 5)
- `tests/consolidation-resume.test.ts` — import path updates only (Item 5)
- Any other test files importing from `consolidation.ts` — import path updates (Item 5)

### New test files
None.

---

## Out of Scope

The following remain deferred:
- Shell metacharacter risk in `browser-open.ts:9-11` (pre-existing accepted risk, low severity)
- `Number() || fallback` masking instance 0 in `checkpoint.ts:54` (unreachable, instance numbering starts at 1)
- Finding severity filtering (`--min-severity`)
- Claude Agent SDK migration
- Structured IPC (replacing file-based communication)
- Report diffing for `--append` mode
- `validate-plan` subcommand
- `--from-plan` pipeline flag
- Incremental discovery (`--append` for plan mode)
- Consolidation as a separate CLI subcommand
- AbortController for cancellation
- Large dataset / performance testing
- Concurrent write race condition tests
- Base orchestrator / composition pattern
- Persistent rate-limit retry budget across sequential runs
- Lightweight arg parsing library migration (`node:util parseargs`)
