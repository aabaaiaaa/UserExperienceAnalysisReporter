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
- **Do NOT create any files other than requirements.md and tasks.md** — no source code, no config files, no project scaffolding

After writing both documents, tell the user they need to exit this Claude session (Ctrl+C or /exit) to continue — DevLoop will commit the files and set up the workspace for task execution with "devloop run".

## Prior Work (Iteration 1)

The following work was completed in a previous iteration. Use this context to inform the new plan.

**Build on the existing codebase. Do NOT re-implement completed work unless the user requests changes.**

### Previous Requirements

```markdown
# UX Analysis Reporter — Requirements

## Overview

A TypeScript CLI tool that orchestrates multiple Claude Code instances to autonomously explore and review a web application's user experience via Playwright MCP. The tool produces a consolidated markdown report of UX findings, each uniquely identified and grouped by UI area in a hierarchical structure suitable for parallel work planning.

The tool runs unattended. The user provides a URL, context about the app, and a review plan. The tool handles everything else — splitting work, managing Claude instances, tracking progress, retrying failures, and consolidating results.

---

## User Inputs

### CLI Interface

Invocation follows this pattern:

```
uxreview --url <url> --intro <text|filepath> --plan <text|filepath> [--scope <text|filepath>] [--instances <n>] [--rounds <n>] [--output <dir>]
uxreview --show-default-scope
```

**Required parameters:**
- `--url` — The URL of the web application to review
- `--intro` — Free-form introduction/context about the app. Accepts either inline text (quoted string) or a file path. The tool detects which by checking if the value is a path to an existing file.
- `--plan` — Free-form review plan describing areas to review or skip. Accepts either inline text or a file path (same detection logic as `--intro`).

**Optional parameters:**
- `--scope` — UX evaluation criteria defining what Claude should look for and what to ignore. Accepts inline text or a file path (same detection logic as `--intro`). If not provided, the built-in default scope is used. See "Evaluation Scope" section below.
- `--show-default-scope` — Prints the built-in default evaluation scope to stdout and exits. The user can redirect this to a file, edit it, and feed it back via `--scope` to customize the criteria.
- `--instances` — Number of parallel Claude Code instances to run (default: 1)
- `--rounds` — Number of review rounds per instance (default: 1)
- `--output` — Output directory for final deliverables (default: `./uxreview-output`)

### Introduction Document

Free-form text or file. Provides Claude with the context needed to access and understand the app:

- How to access the app (login credentials, auth flows, specific steps to reach the main interface)
- What the app does and who uses it
- Key terminology, structures, or concepts Claude needs to understand
- Any specific UI patterns or frameworks in use

### Review Plan Document

Free-form text or file, but expected to follow a logical structure. Describes:

- Specific areas/pages/flows to review
- Areas to explicitly skip or ignore
- Any focus areas or specific concerns (e.g., "pay attention to form validation in settings")

The logical structure matters because the tool uses Claude to divide this plan across multiple instances. Clear sections and groupings lead to better work distribution.

### Evaluation Scope

Defines the UX evaluation criteria — what Claude should look for and what to ignore when analyzing the app. This controls the lens through which all findings are generated.

**Default scope**: The tool ships with a built-in default scope covering common UX evaluation criteria such as:
- Layout consistency and spacing
- Navigation flow and discoverability
- Form usability and validation feedback
- Error messaging and empty states
- Loading states and transitions
- Accessibility basics (contrast, labels, focus management)
- Responsiveness and viewport behavior
- Interactive element consistency (buttons, links, hover states)
- Content hierarchy and readability
- Terminology and labeling consistency

The default scope is embedded in the tool's source code as a string constant, so it's always available and versionable.

**Custom scope**: The user can override the default entirely by providing `--scope`. For example, a user who only cares about form validation and navigation could supply a scope that excludes everything else. Or a user who wants to add "check for dark mode support" on top of the defaults can copy the default via `--show-default-scope`, append their additions, and pass the modified file back.

**`--show-default-scope`**: Prints the full default scope text to stdout and exits. Typical usage:
```
uxreview --show-default-scope > my-scope.md
# edit my-scope.md
uxreview --url ... --intro ... --plan ... --scope my-scope.md
```

The scope is provided to every Claude instance alongside its plan chunk and intro doc, so all instances evaluate against the same criteria.

---

## Architecture

### Orchestration Flow

1. **Parse inputs** — Resolve intro, plan, and scope parameters (inline text vs file path, defaulting scope to the built-in default if not provided), validate URL, set defaults for optional params.

2. **Work distribution** — If more than one instance is requested, use Claude to analyze the review plan and divide it into logical chunks, one per requested instance. Each chunk should be a self-contained set of areas/flows to review. The division should minimize overlap while ensuring full coverage. If only one instance is requested, skip this step and pass the full plan through directly to avoid a wasted API call.

3. **Instance launch** — Spawn N Claude Code subprocesses, each configured with Playwright MCP. Each instance receives:
   - The full intro document
   - Its assigned chunk of the review plan
   - The evaluation scope (custom or default) defining what to look for
   - Instructions for how to write to its discovery doc, checkpoint file, and report doc

4. **Round execution** — Each instance runs its assigned number of rounds sequentially:
   - **Round 1**: Works from the assigned plan chunk and the evaluation scope
   - **Round 2+**: Works from the plan chunk, the evaluation scope, AND the accumulated discovery doc from previous rounds, using all three to identify missed areas and go deeper

5. **Progress monitoring** — The orchestrator watches checkpoint and discovery files to update the CLI progress display in real time.

6. **Failure handling** — If an instance crashes or errors, the orchestrator detects this, displays the failure in the progress UI, and retries the instance. The instance reads its checkpoint file on restart to resume from where it left off rather than restarting the round. There is a maximum retry count per instance (default: 3). If an instance exceeds the retry limit, it is marked as failed, its progress bar stays red with a final error message, and the tool continues with the remaining instances. The final consolidation uses whatever output the failed instance produced (if any).

7. **Consolidation** — Once all instances complete all rounds or are permanently failed:
   - Merge individual reports into a single final report
   - Detect and deduplicate findings that multiple instances identified independently
   - Assign clean sequential IDs (`UXR-001`, `UXR-002`, ...) to all findings
   - Remap screenshot references to the new IDs
   - Merge individual discovery docs into a consolidated human-readable discovery doc
   - Write final deliverables to the output directory

### Claude Code Instances

Each instance is a spawned Claude Code CLI subprocess. Claude Code natively supports Playwright MCP for browser interaction and can read/write files directly.

Each instance is instructed to:
- Navigate the web app according to its assigned plan areas
- Evaluate the UI against the provided evaluation scope criteria
- Observe UX issues, inconsistencies, and improvement opportunities within scope
- Capture screenshots as evidence for each finding
- Continuously write findings to its report doc with instance-scoped IDs (e.g., `I1-UXR-001`, `I2-UXR-003`)
- Continuously update its discovery doc with explored areas and elements
- Update its checkpoint file with execution state after each significant step

### File Organization

**Working directory** (temporary, internal):
```
.uxreview-temp/
  instance-1/
    discovery.md        # What this instance has explored and found
    checkpoint.json     # Execution state for resume-on-failure
    report.md           # This instance's findings
    screenshots/        # Screenshots captured during analysis
  instance-2/
    ...
  work-distribution.md  # How the plan was split across instances
