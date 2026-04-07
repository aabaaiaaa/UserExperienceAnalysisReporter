# CLAUDE.md

This file provides guidance to Claude Code when working in this workspace.

## Environment

- **Platform**: Windows
- **Workspace**: C:\Users\jeastaugh\source\repos\Experiments\UserExperienceAnalysisReporter
- Use Windows-compatible commands (e.g., use backslashes in paths, no Unix-specific commands)

## Current Task

You are helping the user plan their project. This happens in three phases.

**IMPORTANT: Do NOT implement the project. Do NOT write code, create source files, install packages, or build anything. Your ONLY job right now is to plan and write the requirements and task list. The actual implementation will happen later in a separate automated process.**

---

### Phase 1 — Discovery (do NOT write any files)

**IMPORTANT: Use the AskUserQuestion tool whenever you need the user to make a choice or decision.** This includes both technical choices and design decisions. Only use free-form conversation for open-ended discovery questions where multiple-choice doesn't make sense.

Start by asking the user to describe their project in their own words. Understand:

- What does the project do? Who uses it?
- What are all the features and how do they connect?
- What are the user flows end-to-end?
- What does "done" look like — what are the success criteria?
- Are there any edge cases or failure modes to handle?

Use natural conversation for open-ended questions — let the user explain freely and ask follow-up questions.

For standard technical choices, use the **AskUserQuestion tool** to present options rather than asking open-ended questions. These include things like:

- Language/runtime (TypeScript, Python, Go, etc.)
- Framework (React, Express, FastAPI, etc.)
- Testing approach (unit, integration, e2e) and framework (Jest, Vitest, pytest, etc.)
- Package manager, build tools, linting
- Database, auth strategy, deployment target

Present sensible defaults based on what you've learned about the project. The user can always pick "Other" to specify something different.

Once discovery feels complete, review the full picture before moving to Phase 2:

- Flag any inconsistencies between features (e.g., conflicting requirements, missing glue between components)
- Identify gaps — features that were mentioned but not fully explored
- Check that the technical choices work together coherently
- Present your findings to the user and resolve any issues before proceeding

Iterate until the user is satisfied with the plan.

**Do NOT write any files during Phase 1.**

---

### Phase 2 — Write requirements.md (when user confirms the plan)

When the user says the plan is ready, write a detailed, human-readable requirements document to `C:\Users\jeastaugh\source\repos\Experiments\UserExperienceAnalysisReporter\.devloop\requirements.md`.

This document should be a **narrative planning document** — NOT a task list. Write it in free-form markdown with sections, descriptions, technical decisions, and context. This is the reference document that developers (and Claude during implementation) will read to understand what needs to be built and why.

Include things like: feature descriptions, user flows, technical approach, testing strategy, edge cases, dependencies, and any decisions made during discovery.

**Do NOT include task format (TASK-001, etc.) in this file.** That comes in Phase 3.

---

### Phase 3 — Generate tasks.md (after requirements.md is written)

After writing requirements.md, convert the plan into a structured task list at `C:\Users\jeastaugh\source\repos\Experiments\UserExperienceAnalysisReporter\.devloop\tasks.md`.

Each task should reference the requirements document for full context. The task format is:

```markdown
### TASK-001: Task title here
- **Status**: pending
- **Dependencies**: none
- **Description**: Clear description of what needs to be done. Reference the requirements doc for detail.
- **Verification**: A specific, testable check to confirm the task is complete.

### TASK-002: Another task
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: This task depends on TASK-001 completing first.
- **Verification**: Run "npm test" and all tests pass.
```

### Task Rules

- Task IDs must be sequential: TASK-001, TASK-002, TASK-003, etc. For larger tasks that need to be broken down, use letter suffixes: TASK-001a, TASK-001b, etc.
- **Tasks must be small and focused** — each should be completable by an automated AI agent in approximately 10-20 minutes. If a task would take longer, break it into smaller subtasks using letter suffixes. Large tasks will time out and fail.
- Status must always be `pending` for new tasks
- Dependencies: `none` or comma-separated task IDs (e.g., `TASK-001, TASK-002`)
- Descriptions should be clear and actionable
- **Every task MUST have a Verification field** with a specific, **targeted** check. Run only the tests relevant to the task, NOT the full test suite. Examples:
  - Good: `npm test -- --grep "calculator"` or `npx jest src/calc.test.ts`
  - Bad: `npm test` (runs everything — slow, may fail for unrelated reasons)
  - Good: `tsc --noEmit src/calc.ts` (type-check just the changed file)
  - Bad: `tsc --noEmit` (type-checks entire project)
