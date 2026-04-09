# UX Analysis Reporter — Iteration 6 Requirements

## Overview

This iteration focuses on making the CLI feel more responsive during long-running analysis by improving the progress display. Currently, the progress line only shows area completion counts and findings — but Claude instances are actively taking screenshots, writing files, and updating checkpoints between those milestones. The user sees nothing happening for extended periods, which makes the tool feel stalled.

Three changes address this: showing screenshot counts inline, adding a file-activity liveness signal, and rewriting the checkpoint prompt so Claude updates more frequently. Four small review items from iteration 5 are also included.

All changes build on the existing codebase. The prior iteration left the project at 863/863 tests passing across 34 test files with 98.65% statement coverage.

---

## Feature: Improved Progress Feedback

### 1. Screenshot counting in progress line

**Problem:** Claude instances take screenshots during analysis, but the progress display doesn't show this. The user has no idea screenshots are being captured until the final report.

**Current behavior:** `formatProgressLine()` in `progress-display.ts:109-174` renders stats like `2/5 areas, 3 findings`. Screenshot counts are not tracked or displayed.

**Change:** During each `pollCheckpoints()` tick (called every `RENDER_INTERVAL_MS`), also count screenshots in each instance's `screenshots/` directory. Use `listScreenshots()` from `src/screenshots.ts:63-73` (already exists — returns an array of valid screenshot filenames) or read the directory directly. Add the total screenshot count to the progress line.

**Display format:** Append screenshot count after findings: `2/5 areas, 3 findings, 7 screenshots`. Only show the screenshots segment when the count is > 0 to avoid clutter during early stages before any screenshots are taken.

**Design decisions:**
- Screenshot count is inline with findings (not a separate line)
- Count is aggregated across all instances for the total
- Uses `listScreenshots()` which already filters for valid screenshot filenames
- Count of 0 is hidden from display

### 2. File liveness signal

**Problem:** Between checkpoint updates, the CLI appears frozen even though Claude is actively writing files (discovery.md, report.md, screenshots, etc.). There's no indication that anything is happening.

**Current behavior:** Progress only changes when checkpoint.json is updated with new area statuses or finding counts.

**Change:** During each `pollCheckpoints()` tick, also check the modification time of ALL instance files: `discovery.md`, `report.md`, `checkpoint.json`, and the `screenshots/` directory. Use `fs.statSync()` to get `mtime`. Track the most recent mtime across all instance files across all running instances. If file activity has been observed, append `active Xs ago` to the end of the progress line, where X is the number of seconds since the most recent modification.

**Display format:** Append after the stats: `2/5 areas, 3 findings, 7 screenshots · active 2s ago`. Only show when there has been file activity (i.e., at least one file modification has been observed during this run).

**Design decisions:**
- Liveness uses `active Xs ago` format (not a blinking dot or stale-only warning)
- Tracks modification time via `statSync`, not content size
- Scope is all instance files (discovery.md, report.md, checkpoint.json, screenshots dir), not just checkpoint.json
- The separator between stats and liveness is ` · ` (middle dot with spaces)
- Files that don't exist yet are silently skipped (instances create files progressively)
- `statSync` errors are silently caught — a missing or locked file should never crash the render loop

### 3. Stronger checkpoint update prompt

**Problem:** The checkpoint instructions in `buildInstancePrompt()` (`instance-manager.ts:101-116`) say "After each significant step, write a JSON checkpoint". This wording is too vague — Claude interprets "significant step" loosely and often goes long stretches without updating, which means the progress display shows stale data.

**Current wording (line 102):** `After each significant step, write a JSON checkpoint`

**Change:** Rewrite the checkpoint instruction section to explicitly demand updates after every navigation to a new page, every screenshot taken, and every finding recorded. The checkpoint must be updated frequently so the progress display stays current.

**New wording should convey:**
- Update the checkpoint file after EVERY page navigation, EVERY screenshot, and EVERY finding
- Do not wait until an area is complete — update as you go
- The checkpoint file is how the user tracks your progress in real time
- Frequent updates are critical for the user experience

The exact phrasing is left to implementation, but the instruction must be unambiguous and emphatic. The current "significant step" phrasing must be replaced entirely.

**Design decisions:**
- Stronger frequency language only (no schema changes, no repeated reminders throughout the prompt)
- The checkpoint JSON structure stays the same
- This is a prompt change only — no code logic changes

---

## Review Items

### 4. Add retry logic to integration test `cleanTestDirs()` functions

**Problem:** Seven integration test files each have an identical `cleanTestDirs()` function that uses bare `rmSync()` without retry logic. On Windows, when file handles haven't been fully released after a test, `rmSync` fails with EBUSY. This caused an intermittent test failure during the iteration 5 review. The production code in `file-manager.ts:57-78` already has proper retry logic for this exact scenario.

**Affected files (all have identical pattern):**
- `tests/integration-multi-instance.test.ts` (line 352)
- `tests/integration-happy-path.test.ts` (line 173)
- `tests/integration-failure-retry.test.ts` (line 162)
- `tests/integration-edge-cases.test.ts` (line 140)
- `tests/integration-append-mode.test.ts` (line 179)
- `tests/integration-dedup-consolidation.test.ts` (line 322)
- `tests/consolidation-resume.test.ts` (line 168)