```

**Output directory** (final deliverables for the user):
```
uxreview-output/        # or user-specified --output path
  report.md             # Final consolidated report
  discovery.md          # Final consolidated discovery doc
  screenshots/          # All screenshots, renamed to match final UXR IDs
```

The working directory is cleaned up between runs of the tool to avoid stale state. The output directory is overwritten on each run.

---

## Discovery Document

### Per-Instance Discovery Doc

Each Claude instance continuously writes to its own discovery doc during analysis. This document tracks:

- UI areas visited and when
- Specific UI elements, components, and features observed within each area
- What was checked in each area (layout, accessibility, consistency, etc.)
- Notes on navigation paths taken

The discovery doc accumulates across rounds within an instance. In round 2+, Claude reads the discovery doc to understand what has already been covered and focus on gaps.

### Consolidated Discovery Doc (Final Output)

After all instances complete, the tool consolidates all per-instance discovery docs into a single human-readable document. This document:

- Is structured as an indented hierarchy of UI areas and specific UI features/elements
- Is deduplicated where multiple instances explored the same areas
- Is formatted so it can be reused as a review plan document for a future run of the tool — creating a feedback loop where each run can refine and deepen the scope

---

## Checkpoint File

Each Claude instance maintains a checkpoint file (`checkpoint.json`) separate from the discovery doc. The checkpoint tracks execution state:

- Instance ID and assigned plan areas
- Current round number
- Which assigned areas are complete, in-progress, or not started
- Last completed action/step within the current area
- Timestamp of last update

On failure and retry, Claude reads the checkpoint to resume exactly where it left off — preserving all progress from the current round rather than restarting it.

---

## Report Format

### Per-Instance Reports

Each instance writes findings to its own report doc during analysis. Each finding includes:

- **Instance-scoped ID** (e.g., `I1-UXR-001`) — unique within the instance, prefixed to avoid collisions across instances
- **UI area** — which part of the app this relates to
- **Finding title** — concise description of the issue
- **Description** — detailed observation of the UX issue or inconsistency
- **Suggestion** — recommended change or improvement
- **Screenshot reference(s)** — linked by the finding ID
- **Severity/priority** — assessment of impact

### Final Consolidated Report

The consolidated report is a single markdown file that:

- Groups findings by logical UI area
- Uses indentation to show hierarchy — dependent changes are indented under their parent finding
- Top-level (root) items are independent and can be worked on in parallel with all other top-level items
- Each finding has a clean, sequential unique ID (`UXR-001`, `UXR-002`, ...)
- Duplicate findings (same issue spotted by different instances) are merged into a single entry
- Screenshots are referenced by final IDs and stored in the output screenshots folder

Example structure:
```markdown
## Navigation

