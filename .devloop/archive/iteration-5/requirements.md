# UX Analysis Reporter — Iteration 7 Requirements

## Overview

This iteration has two focuses: clearing the remaining technical debt identified in the iteration 6 review, and adding a new `uxreview plan` subcommand that lets users generate a structured plan template by having Claude discover and map a site before running the full analysis.

The plan subcommand mirrors the existing analysis flow — distribute work across instances, navigate, screenshot, write discovery docs — but replaces the findings/analysis phase with pure exploration. The output is an editable `plan.md` template and a visual `discovery.html` report with embedded screenshots, so the user can see what was found and refine the plan before running the real analysis.

All changes build on the existing codebase. The prior iteration left the project at 892/893 tests passing across 36 test files (1 test timeout — addressed in this iteration).

---

## Part A: Technical Debt

### A1. Fix test timeout in coverage-gaps.test.ts

**Problem:** The `ProgressDisplay.markRateLimited` tests at `coverage-gaps.test.ts:255-276` consistently time out on Windows. The tests use `await import('../src/progress-display.js')` inside each test function. This file has heavy module mocks (`claude-cli`, `file-manager`, `rate-limit`) that make the dynamic import chain slow to resolve — exceeding the default 5-second timeout.

**Root cause:** The `markRateLimited` and `getProgress` methods don't touch the filesystem or any of the mocked modules. These tests don't belong in `coverage-gaps.test.ts` — they were placed there during iteration 5 as a coverage gap fill, but the file's mock setup creates unnecessary overhead for what are simple class method tests.

**Fix:** Move the two `ProgressDisplay.markRateLimited` tests (lines 255-276) to a new dedicated test file (e.g., `tests/progress-display-rate-limit.test.ts`). The new file should use a static `import { ProgressDisplay } from '../src/progress-display.js'` — no dynamic import needed since there are no mocks. The two tests are:
- "sets rate-limited status and backoff duration"
- "no-ops for unknown instance numbers"

Remove the `// ─── progress-display: markRateLimited` section from `coverage-gaps.test.ts` entirely.

**Verification:** All 893 tests pass with no timeouts. The new file's tests complete in well under 5 seconds.

### A2. Add debug logging to safeStatMtimeMs() bare catch

**Problem:** `safeStatMtimeMs()` in `progress-display.ts:379-384` silently swallows all `statSync` errors. While silent handling is correct for missing files (expected during early instance stages), the lack of logging is inconsistent with the pattern established in `file-manager.ts` (iteration 5) and `checkpoint.ts` (iteration 6), where bare catches were explicitly fixed to add `debug()` logging.

**Fix:** Change `catch` to `catch (err)` and add a `debug()` call logging the error before returning `null`. Import `debug` from `./logger.js` if not already imported. This makes failures visible in `--verbose` mode without changing behavior.

**Verification:** Targeted test verifying `safeStatMtimeMs()` returns `null` when `statSync` throws an error. Run only the progress-display tests.

### A3. Add debug logging to consolidation-checkpoint.ts bare catch

**Problem:** The outer catch block at `consolidation-checkpoint.ts:130` in `readConsolidationCheckpoint()` silently returns `null` without logging. This is the last remaining silent error swallower in the codebase — the same pattern was fixed in `checkpoint.ts` (iteration 6) and `file-manager.ts` (iteration 5).

**Fix:** Change `catch` to `catch (err)` and add a `debug()` call logging the error before returning `null`. Import `debug` from `./logger.js` if not already imported.

**Verification:** Targeted test verifying `readConsolidationCheckpoint()` returns `null` when the file contains invalid JSON, and that `debug()` is called with the error. Run only the consolidation-checkpoint tests.

### A4. Preserve original stderr on subprocess timeout

**Problem:** In `claude-cli.ts:98-101`, when the subprocess is killed by SIGTERM (timeout), line 101 replaces the stderr content with a generic timeout message: `` `Process timed out after ${timeout}ms` ``. Any useful diagnostic output from Claude CLI is discarded. The original stderr is already captured in the `stderr` variable and could be preserved.

**Fix:** When the subprocess times out and stderr contains content, include both the timeout message and the original stderr. When stderr is empty, use the timeout message alone. Something like:

```typescript
stderr = stderr
  ? `Process timed out after ${timeout}ms. Original stderr:\n${stderr}`
  : `Process timed out after ${timeout}ms`;
```

**Verification:** Targeted test verifying that when a process times out with existing stderr content, both the timeout message and original stderr are preserved in the result. Run only the claude-cli tests.

### A5. Fix fragile area heading regex in consolidation.ts