- **For E2E/integration test suites** (Playwright, Cypress, Selenium, etc.) that take a long time to run, ONLY target the specific test files relevant to the task — NEVER the entire E2E suite unless explicitly required:
  - Good: `npx playwright test tests/auth.spec.ts` (only the auth E2E test)
  - Bad: `npx playwright test` (runs ALL E2E tests — extremely slow)
- **Match verification scope to change scope**: small changes need small targeted tests. Only run tests that exercise code paths touched by the task.
- **Do NOT create any files other than requirements.md and tasks.md** — no source code, no config files, no project scaffolding

After writing both documents, tell the user they need to exit this Claude session (Ctrl+C or /exit) to continue — DevLoop will commit the files and set up the workspace for task execution with "devloop run".

## Prior Work (Iteration 1)

The following work was completed in a previous iteration. Use this context to inform the new plan.

**Build on the existing codebase. Do NOT re-implement completed work unless the user requests changes.**

### Previous Requirements

```markdown
# UX Analysis Reporter — Iteration 3 Requirements

## Overview

This iteration addresses the remaining bugs from the iteration 2 review, adds checkpoint-based resumability to the consolidation phase, introduces several new features (streaming progress, incremental output, HTML reports, dry-run mode, verbose logging), and improves code quality through configuration centralization and CLI extensibility.

All changes build on the existing codebase. The prior two iterations produced a fully functional tool with 95%+ test coverage across 26 test files. This iteration fixes specific issues, extends the architecture, and adds user-facing features without altering the existing core behavior.

---

## Bug Fixes

### 1. Create LICENSE file

**Problem:** `package.json` declares `"license": "MIT"` and the `files` array includes `"LICENSE"`, but no LICENSE file exists at the project root. `npm publish` will warn about the missing file, and users have no license text.

**Fix:** Create a standard MIT LICENSE file at the project root with the correct year and copyright holder.

**Scope:** Project root only. No code changes, no tests needed.

---

### 2. Move `distributePlan` inside the `try` block

**Problem:** In `orchestrator.ts`, `initWorkspace()` (line 111) and `distributePlan()` (line 114) are called before the `try` block (line 132). If `distributePlan` throws — for example, if the Claude CLI binary is missing or rate-limited — the workspace directories created by `initWorkspace` are never cleaned up because the `finally` block only runs for code inside `try`.

**Fix:** Move the `distributePlan()` call inside the `try` block so that the `finally` block's cleanup logic (signal handler removal, display stop, temp dir cleanup) applies to distribution failures too. The workspace layout from `initWorkspace` is still needed before the `try` block, but `distributePlan` can safely move inside it.

**Testing:** Add a test that verifies workspace cleanup occurs when `distributePlan` throws.

**Scope:** `orchestrator.ts`, affected test files.

---

### 3. Fix trailing whitespace on blank lines in consolidation

**Problem:** `consolidation.ts:699` uses `.map(l => \`  \${l}\`).join('\n')` to indent child finding metadata. This produces `"  "` (two spaces) on blank separator lines. While markdown rendering is unaffected, linters and editors flag trailing whitespace.

**Fix:** Change the indentation logic to trim blank lines, e.g., `.map(l => l.trim() === '' ? '' : \`  \${l}\`)`.

**Testing:** Update existing consolidation tests to verify blank lines in indented child findings have no trailing whitespace.

**Scope:** `consolidation.ts`, affected test files.

---

### 4. Replace `as string` cast with runtime check in CLI

**Problem:** `cli.ts:177` uses `(raw.get('output') as string)` to cast the output flag value. The cast is safe because `parseRawArgs` guarantees non-boolean flags have string values, but the cast obscures that safety guarantee.

**Fix:** Replace the cast with a runtime type check, consistent with how other flag values are handled in the same function.

**Testing:** Add a test case that verifies the output flag defaults correctly when not provided.

**Scope:** `cli.ts`, affected test files.

---

### 5. Validate plan/intro file size

**Problem:** `resolveTextOrFile()` in `cli.ts:41-47` reads entire files into memory with no size limit. Accidentally passing a large file (e.g., a log dump) could exhaust memory.

**Fix:** After reading the file, check its size. Warn if >1MB, reject with an error if >10MB. Apply to all three text-or-file parameters: `--intro`, `--plan`, and `--scope`.

**Testing:** Add tests for both the warning threshold and the rejection threshold. Test that inline text (not files) is not subject to the size check.

**Scope:** `cli.ts`, affected test files.

---

### 6. Document 26-screenshot suffix limit

**Problem:** `buildNewScreenshotFilenames()` in `consolidation.ts:372-379` uses `String.fromCharCode(96 + i)` for suffixes (a-z), which only supports 26 screenshots per finding. A finding with 27+ screenshots would produce non-alphabetic characters.

**Fix:** Add a note in the README documenting this limitation. No code change.

**Scope:** README only. No tests needed.

---

## Infrastructure and Code Quality

### 7. Centralize magic numbers into a config module

**Problem:** Hardcoded constants are scattered across multiple files: instance timeout (30 min), default CLI timeout (5 min), poll interval (1 sec), max retries (3), rate-limit retries (10), spinner frame rate, and others. This makes the values hard to discover and change.

**Fix:** Create a `src/config.ts` module that exports all these constants as named exports. Update all files that reference the hardcoded values to import from the config module. The existing constants in `rate-limit.ts` (`DEFAULT_BASE_DELAY_MS`, `MAX_BACKOFF_DELAY_MS`, `MAX_RATE_LIMIT_RETRIES`) should either move to `config.ts` or be re-exported from it.

This module will also serve as the foundation for change #8 (CLI-configurable overrides).

**Testing:** Verify that changing a config value propagates correctly (e.g., a test that imports the config and asserts expected values). Ensure existing tests continue to pass with the refactored imports.

**Scope:** New `src/config.ts`, all files with hardcoded constants (`orchestrator.ts`, `instance-manager.ts`, `rate-limit.ts`, `progress-display.ts`, `claude-cli.ts`), affected test files.

---

### 8. Configurable retry limits and timeouts as CLI options

**Problem:** Users cannot tune retry limits or timeouts for their specific API quota or app complexity. The defaults are reasonable but not always appropriate.

**Fix:** Add the following CLI options, all of which default to the values in `config.ts` (from change #7):
- `--max-retries <n>` — Maximum normal retry attempts per instance (default: 3)
- `--instance-timeout <minutes>` — Timeout per Claude instance in minutes (default: 30)
- `--rate-limit-retries <n>` — Maximum rate-limit retry attempts globally (default: 10)

Update `ParsedArgs` to include these fields. Thread the values through to the instance manager and rate-limit logic. Update the USAGE string and README.

**Testing:** Test that custom values override defaults. Test that invalid values (negative, zero, non-numeric) are rejected. Test that defaults apply when flags are omitted.

**Scope:** `cli.ts`, `config.ts`, `orchestrator.ts`, `instance-manager.ts`, README, affected test files.

---

### 9. Add `--verbose` flag for debug logging

**Problem:** The tool has no structured logging. When something goes wrong, there's no way to see what the tool was doing internally without reading the source code.

**Fix:** Add a `--verbose` boolean CLI flag. When set, the tool outputs debug-level information to stderr (so it doesn't interfere with stdout usage). Log:
- Subprocess spawn and exit (command, args, PID, exit code, duration)
- File reads and writes (path, size)
- Retry decisions (reason, attempt number, backoff duration)
- Timing data (phase durations: distribution, instance execution, consolidation)
- Checkpoint reads and writes

Implement as a simple logging utility (e.g., `src/logger.ts`) that checks a global verbose flag. Keep it lightweight — no external logging library.

**Testing:** Test that verbose mode produces expected log output for key operations. Test that non-verbose mode produces no debug output.

**Scope:** New `src/logger.ts`, `cli.ts`, `orchestrator.ts`, `instance-manager.ts`, `claude-cli.ts`, `file-manager.ts`, `checkpoint.ts`, `consolidation.ts`, affected test files.

---

## Consolidation Resumability

### 10. Add checkpoint-based resumability to the consolidation phase

**Problem:** The consolidation phase makes three sequential Claude calls: deduplication (`consolidation.ts:255`), hierarchy determination (`consolidation.ts:629`), and discovery document merge (`consolidation.ts:829`). There is no persistence between these steps. If any step fails — due to rate limits, crashes, SIGINT, or any other interruption — all consolidation progress is lost. The user's analysis results from potentially 30+ minutes of instance execution are trapped in raw temp files with instance-scoped IDs and no consolidated report. There is no easy way for the user to recover their results.

**Fix:** Add a consolidation checkpoint system, consistent with how instance execution already handles interruptions via the existing `checkpoint.ts` module:

1. **Consolidation checkpoint schema:** Define a `ConsolidationCheckpoint` interface tracking which consolidation steps have completed and their outputs. Steps are: `dedup`, `reassign`, `hierarchy`, `format-report`, `discovery-merge`, `write-discovery`. Store the checkpoint in `.uxreview-temp/consolidation-checkpoint.json`.

2. **Checkpoint after each step:** After deduplication completes, persist the dedup results. After hierarchy completes, persist the hierarchy results. After discovery merge completes, persist the merged content. Each step reads from the checkpoint if available rather than recomputing.

3. **Resume on re-run:** When the orchestrator enters the consolidation phase, check for an existing consolidation checkpoint. If one exists, skip completed steps and resume from the first incomplete step. The existing instance execution results (reports, discovery docs, screenshots) are already persisted in `.uxreview-temp/instance-*` directories, so they remain available for consolidation on re-run.

4. **Integration with existing flow:** The orchestrator's consolidation section (`orchestrator.ts:171-194`) should be refactored to check for and use the consolidation checkpoint. The `--keep-temp` flag behavior is unchanged — when temp is cleaned up, the consolidation checkpoint goes with it, which is correct because the final output has already been written.

5. **Signal handler integration:** The existing SIGINT/SIGTERM handler should allow consolidation checkpoints to be written before exit. Since consolidation steps are sequential, the checkpoint is always up to date after each step completes — no special handling is needed beyond what's already there.

**Testing:** Integration tests for:
- Full consolidation completes and produces a checkpoint at each step
- Resuming after dedup completion skips dedup and runs remaining steps
- Resuming after hierarchy completion skips dedup and hierarchy
- Resuming after discovery merge writes final output
- Corrupted consolidation checkpoint triggers full reconsolidation
- Missing consolidation checkpoint triggers full consolidation (normal case)

**Scope:** New `src/consolidation-checkpoint.ts` (or extend `checkpoint.ts`), `consolidation.ts`, `orchestrator.ts`, affected test files.

---

### 11. Recovery documentation in README

**Problem:** There is no documentation explaining what happens when the tool is interrupted and how to recover.

**Fix:** Add a "Recovery and Resumption" section to the README covering:
- What happens when the tool is interrupted during instance execution (checkpoints allow re-run to resume)
- What happens when the tool is interrupted during consolidation (consolidation checkpoints allow re-run to resume, as of change #10)
- How to re-run the tool to resume from where it left off
- How `--keep-temp` can be used to preserve intermediate state for debugging
- Where the raw instance data lives (`.uxreview-temp/instance-*`) if manual inspection is needed

**Scope:** README only. No tests needed.

---

## New Features

### 12. Streaming progress from Claude instances

**Problem:** The progress display polls checkpoint and report files on a 1-second interval using synchronous file reads (`progress-display.ts:291-308`). This blocks the event loop on each tick, and the 1-second fixed interval provides sluggish feedback, especially with many instances.

**Fix:** Replace the file-polling mechanism with a structured progress channel:

1. **Event-based progress:** Instead of the progress display reading checkpoint files, instances push progress events through a callback or event emitter. The instance manager already has a `ProgressCallback` interface — extend it to include item-level progress updates (completed items, in-progress items, finding counts) that currently come from file polling.

2. **Remove file-polling from ProgressDisplay:** The `updateFromFiles()` and `updateAllFromFiles()` methods should be removed. All progress data should arrive via the callback mechanism. The 1-second timer becomes purely a render tick for the display (updating ETA, spinner animation), not a data-fetch cycle.

3. **Configurable render interval:** If performance is a concern with many instances, the render interval can be made longer than 1 second. Default to 1 second but allow the config module to control it.

4. **Checkpoint files remain:** Checkpoints are still written to disk for resume purposes (they serve the checkpoint/resume system, not the progress display). The change is that the progress display no longer reads them — it gets its data from the event stream.

**Testing:** Test that progress events flow from instance execution to the display without file polling. Test that the display updates correctly from events. Existing integration tests that verify progress state transitions should continue to pass with the new mechanism.

**Scope:** `progress-display.ts`, `instance-manager.ts`, `orchestrator.ts`, `config.ts`, affected test files.

---

### 13. Incremental output

**Problem:** Each run overwrites the output directory (`file-manager.ts:108-109` removes existing output). Users who want to iteratively refine their analysis across multiple runs lose previous results.

**Fix:** Add an `--append` CLI flag (boolean, default `false`):

1. **When `--append` is false (default):** Current behavior — output directory is recreated from scratch.

2. **When `--append` is true:**
   - The output directory is preserved. New findings are added to the existing report rather than replacing it.
   - Existing finding IDs (`UXR-NNN`) are read from the current report to determine the next available ID number, so new findings get sequential IDs that don't collide.
   - Deduplication runs across both existing and new findings to avoid duplicating findings from previous runs.
   - Screenshots are added to the existing screenshots directory without overwriting.
   - The discovery document is merged with the existing one.
   - The report is regenerated with all findings (old + new) organized hierarchically.

3. **Edge cases:**
   - If `--append` is used but the output directory doesn't exist, behave as a fresh run (no error).
   - If the existing report is corrupt or unparseable, warn and start fresh.

**Testing:** Test fresh run with `--append` and no existing output. Test append to existing output with proper ID continuation. Test dedup across old and new findings. Test screenshot accumulation without overwrites.

**Scope:** `cli.ts`, `file-manager.ts`, `orchestrator.ts`, `consolidation.ts`, `report.ts`, README, affected test files.

---

### 14. HTML report output

**Problem:** The markdown report is functional but not easily shareable with non-technical stakeholders. Screenshots must be viewed separately from the report.

**Fix:** Add a `--format` CLI option with values `markdown` (default) and `html`:

1. **Markdown format (default):** Current behavior, unchanged.

2. **HTML format:** Generate a self-contained HTML file with:
   - Styled report with a clean, professional layout (inline CSS, no external dependencies)
   - Screenshots embedded as base64 `<img>` tags so the HTML file is fully self-contained
   - Finding severity highlighted with color (e.g., critical=red, major=orange, minor=yellow, info=blue)
   - Collapsible sections per UI area using `<details>`/`<summary>` HTML elements
   - Table of contents with anchor links to each finding
   - Basic metadata header (URL reviewed, date, instance count, round count)

   This is a pure code transformation — no Claude calls. The structured findings data is already available in memory after consolidation. The HTML generator takes that data, applies a template, and encodes screenshots from their known paths.

3. **Output filename:** `report.html` when HTML format is selected, `report.md` for markdown.

**Testing:** Test HTML generation produces valid, self-contained HTML. Test that screenshots are properly base64-encoded and embedded. Test the `--format` flag parsing and validation. Test that markdown output is unchanged when `--format markdown` or no `--format` is specified.

**Scope:** New `src/html-report.ts`, `cli.ts`, `orchestrator.ts`, `consolidation.ts`, README, affected test files.

---

### 15. `--dry-run` mode

**Problem:** Users have no way to preview what the tool will do before committing to a potentially long and expensive run.

**Fix:** Add a `--dry-run` boolean CLI flag. When set:

1. **Work distribution still runs:** The single Claude call for `distributePlan` executes normally so the user can see how work will be split across instances.

2. **Instance execution is skipped:** No analysis instances are spawned. No Claude API calls beyond the distribution call.

3. **Output:** Print to stdout:
   - The number of instances and rounds that would run
   - For each instance: the plan chunk it would receive and the areas it would review
   - The evaluation scope being used
   - Estimated API cost/time if calculable, or a note that this depends on app complexity

4. **Exit cleanly:** No temp directory is created (or it's cleaned up immediately). Exit code 0.

**Testing:** Test that `--dry-run` calls `distributePlan` but does not spawn instances. Test that the output contains the expected plan chunks and instance assignments. Test that no temp directory persists after a dry run.

**Scope:** `cli.ts`, `orchestrator.ts`, `work-distribution.ts`, README, affected test files.

---

### 16. Multi-level finding hierarchy

**Problem:** The current hierarchy model (`consolidation.ts:529`) enforces a single-level constraint: "A finding cannot be both a parent and a child." For complex applications, deeper nesting would better represent the relationship structure (e.g., page-level issue > section-level issue > component-level issue).

**Fix:**

1. **Remove the single-level constraint** from the hierarchy prompt in `consolidation.ts`. Update the prompt to allow a finding to be both a parent and a child, enabling arbitrary nesting depth.

2. **Update `HierarchicalFinding`** to support recursive nesting. The `children` array already contains `Finding` objects — change it to contain `HierarchicalFinding` objects so children can have their own children.

3. **Update `buildHierarchy()`** to construct a tree of arbitrary depth from the flat `CHILD_OF` mappings. Detect and handle cycles (a finding cannot be its own ancestor) — if a cycle is detected, break it by keeping the finding at the top level.

4. **Update `formatConsolidatedReport()`** to render multi-level indentation. Each nesting level adds one indent level. The heading level should also increase (e.g., `###` for top-level, `####` for children, `#####` for grandchildren), capping at `######` (HTML's deepest heading level) for very deep nesting.

5. **Update the HTML report** (change #14) to handle multi-level nesting with corresponding indentation and collapsible sections.

**Testing:** Test hierarchy building with 2+ levels of nesting. Test cycle detection and breaking. Test report formatting at multiple nesting depths. Test that single-level hierarchies still work correctly (backward compatible).

**Scope:** `consolidation.ts`, `html-report.ts` (from change #14), affected test files.

---

## Testing Strategy

All code changes must maintain the 95% coverage threshold enforced by `vitest.config.ts`. Every change that modifies source code must include corresponding tests.

- **Bug fixes (#2-#5):** Small, targeted tests alongside the fixes. Update existing tests where assertions change.
- **Config centralization (#7):** Verify imports propagate correctly. Existing tests should pass with refactored imports.
- **CLI options (#8, #9):** Test parsing, validation, defaults, and threading through to the relevant modules.
- **Consolidation resumability (#10):** Integration tests covering each checkpoint/resume scenario, including corruption and missing checkpoint cases.
- **Streaming progress (#12):** Test event flow from instance execution to display. Existing progress state transition tests should migrate to the new mechanism.
- **Incremental output (#13):** Integration tests for append behavior, ID continuation, cross-run dedup.
- **HTML report (#14):** Test HTML validity, base64 embedding, format flag parsing.
- **Dry-run (#15):** Test that distribution runs but instances don't, and output is correct.
- **Multi-level hierarchy (#16):** Test tree construction, cycle detection, multi-level rendering.

All existing tests must continue to pass after the changes.

---

## Out of Scope

The following items are deferred to a future iteration:

- Finding severity filtering (`--min-severity`)
- Claude Agent SDK migration
- Structured IPC (replacing file-based communication)

---

## Dependencies Between Changes

Some changes have ordering dependencies:

- **#7 (config module) before #8 (CLI overrides):** The CLI options override values from the config module.
- **#7 (config module) before #12 (streaming progress):** The render interval comes from config.
- **#10 (consolidation checkpointing) before #13 (incremental output):** Incremental output needs the consolidation to be robust against interruption.
- **#14 (HTML report) before #16 (multi-level hierarchy) or concurrent:** The hierarchy rendering in HTML needs to support multiple levels.
- **#9 (verbose logging) is independent** and can be done at any point, but is more useful once other changes are in place.

```

### Previous Tasks (27 tasks)

- TASK-001: Create MIT LICENSE file
- TASK-002: Move distributePlan inside the try block
- TASK-003: Fix trailing whitespace on blank lines in consolidation
- TASK-004: Replace as-string cast with runtime check in CLI
- TASK-005: Add file size validation to resolveTextOrFile
- TASK-006: Document 26-screenshot suffix limit in README
- TASK-007: Create config module with centralized constants
- TASK-007a: Migrate all hardcoded constants to use config module
- TASK-008a: Add CLI flags for retry limits and timeouts — parsing
- TASK-008b: Thread configurable retry/timeout values through execution
- TASK-009a: Create logger utility module
- TASK-009b: Add --verbose CLI flag and wire logging into modules
- TASK-010a: Define consolidation checkpoint schema and read/write functions
- TASK-010b: Integrate consolidation checkpointing into orchestrator
- TASK-010c: Add consolidation checkpoint integration tests
- TASK-011: Add recovery documentation to README
- TASK-012a: Extend ProgressCallback with item-level progress events
- TASK-012b: Remove file-polling from ProgressDisplay
- TASK-013a: Add --append CLI flag and preserve output directory
- TASK-013b: Read existing findings and continue ID numbering in append mode
- TASK-013c: Cross-run deduplication and merged output in append mode
- TASK-014a: Create HTML report generator module
- TASK-014b: Add screenshot base64 embedding to HTML report
- TASK-014c: Add --format CLI flag and wire HTML output into orchestrator
- TASK-015: Add --dry-run mode
- TASK-016a: Update HierarchicalFinding to support recursive nesting
- TASK-016b: Update report formatting for multi-level hierarchy

### Review & Recommendations

A review was generated after the previous iteration completed.
READ the review file at: .devloop/archive/iteration-1/review.md
Use the findings and recommendations to guide the next iteration.