### UXR-001: Inconsistent hover states on main nav items
...
  #### UXR-002: Mobile hamburger menu animation is janky
  ...
  #### UXR-003: Breadcrumb trail missing on sub-pages
  ...

## Dashboard

### UXR-004: Card grid spacing inconsistent at medium breakpoints
...
  #### UXR-005: Loading skeleton doesn't match final card layout
  ...

### UXR-006: Empty state message is generic and unhelpful
...
```

---

## CLI Progress Display

The tool provides real-time progress feedback on the command line while running.

### Progress Bars

One progress bar per Claude instance, showing:

- Instance identifier
- Current round number (e.g., "Round 2/3")
- Visual progress bar
- Percentage complete
- Stats: items checked, findings so far, round duration
- Estimated time remaining (calculated from prior round durations)

### Progress Scale

- **Round 1**: Progress is based on the number of plan items assigned to the instance. As each area is marked complete in the checkpoint, the bar advances.
- **Round 2+**: The discovery doc from previous rounds provides a more detailed picture of what needs to be checked. The progress scale recalibrates to use the discovery doc's more granular list of areas and elements.

### Color States

- **White** — Instance is actively running
- **Red** — Failure detected. The bar shows in red with a description of the error. When retry begins, a message indicates the retry attempt. On successful retry resume, the bar returns to white. If the instance exceeds the maximum retry limit, the bar stays red permanently with a final error message.
- **Green** — All rounds complete for this instance. Bar stays green.

### Completion

Once all instances are green or permanently failed (all rounds complete or retry limit exceeded for all instances), the tool shows a consolidation phase progress indicator (e.g., a spinner or status line showing "Consolidating reports..."), then outputs the path to the final report and discovery doc.

---

## Screenshots

Screenshots are captured by each Claude instance via Playwright MCP as evidence for UX findings.

- Each screenshot is named using the finding's instance-scoped ID (e.g., `I1-UXR-001.png`)
- Screenshots are stored in the instance's working directory during analysis
- During consolidation, screenshots are copied to the output directory and renamed to match the final sequential IDs (e.g., `UXR-001.png`)
- A finding may have multiple screenshots if needed (e.g., `UXR-001-a.png`, `UXR-001-b.png`)
- Screenshots are referenced in the report via relative paths

---

## Testing Strategy

### Framework

Vitest for test running and coverage reporting.

### Approach

Integration tests that mock the Claude Code CLI subprocess responses. The mocks simulate:

- Claude's work distribution analysis (dividing the plan)
- Claude instance output (discovery doc writes, checkpoint updates, report writes, screenshot captures)
- Multi-round behavior (discovery doc feeding into subsequent rounds)
- Failure scenarios (instance crashes, partial progress, retry and resume)
- Consolidation logic (deduplication, ID reassignment, screenshot remapping)

### Coverage

All code paths through the codebase must be covered by integration tests:

- Happy path: single instance, single round
- Happy path: multiple instances, multiple rounds
- Work distribution across instances
- Plan, intro, and scope as inline text vs file paths
- Default scope used when --scope not provided
- Custom scope passed through to instances
- Progress bar updates and scale recalibration
- Instance failure, checkpoint resume, and retry
- Report consolidation with duplicate detection
- Discovery doc consolidation and hierarchy building
- Screenshot capture, renaming, and remapping
- CLI argument parsing and validation
- Max retry limit exceeded, instance permanently failed
- Consolidation with partial output from failed instances
- Edge cases: single area plan, single instance skips work distribution, overlapping instance findings, all instances fail

**Coverage threshold**: 90% target, 80% hard minimum. The Vitest coverage reporter enforces this — builds fail below 80%.

### End-to-End Test

A real e2e test that exercises the full tool against a live test web app with real Claude instances (no mocks). This serves as the final validation that the tool works end-to-end before human testing.

**Test web app**: A simple static HTML web app included in the test fixtures, served locally (e.g., via a lightweight HTTP server). The app is intentionally built with known UX issues that Claude should detect, such as:
- Inconsistent button styling (different colors/sizes for same-level actions)
- Missing form validation feedback
- Broken navigation flow (dead-end page with no back link)
- Poor contrast text
- Inconsistent terminology (e.g., "Save" vs "Submit" vs "Confirm" for similar actions)
- Missing loading/empty states
- Misaligned elements or inconsistent spacing

The issues should be spread across at least 3-4 distinct UI areas so that work distribution across multiple instances is meaningful.

**Test execution**: The e2e test runs the tool with multiple Claude instances (e.g., 2-3), each assigned a subset of the test app's areas. Each instance runs 1-2 rounds. The test verifies:
- The tool completes without crashing
- The final report contains findings (actual UX issues from the test app)
- Each finding has a unique `UXR-` ID, a description, and a screenshot reference
- Screenshots exist in the output directory
- The consolidated discovery doc is present and structured hierarchically
- The report groups findings by UI area

This test is slower and requires real Claude API access, so it should be tagged/configured to run separately from the fast integration test suite (e.g., via a `--e2e` flag or a separate Vitest config).

---

## README

The project README provides:

- Brief description of what the tool does
- Prerequisites (Node.js version, Claude Code CLI installed, Playwright MCP configured)
- Installation instructions via npm (`npm install -g uxreview` or local install)
- CLI usage with all parameters documented
- Examples:
  - Basic single-instance run with inline text
  - Multi-instance run with file references
  - Custom output directory and multiple rounds
  - Exporting and customizing the default scope
- Explanation of output files (report, discovery doc, screenshots)
- How to customize evaluation scope (export default, edit, pass back)
- How to reuse the discovery doc as a plan for subsequent runs

---

## Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Good async support, CLI tooling ecosystem, works with Claude SDK |
| Package manager | npm | Standard, widely supported |
| Claude integration | Claude Code CLI subprocesses | Each instance gets Playwright MCP natively, can read/write files |
| Browser automation | Playwright MCP (via Claude Code) | Already available in Claude Code, purpose-built for this |
| Report format | Markdown | Simple, readable, easy to convert |
| Test framework | Vitest | Fast, native TS support, built-in coverage |
| Coverage target | 90% (80% minimum) | High confidence in all code paths |

---

## Constraints and Edge Cases

- **Large apps**: If the review plan is extensive, the work distribution step must produce balanced chunks. Uneven distribution means some instances finish much earlier than others.
- **Auth complexity**: Some apps may require complex auth flows (MFA, SSO). The intro doc needs to cover this, and Claude needs to be able to follow the instructions. This is a known limitation — highly complex auth may need manual setup before running the tool.
- **Playwright MCP limits**: Claude's ability to interact with certain UI elements (canvas, complex drag-and-drop, iframes) may be limited by Playwright MCP capabilities.
- **Rate limiting**: Multiple Claude Code instances running simultaneously may hit API rate limits. The orchestrator should handle backoff gracefully if this occurs.
- **Screenshot volume**: For large reviews, the number of screenshots could be significant. The tool should not attempt to store screenshots in memory — they stay on disk.
- **Duplicate detection accuracy**: The consolidation step uses Claude to detect duplicate findings across instances. This is heuristic — some near-duplicates may not be caught, and some similar-but-distinct findings may be incorrectly merged. The final report should err on the side of keeping findings separate rather than over-merging.

```