**Problem:** `parseConsolidatedReport()` in `consolidation.ts:412-414` uses `^## (.+)$` to match area headings but excludes lines matching `^## UXR-`. The intent is to skip finding ID headings (like `## UXR-001: Title`). But if a UI area were named "UXR-Something" (e.g., "UXR-Dashboard"), it would be incorrectly skipped.

**Fix:** Make the exclusion pattern more specific. Finding headings follow the format `## UXR-NNN:` (ID followed by colon). Change the exclusion from `^## UXR-` to `^## UXR-\d+:` (or similar) so it only matches actual finding IDs, not area names that happen to start with "UXR-".

**Verification:** Targeted test verifying that an area named "UXR-Custom Area" is correctly parsed as an area heading, while `## UXR-001: Some Finding` is still correctly skipped. Run only the consolidation tests.

### A6. Remove duplicate display.stop() call

**Problem:** In `orchestrator.ts`, the signal handler (line ~188) and the `finally` block (line ~495) both call `display.stop()`. The `stop()` method is idempotent so this is safe, but it reflects duplicated cleanup logic. The `finally` block is the correct place for cleanup — it runs regardless of how the function exits (normal completion, error, or signal). The signal handler should set the cancellation flag but not perform cleanup that the `finally` block already handles.

**Fix:** Remove the `display.stop()` call from the signal handler. The `finally` block's `display.stop()` call is sufficient — it runs after the signal handler sets the cancellation flag and the main loop exits.

**Verification:** Existing orchestrator tests continue to pass. No new tests needed — this is a cleanup of redundant code. Run only the orchestrator tests.

---

## Part B: `uxreview plan` Subcommand

### B1. Overview

Add a `plan` subcommand to the CLI that runs Claude instances in discovery-only mode — navigating, screenshotting, and mapping a site without producing findings or analysis. The output is a structured plan template (`plan.md`) and a visual HTML discovery report (`discovery.html`) with embedded screenshots. The user edits `plan.md` and then uses it as the `--plan` input for a full analysis run.

**Workflow:**
```
uxreview plan --url https://app.com --intro "Our SaaS dashboard" --scope "Accessibility, Layout"
  → Claude explores the site, takes screenshots, maps areas
  → Outputs plan.md + discovery.html to current directory
  → Opens discovery.html in browser

User edits plan.md (removes areas, adds detail, reorders)

uxreview --url https://app.com --plan plan.md --intro "Our SaaS dashboard"
  → Full analysis using the edited plan
```

### B2. CLI Interface

**Syntax:**
```
uxreview plan --url <url> [--intro <text|filepath>] [--scope <text|filepath>] [--plan <text|filepath>] [--instances N] [--rounds N] [--output <dir>] [--keep-temp] [--verbose] [--suppress-open] [--dry-run]
```

