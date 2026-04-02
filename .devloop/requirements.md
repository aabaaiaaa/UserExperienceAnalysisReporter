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