**Current pattern in each file:**
```typescript
function cleanTestDirs() {
  if (existsSync(TEST_BASE)) {
    rmSync(TEST_BASE, { recursive: true, force: true });
  }
}
```

**Fix:** Extract a shared async test helper (e.g., `tests/test-helpers.ts`) with EBUSY retry logic matching the production pattern in `file-manager.ts:57-78`: up to 5 attempts, catching EBUSY/EPERM, with linear backoff (100ms * attempt). Replace the `cleanTestDirs()` function in all 7 files with a call to the shared helper.

Since the shared helper will be async (it needs `await` for the retry delay), the `afterEach` hooks in each file will need to become async as well. This is a straightforward change — Vitest supports async hooks natively.

**Testing:** Run the full integration test suite multiple times on Windows. No EBUSY failures should occur.

### 5. Fix bare catch block in `checkpoint.ts:60`

**Problem:** `readCheckpoint()` in `checkpoint.ts:61-62` has a bare `catch` that silently returns `null` on any error. This is the same pattern that was fixed in `file-manager.ts` during iteration 5 — the fix there was to add `debug()` logging before returning `null`.

**Current code (lines 61-62):**
```typescript
} catch {
  return null;
}
```

**Fix:** Change `catch` to `catch (err)` and add a `debug()` call logging the error before returning `null`. Import `debug` from `./logger.js` if not already imported. This makes failures visible in verbose mode without changing behavior.

**Testing:** Add a test that verifies `readCheckpoint()` returns `null` when the checkpoint file contains invalid JSON. Optionally verify that `debug()` is called with the error.

### 6. Remove redundant `=== undefined` condition in `consolidation-checkpoint.ts:112`

**Problem:** The validation loop for nullable structured fields has a redundant condition:
```typescript
if (parsed[field] !== null && (typeof parsed[field] !== 'object' || parsed[field] === undefined)) {
```
The `parsed[field] === undefined` check is unreachable because `parsed[field] !== null` already evaluates to `true` for `undefined` (since `undefined !== null` is `true` in JavaScript). Wait — actually `undefined !== null` is `true`, so `undefined` does pass the first check. But `typeof undefined` is `'undefined'`, not `'object'`, so the `typeof` check already catches it. The `=== undefined` is redundant with the `typeof !== 'object'` check.

**Fix:** Simplify to:
```typescript
if (parsed[field] !== null && typeof parsed[field] !== 'object') {
```

**Testing:** Existing tests continue to pass. No new tests needed — this is a logic simplification with identical behavior.

### 7. Add `help` and `show-default-scope` to `knownFlags` set in `cli.ts`

**Problem:** The `knownFlags` set at `cli.ts:157` is used to detect unknown flags, but it omits `help` and `show-default-scope`. These flags work correctly because they're handled before the unknown-flag check (lines 138-154), but the set is incomplete as documentation of all valid flags.

**Current set (line 157):**
```typescript
const knownFlags = new Set(['url', 'intro', 'plan', 'scope', 'instances', 'rounds', 'output', 'keep-temp', 'append', 'dry-run', 'verbose', 'suppress-open', 'max-retries', 'instance-timeout', 'rate-limit-retries', 'version']);
```

**Fix:** Add `'help'` and `'show-default-scope'` to the set.

**Testing:** Existing CLI tests continue to pass. No new tests needed.

---

## Dependencies Between Changes

- **#1, #2, and #3 are related** — all three improve the progress feedback experience. #1 (screenshot counting) and #2 (file liveness) both modify `pollCheckpoints()` and `formatProgressLine()` in `progress-display.ts`. They should be implemented in sequence to avoid merge conflicts.
- **#3 (checkpoint prompt) is independent** of #1 and #2 from a code perspective but is conceptually linked — stronger prompts mean more frequent checkpoint updates, which means the progress display (including liveness) has fresher data.
- **#4 through #7 are all independent** of each other and of #1-#3.

---

## Testing Strategy

All changes must maintain the 95% coverage threshold enforced by `vitest.config.ts`.

- **#1 (screenshot counting):** Update existing progress-display tests to verify screenshot counts appear in the formatted line. Mock `listScreenshots` or the screenshots directory.
- **#2 (file liveness):** Add tests verifying the `active Xs ago` format appears when files have been recently modified, and is absent when no activity has occurred. Mock `statSync`.
- **#3 (checkpoint prompt):** Add or update a test verifying the prompt string includes the stronger checkpoint language. No behavioral tests needed — this is a prompt text change.
- **#4 (test cleanup retry):** No new tests for the helper itself (it mirrors production code that's already tested). Verification is that integration tests stop failing intermittently on Windows.
- **#5 (checkpoint.ts bare catch):** Add a test for `readCheckpoint()` returning null on invalid JSON.
- **#6 (redundant condition):** Existing tests pass. No new tests.
- **#7 (knownFlags):** Existing tests pass. No new tests.

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