**Subcommand detection:** The CLI parser should detect `plan` as the first positional argument (i.e., the first arg that doesn't start with `--`). If present, route to the plan subcommand handler. All other args are parsed as flags, same as the main command.

**Flags:**
| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--url` | Yes | — | Target URL to discover |
| `--intro` | No | — | Application context (text or filepath) |
| `--scope` | No | Default scope | Evaluation criteria to guide discovery |
| `--plan` | No | — | Broad high-level areas to explore (text or filepath). Required if `--instances > 1` |
| `--instances` | No | 1 | Number of Claude instances. Requires `--plan` if > 1 |
| `--rounds` | No | 1 | Discovery rounds per instance. Round 2+ uses round 1 discovery to find gaps |
| `--output` | No | `.` (current dir) | Output directory for plan.md and discovery.html |
| `--keep-temp` | No | false | Keep temp directory after completion |
| `--verbose` | No | false | Enable debug logging |
| `--suppress-open` | No | false | Don't open discovery.html in browser |
| `--dry-run` | No | false | Show what would be done without running Claude |

**Validation rules:**
- `--url` is required (same as main command)
- If `--instances > 1` and `--plan` is not provided: print a warning explaining that `--plan` is required for multi-instance discovery (Claude needs areas to distribute across instances), then fall back to 1 instance and continue
- `--plan` with the `plan` subcommand provides broad areas for discovery focus, not a detailed analysis plan

**Unknown flag handling:** The existing `knownFlags` set in `cli.ts` should be updated to include `plan`-specific awareness. The `plan` subcommand accepts the same flags as the main command minus `--append` and `--max-retries` / `--instance-timeout` / `--rate-limit-retries` (these are analysis-specific). If a user passes `--append` with `plan`, warn that it's not applicable.

### B3. Discovery-Only Instance Prompt

A variant of `buildInstancePrompt()` is needed for the plan subcommand. It should share the existing prompt's structure but modify the instructions to focus on exploration rather than evaluation.

**What stays the same:**
- Target URL section
- Application context (intro) section
- Checkpoint file instructions (same JSON structure, same frequent-update language from iteration 6)
- Discovery document instructions (`buildDiscoveryInstructions()`)
- Screenshot instructions (`buildScreenshotInstructions()`)

**What changes:**
- **No report instructions** — Remove `buildReportInstructions()` entirely. Claude should not produce findings, severity ratings, or suggestions. The report.md file is not created.
- **Plan chunk becomes "exploration areas"** — When `--plan` is provided, the section header changes from "Your Assigned Review Areas" to "Areas to Explore" or similar. The instruction should emphasize mapping and documenting what exists, not evaluating against criteria.
- **Scope becomes "things to look for"** — The scope is still provided but framed as guidance for what to pay attention to during exploration, not criteria to evaluate against. Claude should note what's relevant to the scope but not produce findings.
- **Process instructions** — Replace the analysis-focused process with discovery-focused instructions:
  1. Navigate to the target URL
  2. Systematically explore the assigned areas (or the entire site if no areas given)
  3. For each area: take screenshots, document navigation paths, list UI elements and features found
  4. Go deep — explore sub-pages, modals, dropdowns, tabs, settings panels
  5. Document everything in the discovery file
  6. Update the checkpoint after every navigation and screenshot
  7. When no plan is provided: explore freely, starting from the URL and following navigation paths

**When no `--plan` is given (single instance):** The prompt should instruct Claude to explore the entire site starting from the URL, following all navigation paths it can find, and document everything it discovers. No assigned areas — full free exploration.

### B4. Plan Orchestration

The plan subcommand needs its own orchestration flow. It reuses significant portions of the existing orchestrator but skips the analysis/consolidation phases that produce findings.

**Flow (mirrors `runAnalysis()` structure):**

1. **Initialize** — Create temp directory, output directory (default `.`), validate args
2. **Distribute plan** (if `--plan` provided and instances > 1) — Use existing `distributePlan()` to split broad areas across instances
3. **Spawn instances** — Use `runInstanceRounds()` with the discovery-only prompt. Each instance navigates, screenshots, writes discovery.md, updates checkpoint.json. Progress display works exactly as in the main command (screenshot counts, liveness signal, area progress).
4. **Consolidate discoveries** — After all instances complete, use a modified consolidation step:
   - Merge all instance discovery documents (similar to `consolidateDiscoveryDocs()`)
   - But output in **plan-compatible format**: `## Area` headings with `- Sub-item` bullet lists
   - This is the `plan.md` content
5. **Generate discovery HTML** — Build `discovery.html` from the consolidated discovery content with embedded screenshots
6. **Write output** — Write `plan.md` and `discovery.html` to the output directory
7. **Copy screenshots** — Copy and rename screenshots from temp to output directory (for HTML embedding as base64, same as existing report)
8. **Open browser** — Open `discovery.html` unless `--suppress-open`
9. **Cleanup** — Remove temp directory unless `--keep-temp`

**What's NOT needed from the main orchestrator:**
- No `consolidateFindings()` — no findings to consolidate
- No `formatConsolidatedReport()` — no report.md
- No `formatHtmlReport()` — the findings-focused HTML generator is not used
- No append mode logic
- No finding ID assignment or deduplication

### B5. Plan Template Generation (plan.md)

After discovery consolidation, the merged discovery content needs to be transformed into a plan template that's compatible with the existing `--plan` flag parser. The parser in the main command extracts areas from `## Headings` and `- List items` via `extractAreasFromPlanChunk()`.

**Approach:** Use a Claude call (via `withRateLimitRetry`) to transform the consolidated discovery into a clean plan template. The prompt should instruct Claude to:

1. Take the raw consolidated discovery (areas, navigation paths, elements, sub-areas)
2. Produce a hierarchical plan document using `## Area` headings for top-level areas
3. Under each area, use `- Sub-area or feature` bullet lists
4. Include enough detail that the user knows what each area covers, but keep it concise
5. Order logically (navigation/header first, main content areas, settings/footer last)
6. Output ONLY the plan document — no commentary or instructions

**Example output format:**
```markdown
## Navigation & Header
- Main navigation bar (Home, Products, About, Contact)
- User account menu (login/signup, profile dropdown)
- Search functionality
- Mobile hamburger menu

## Dashboard
- Overview widgets (stats cards, charts)
- Recent activity feed
- Quick actions panel

## Settings
- Profile settings
- Notification preferences
- Security & password
- Billing information
```

This format is directly usable with `uxreview --url <url> --plan plan.md`.

**Fallback:** If the Claude call fails (rate limit exhaustion, etc.), write the raw consolidated discovery content as `plan.md` instead. It won't be as cleanly formatted but is still usable.

### B6. Discovery HTML Report (discovery.html)

A new HTML report generator for the plan subcommand's discovery output. Unlike the existing `formatHtmlReport()` which is findings-focused (severity badges, suggestions, finding IDs), this report is exploration-focused.

**Structure:**
- Self-contained HTML document (same approach as existing report: inline CSS, embedded base64 screenshots)
- Same CSS foundation as the existing report for visual consistency
- Header with metadata: URL, date, instance count, rounds

**Layout:**
1. **Table of contents** — Nested list of discovered areas, linking to their sections. Nesting reflects the area hierarchy (top-level areas → sub-areas → sub-sub-areas).
2. **Area sections** — Each area gets a collapsible `<details>` section containing:
   - Navigation path (how to reach this area)
   - Elements/features discovered (bulleted list)
   - Evaluation criteria noted (from scope, if applicable)
   - Screenshots taken in this area (embedded inline as base64 images)
   - Nested sub-areas as child `<details>` sections, maintaining the hierarchy

**Input data:** The function takes the consolidated discovery content (markdown) and a screenshots directory path. It parses the discovery markdown into a hierarchical structure and renders each section. Screenshots are matched to areas by filename or by references in the discovery content.

**Screenshot matching:** During discovery, Claude names screenshots following the existing `buildScreenshotInstructions()` convention. The HTML generator should embed all screenshots, associated with the area they belong to. If association can't be determined, show them in a general "Screenshots" section at the bottom.

### B7. Integration with Existing Systems

**Progress display:** The plan subcommand reuses the existing `ProgressDisplay` class. It shows the same progress line during discovery: area completion, screenshot counts, file liveness signal. No changes needed to progress-display.ts for this.

**Checkpoint/resume:** The plan subcommand uses the same checkpoint system. If a plan run is interrupted and restarted, instances resume from their checkpoints. The `--keep-temp` flag preserves checkpoint data for debugging.

**Rate limiting:** All Claude calls (instance runs, discovery consolidation, plan template generation) use `withRateLimitRetry()` for rate limit handling. Same retry behavior as the main command.

**Dry run:** `--dry-run` for the plan subcommand should show: URL, intro summary, scope summary, instance count, rounds, output directory, and what would be explored. Same pattern as the main command's dry run.

**Verbose mode:** `--verbose` enables debug logging throughout, same as main command. The new `debug()` calls added in A2/A3 will be active in verbose mode.

---

## Dependencies Between Changes

**Part A items are all independent** of each other and can be implemented in any order.

**Part B items have internal dependencies:**
- B2 (CLI) must come first — it defines the subcommand parsing
- B3 (prompt) and B6 (HTML generator) are independent of each other
- B4 (orchestration) depends on B2, B3, and needs B5 and B6 to produce output
- B5 (plan template) depends on B4 for the consolidation input
- B7 (integration) is implicit — it describes how existing systems are reused, not new code

**Part A and Part B are independent** — tech debt items don't block the plan subcommand and vice versa.

---

## Testing Strategy

All changes must maintain the 95% coverage threshold enforced by `vitest.config.ts`.

### Part A Tests

- **A1 (test timeout fix):** New test file runs both markRateLimited tests with static import. Verify no timeout. Remove old tests from coverage-gaps.test.ts.
- **A2 (safeStatMtimeMs logging):** Test that `safeStatMtimeMs()` returns null on `statSync` error and calls `debug()`.
- **A3 (consolidation-checkpoint logging):** Test that `readConsolidationCheckpoint()` calls `debug()` when file contains invalid JSON.
- **A4 (stderr on timeout):** Test that timeout result includes both timeout message and original stderr when stderr is non-empty. Test that timeout result is just the timeout message when stderr is empty.
- **A5 (heading regex):** Test that area named "UXR-Custom Area" is parsed correctly. Test that `## UXR-001: Finding Title` is still skipped.
- **A6 (duplicate stop):** Existing orchestrator tests pass. No new tests.

### Part B Tests

- **B2 (CLI parsing):** Test that `uxreview plan --url <url>` routes to plan subcommand handler. Test validation: missing `--url` errors, `--instances > 1` without `--plan` warns and falls back to 1. Test that `--append` with `plan` warns.
- **B3 (discovery-only prompt):** Test that the prompt includes discovery/screenshot/checkpoint instructions but NOT report instructions. Test that scope is framed as exploration guidance. Test prompt with and without plan chunk.
- **B4 (plan orchestration):** Integration-style test: mock Claude calls, verify instances are spawned, discoveries are consolidated, plan.md and discovery.html are written to output directory.
- **B5 (plan template generation):** Test the Claude prompt produces plan-compatible format. Test fallback when Claude call fails (raw discovery used as plan.md).
- **B6 (discovery HTML):** Test that HTML output includes TOC, nested area sections, embedded base64 screenshots. Test with and without screenshots.

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