### Previous Tasks (32 tasks)

- TASK-001: Project scaffolding and configuration
- TASK-002: CLI argument parsing and validation
- TASK-003: Default evaluation scope definition
- TASK-004: File organization and working directory management
- TASK-005: Claude Code CLI calling utility
- TASK-006: Work distribution — plan splitting
- TASK-007: Claude Code instance spawning and management
- TASK-008: Checkpoint file implementation
- TASK-009: Discovery document per-instance writing
- TASK-010: Per-instance report writing with instance-scoped IDs
- TASK-011: Screenshot capture integration
- TASK-012: Multi-round execution logic
- TASK-013: Failure detection, retry, and resume
- TASK-014: CLI progress display — progress bars
- TASK-015: Progress bar scale recalibration
- TASK-016: Progress bar color states
- TASK-017: Consolidation phase progress indicator
- TASK-018: Report consolidation — merging and deduplication
- TASK-019: Report consolidation — ID reassignment and screenshot remapping
- TASK-020: Report consolidation — hierarchical grouping
- TASK-021: Discovery document consolidation
- TASK-022: Parallel instance orchestration
- TASK-023: Rate limit and backoff handling
- TASK-024: Integration tests — happy path single instance
- TASK-025: Integration tests — multi-instance multi-round
- TASK-026: Integration tests — failure, retry, and resume
- TASK-027: Integration tests — deduplication and consolidation
- TASK-028: Integration tests — edge cases and input handling
- TASK-029: E2E test web app fixture
- TASK-030: E2E test — full tool run with real Claude instances
- TASK-031: Code coverage enforcement
- TASK-032: README documentation

### Review & Recommendations

The following review was generated after the previous iteration completed. Use these findings and recommendations to guide the next iteration.

```markdown
# Code Review Report — UX Analysis Reporter

**Date**: 2026-04-02
**Reviewer**: Claude (automated review)
**Commit**: d4420c2 (master branch)

---

## Requirements vs Implementation

### Requirements Fully Met

The following requirements are implemented and verified by tests:

- **CLI argument parsing** (TASK-002): All parameters (`--url`, `--intro`, `--plan`, `--scope`, `--show-default-scope`, `--instances`, `--rounds`, `--output`, `--help`) are parsed correctly. File-vs-inline-text detection works. Validation covers URL format, required params, and positive integer checks.
- **Default evaluation scope** (TASK-003): All 10 UX criteria from requirements are present as a string constant in `src/default-scope.ts`.
- **File organization** (TASK-004): Temp directory (`.uxreview-temp/`) and output directory structures match the requirements spec exactly. Cleanup between runs works.
- **Claude Code CLI utility** (TASK-005): Subprocess spawning via `claude -p --output-format text` with stdin prompt passing, stdout/stderr capture, exit code detection, timeout handling, and extra args support.
- **Work distribution** (TASK-006): Single-instance skips Claude call; multi-instance uses Claude with `---CHUNK---` delimiter parsing. Distribution saved to `work-distribution.md`.
- **Instance spawning and management** (TASK-007): Instances receive intro, plan chunk, scope, and file instructions. 30-minute timeout. `--allowedTools` restricts tools to Bash, Read, Write, Edit, and mcp__playwright.
- **Checkpoint file** (TASK-008): Full checkpoint schema with read/write, corruption handling (returns null), resume prompt generation.
- **Discovery document** (TASK-009): Structured markdown format, accumulates across rounds, parsed and formatted correctly.
- **Per-instance report** (TASK-010): Instance-scoped IDs (`I{N}-UXR-{NNN}`), severity validation, markdown format.
- **Screenshot integration** (TASK-011): Naming convention with alphabetic suffixes for multiple screenshots per finding.
- **Multi-round execution** (TASK-012): Round 2+ includes discovery doc context. Progress scale recalibration from discovery items.
- **Failure detection, retry, resume** (TASK-013): Checkpoint-based resume, corrupted checkpoint fallback, max retry limit (default 3), permanent failure marking.
- **Progress display** (TASK-014-017): Per-instance progress bars with round tracking, percentage, stats, ETA. Color states (white/red/green/yellow). Consolidation spinner and final path output.
- **Report consolidation** (TASK-018-021): Deduplication via Claude, ID reassignment (`UXR-{NNN}`), screenshot remapping/copying, hierarchical grouping by UI area, discovery doc consolidation.
- **Parallel orchestration** (TASK-022): `Promise.allSettled` for parallel instance execution. Independent failure handling.
- **Rate limit handling** (TASK-023): Pattern-based detection, exponential backoff with jitter, separate from normal retry count.
- **All test tasks** (TASK-024-031): 628 tests passing, 96.54% statement coverage (exceeds 90% target).
- **README** (TASK-032): Comprehensive with examples, prerequisites, installation, usage, scope customization, discovery reuse workflow.

### Gaps and Partial Implementations

| # | Issue | Severity | Details |
|---|-------|----------|---------|
| 1 | **Output report filename mismatch** | Medium | The orchestrator (`src/orchestrator.ts:175`) writes the final report as `consolidated-report.md`, but the requirements (File Organization section) and README both specify it should be `report.md`. The output directory structure in the requirements is: `uxreview-output/report.md`. |
| 2 | **Coverage threshold config vs requirements** | Low | `vitest.config.ts` sets all thresholds to 80% (the hard minimum). The requirements specify 90% as the target. The actual coverage (96.54%) exceeds both, but the config should enforce 90% to prevent regression. |
| 3 | **No post-run temp directory cleanup** | Low | Requirements: "The working directory is cleaned up between runs." The implementation cleans up stale temp dirs at the *start* of a new run (`initTempDir` calls `cleanupTempDir`), but does not clean up after completion. The `.uxreview-temp/` directory persists after a run, potentially exposing intermediate data. |
| 4 | **Rate limiting not handled in consolidation** | Low | The consolidation phase makes up to 3 Claude CLI calls (deduplication, hierarchy, discovery consolidation) but has no rate-limit retry logic. Only the instance analysis phase has rate-limit backoff. Under heavy API load, consolidation can fail. |

### Scope Creep

No significant scope creep detected. The implementation closely follows the requirements without adding unnecessary features.

---

## Code Quality

### Bugs and Logic Issues

| # | File:Line | Issue | Severity |
|---|-----------|-------|----------|
| 1 | `orchestrator.ts:175` | Report filename is `consolidated-report.md` instead of `report.md` per requirements. Users following the README's output docs will look for `report.md` and not find it. | Medium |
| 2 | `file-manager.ts:73-74` | **Spin-wait busy loop** for Windows file lock retry: `while (Date.now() - start < 100 * attempt) { /* spin */ }`. This blocks the Node.js event loop entirely during the wait, preventing any async work from progressing. Since `cleanupTempDir` is synchronous this is technically functional, but it's an anti-pattern that could cause issues in larger contexts. | Low |
| 3 | `instance-manager.ts:401-415` | Rate-limit retry logic inside the normal retry loop duplicates the outer rate-limit handling (lines 345-364). This creates two separate rate-limit retry paths with potentially different behaviors. The inner loop retries against `MAX_RATE_LIMIT_RETRIES` independently for each normal retry attempt, which could lead to very long total backoff times (up to 10 rate-limit retries * 3 normal retries = 30 attempts). | Low |
| 4 | `consolidation.ts:698-699` | Child finding metadata indentation uses `split('\n').map(l => l ? '  ' + l : l).join('\n')`, which produces inconsistent indentation — the first empty line in `formatFindingMetadata` output gets skipped by the truthy check on `l`, so the blank line between the heading and metadata is not indented. Minor formatting inconsistency in the final report. | Low |

### Error Handling

Error handling is generally adequate:

- **Checkpoint corruption**: Returns `null`, triggers round restart — good.
- **Claude CLI failures**: Throw descriptive errors with exit codes and stderr content.
- **File I/O**: Discovery and report reads use try/catch, return null on failure.
- **Promise rejections**: `Promise.allSettled` prevents one instance crash from killing others.
- **Hierarchy determination**: Falls back to flat structure if Claude fails — good graceful degradation.

One concern: **No signal handling** for SIGINT/SIGTERM in the orchestrator. If the user Ctrl+C's the process, spawned Claude subprocesses may become orphaned since they're spawned with `shell: true`. The `finally` block in `orchestrate` only stops the progress display timer; it doesn't terminate child processes.

### Security Concerns

| # | Issue | Risk | Details |
|---|-------|------|---------|
| 1 | `claude-cli.ts:40` — `shell: true` in spawn | Low | The `shell: true` option routes the subprocess through the system shell, which can introduce command injection if arguments are constructed from user input. In this case, the prompt is passed via **stdin** (not as a shell argument), and the only CLI args are hardcoded (`-p`, `--output-format`, `--allowedTools`), so the actual risk is minimal. However, `shell: true` is unnecessary since `claude` can be spawned directly. Removing it would be a defense-in-depth improvement. |
| 2 | No `files` field in `package.json` | Low | When published to npm, the package will include all files (tests, `.devloop/`, etc.) since there's no `.npmignore` or `files` field. This bloats the package and could accidentally expose internal documentation. |
| 3 | `resolveTextOrFile` reads any accessible file | Info | The `--intro`, `--plan`, and `--scope` parameters can read any file the user has access to. This is expected for a CLI tool, but worth noting if the tool is ever exposed as a service. |

---

## Testing

### Coverage Summary

```
All files:           96.54% Stmts | 94.22% Branch | 96.87% Funcs | 96.54% Lines
```

| File | Statements | Notes |
|------|-----------|-------|
| checkpoint.ts | 100% | Fully covered |
| claude-cli.ts | 100% | Fully covered |
| cli.ts | 92.66% | Uncovered: lines ~105-106, 118-119 |
| consolidation.ts | 99.5% | Uncovered: discovery read error fallback (251-252) |
| default-scope.ts | 100% | Fully covered |
| discovery.ts | 97.77% | Uncovered: file read error paths |
| file-manager.ts | 86.11% | **Lowest**: Windows retry spin loop (66-75, 77) hard to test |
| instance-manager.ts | 91.96% | Uncovered: nested rate-limit retry path inside normal retries |
| orchestrator.ts | 95.61% | Uncovered: some progress callback wiring |
| progress-display.ts | 97.18% | Uncovered: some terminal rendering edge cases |
| rate-limit.ts | 93.1% | Uncovered: `sleep` function (62-63) |
| report.ts | 96.69% | Uncovered: file read error paths |
| screenshots.ts | 100% | Fully covered |
| work-distribution.ts | 100% | Fully covered |

### Test Quality Assessment

**Strengths:**
- 628 tests across 24 test files — thorough unit and integration coverage
- Clean mock isolation with `vi.mock()` for all external dependencies
- Round-trip parsing tests (format -> write -> read -> parse) for data integrity
- Failure scenario coverage: crashes, timeouts, corrupted checkpoints, rate limits, max retry exhaustion
- Real file I/O tests with proper temp directory setup/teardown
- E2E test with intentional UX issues in a fixture web app (4 pages, 10+ distinct issues)
- TypeScript compiles cleanly with strict mode (`npx tsc --noEmit` passes)

**Gaps:**
- `placeholder.test.ts` is a no-op test that can be removed
- No test verifies the orchestrator cleans up child processes on signal interruption
- The E2E test (`npm run test:e2e`) requires real Claude API access and cannot run in CI without credentials
- Integration tests mock the Claude CLI at the module level, which means the actual prompt content sent to Claude is not validated against what Claude would actually understand
- No negative test for excessively large plan inputs or very high instance counts
- The `file-manager.ts` Windows retry loop (86.11% coverage) is the weakest point but is genuinely hard to test without simulating OS-level file locks

---

## Recommendations

### Must Fix Before Production

1. **Rename output report file**: Change `consolidated-report.md` to `report.md` in `src/orchestrator.ts:175` to match the requirements and README documentation.

2. **Add `files` field to `package.json`**: Restrict published package contents to `dist/`, `README.md`, `LICENSE`, and `package.json`. Prevents leaking test fixtures, `.devloop/`, and other internal files.

### Should Fix

3. **Remove `shell: true` from `claude-cli.ts`**: The shell wrapper is unnecessary since `claude` can be invoked directly. Removing it eliminates a potential command injection vector and improves subprocess management (direct PID control for signal handling).

4. **Add SIGINT/SIGTERM handler in orchestrator**: Register a process signal handler that kills all spawned child processes before exiting. This prevents orphaned Claude instances consuming API quota.

5. **Update coverage thresholds to 90%**: Change `vitest.config.ts` thresholds from 80% to 90% to match the requirements' target and prevent regression from the current 96.54%.

6. **Add rate-limit handling to consolidation phase**: The 3 Claude calls in consolidation (dedup, hierarchy, discovery merge) should have the same backoff-retry logic as the instance analysis phase.

### Nice to Have

7. **Clean up temp directory after successful run**: Add `cleanupTempDir()` to the `finally` block in `orchestrate` (or make it optional with a `--keep-temp` flag for debugging).

8. **Remove `placeholder.test.ts`**: It serves no purpose now that real tests exist.

9. **Simplify nested rate-limit retry logic**: The duplicated rate-limit backoff inside the normal retry loop (`instance-manager.ts:396-415`) could be extracted into a shared helper to avoid the two separate retry paths.

---

## Future Considerations

### Features and Improvements

- **Streaming progress from Claude instances**: Instead of polling checkpoint files on a 1-second interval, consider having Claude instances signal progress through a more structured channel (e.g., a named pipe or JSON lines on stderr) for more responsive progress updates.

- **Incremental output**: Allow the tool to append to an existing output directory rather than always overwriting. This enables iterative refinement where users run the tool multiple times and accumulate findings.

- **Configurable retry limits and timeouts**: Expose `--max-retries`, `--instance-timeout`, and `--rate-limit-retries` as CLI options. Different apps and API quotas may need different tuning.

- **HTML report output**: Add an optional `--format html` flag that generates a styled HTML report with embedded screenshots, making findings easier to share with non-technical stakeholders.

- **Finding severity filtering**: Allow `--min-severity major` to exclude low-severity findings from the final report, reducing noise for teams that want to focus on high-impact issues.

### Architectural Decisions to Revisit

- **Claude CLI subprocess model**: Each instance is a separate `claude -p` invocation, which means each one bootstraps independently (no shared context, no token reuse). As the tool scales to more instances, this could be replaced with the Claude Agent SDK for more efficient resource sharing and finer-grained control.

- **File-based inter-process communication**: Checkpoints, discovery docs, and reports are communicated between the orchestrator and Claude instances via filesystem writes/reads. This is simple and reliable, but introduces polling latency and potential read-during-write issues. A structured IPC mechanism (e.g., JSON-RPC over stdin/stdout) would be more robust at scale.

- **Sequential hierarchy determination**: `organizeHierarchically` calls Claude once per UI area group (sequentially via `for...of`). With many UI areas, this creates a serial bottleneck. These calls could be parallelized with `Promise.all`.

- **Synchronous file I/O**: All file operations (`readFileSync`, `writeFileSync`, etc.) are synchronous. This is fine for a CLI tool, but could become a bottleneck if the tool is ever embedded in a server context. The progress display's `updateFromFiles` method does synchronous reads on every 1-second poll tick, which blocks the event loop briefly.

### Technical Debt

- **Duplicated rate-limit retry logic** in `instance-manager.ts` (lines 345-364 and 396-415) — two nearly identical loops that should be consolidated.
- **Magic numbers**: Instance timeout (30 min), default CLI timeout (5 min), poll interval (1 sec), and spinner frames are hardcoded constants scattered across modules. These could be centralized in a config module.
- **No logging**: The tool has no structured logging. Adding a debug log level (e.g., via `--verbose`) would aid troubleshooting without cluttering normal output.
- **`buildNewScreenshotFilenames` suffix scheme**: Uses `String.fromCharCode(96 + i)` which only supports 26 suffixes (a-z). A finding with 27+ screenshots would produce invalid filenames. This is unlikely in practice but is an undocumented limitation.

---

## Summary

The project is well-implemented with strong test coverage (96.54%, 628 tests) and close adherence to requirements. The architecture is clean, with good separation of concerns across 14 focused modules. The main issues are:

1. **One naming bug** (output report filename mismatch)
2. **One missing defense-in-depth** (no signal handler for child process cleanup)
3. **One config discrepancy** (80% vs 90% coverage threshold)
4. **Minor code duplication** in rate-limit retry logic

None of these are blocking for an initial release, but items 1 and 2 should be addressed before production use.

```

