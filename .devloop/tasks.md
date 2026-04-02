# UX Analysis Reporter — Tasks

### TASK-001: Project scaffolding and configuration
- **Status**: done
- **Dependencies**: none
- **Description**: Initialize the TypeScript project with npm. Set up `package.json`, `tsconfig.json`, Vitest config with coverage thresholds (90% target, 80% minimum), and the basic directory structure (`src/`, `tests/`). Configure the project as a CLI tool with a `bin` entry point. See requirements.md for the full tech stack.
- **Verification**: `npm install` completes without errors, `npx tsc --noEmit` passes, `npx vitest run` executes (even with no tests yet).

### TASK-002: CLI argument parsing and validation
- **Status**: done
- **Dependencies**: TASK-001, TASK-003
- **Description**: Implement CLI argument parsing for `--url`, `--intro`, `--plan`, `--scope`, `--show-default-scope`, `--instances`, `--rounds`, and `--output`. For `--intro`, `--plan`, and `--scope`, detect whether the value is a file path (check if file exists) or inline text. Validate required params are present, URL is valid, numeric params are positive integers. `--show-default-scope` prints the default scope to stdout and exits (no other params required). Print help/usage on invalid input. See requirements.md "User Inputs" and "Evaluation Scope" sections.
- **Verification**: Run the CLI with valid args and confirm they are parsed correctly. Run with missing required args and confirm a helpful error message is shown. Run with file paths and inline text for `--intro`/`--plan`/`--scope` and confirm all resolve correctly. Run `--show-default-scope` and confirm it prints the default scope and exits.

### TASK-003: Default evaluation scope definition
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Define the built-in default evaluation scope as a string constant in the source code. This covers common UX criteria: layout consistency, navigation flow, form usability, error messaging, loading states, accessibility basics, responsiveness, interactive element consistency, content hierarchy, and terminology consistency. This constant is used when `--scope` is not provided and is printed by `--show-default-scope`. See requirements.md "Evaluation Scope" section for the full list.
- **Verification**: Import the default scope constant and confirm it contains all the criteria listed in requirements.md.

### TASK-004: File organization and working directory management
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Implement the working directory structure (`.uxreview-temp/`) and output directory structure. Create functions to initialize the temp directory with per-instance subdirectories, and to clean up the temp directory between runs. Create functions to set up the output directory. See requirements.md "File Organization" section for the exact structure.
- **Verification**: Run the init function and confirm the directory structure is created correctly. Run cleanup and confirm the temp directory is removed. Confirm output directory is created at the specified or default path.

### TASK-005: Claude Code CLI calling utility
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Implement a shared utility module for invoking Claude Code CLI as a subprocess. This utility is used by multiple parts of the tool: work distribution (one-off call to split the plan), analysis instances (long-running subprocesses), and consolidation (one-off calls for deduplication and merging). The utility should handle spawning the subprocess, passing prompts/context, capturing output, detecting success/failure, and returning results. See requirements.md "Claude Code Instances" section for context.
- **Verification**: Call the utility with a simple prompt and confirm it spawns a Claude Code subprocess, captures the output, and returns it. Confirm failure detection works when the subprocess exits with an error.

### TASK-006: Work distribution — plan splitting
- **Status**: done
- **Dependencies**: TASK-002, TASK-004, TASK-005
- **Description**: Implement the work distribution step. Use the Claude CLI utility (TASK-005) to analyze the review plan and divide it into N logical chunks (one per requested instance). Each chunk should be self-contained. Store the distribution result in `.uxreview-temp/work-distribution.md`. When only one instance is requested, skip the Claude call and pass the full plan through directly. See requirements.md "Work Distribution" under Architecture.
- **Verification**: Provide a multi-section review plan and request 3 instances. Confirm the plan is split into 3 logical chunks with minimal overlap and full coverage. Request 1 instance and confirm no Claude call is made — the full plan is passed through.

### TASK-007: Claude Code instance spawning and management
- **Status**: done
- **Dependencies**: TASK-005, TASK-006
- **Description**: Implement the logic to spawn Claude Code CLI subprocesses for analysis using the shared Claude CLI utility (TASK-005). Each instance receives the full intro doc, its assigned plan chunk, the evaluation scope (custom or default), and instructions for writing to its discovery doc, checkpoint file, and report doc. Manage the subprocess lifecycle — start, monitor, detect completion or failure. See requirements.md "Claude Code Instances" section.
- **Verification**: Spawn a single Claude Code instance with a mock plan chunk. Confirm the subprocess starts, receives the correct inputs (including scope), and the orchestrator can detect when it completes or fails.

### TASK-008: Checkpoint file implementation
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Define the checkpoint file schema (`checkpoint.json`) and implement read/write functions. The checkpoint tracks: instance ID, assigned areas, current round number, area completion status (complete/in-progress/not-started), last completed action, and timestamp. Implement resume logic — on retry, read the checkpoint and construct a prompt that tells Claude where to resume. See requirements.md "Checkpoint File" section.
- **Verification**: Write a checkpoint, read it back, confirm all fields are correct. Simulate a mid-area failure, write checkpoint, then confirm the resume prompt correctly instructs Claude to continue from the last completed step.

### TASK-009: Discovery document per-instance writing
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Implement the per-instance discovery document format and instruct Claude instances to continuously write to it. The discovery doc tracks UI areas visited, specific elements observed, what was checked, and navigation paths. Ensure the discovery doc accumulates across rounds. See requirements.md "Per-Instance Discovery Doc" section.
- **Verification**: After a mock instance run, confirm the discovery doc contains structured entries for visited areas and elements. After a second round, confirm the doc has accumulated new entries alongside round 1 entries.

### TASK-010: Per-instance report writing with instance-scoped IDs
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Implement the per-instance report format. Each finding includes an instance-scoped ID (e.g., `I1-UXR-001`), UI area, title, description, suggestion, screenshot reference, and severity. Instruct Claude instances to write findings in this format continuously. See requirements.md "Per-Instance Reports" section.
- **Verification**: After a mock instance run, confirm the report contains properly formatted findings with instance-scoped IDs, and that screenshot references use the correct ID format.

### TASK-011: Screenshot capture integration
- **Status**: done
- **Dependencies**: TASK-010
- **Description**: Instruct Claude instances to capture screenshots via Playwright MCP for each finding. Screenshots are named using the finding's instance-scoped ID (e.g., `I1-UXR-001.png`) and stored in the instance's `screenshots/` directory. Support multiple screenshots per finding (e.g., `I1-UXR-001-a.png`). See requirements.md "Screenshots" section.
- **Verification**: After a mock instance run, confirm screenshots exist in the instance's screenshots directory with correct naming conventions. Confirm multiple screenshots per finding are handled.

### TASK-012: Multi-round execution logic
- **Status**: done
- **Dependencies**: TASK-008, TASK-009, TASK-010
- **Description**: Implement the sequential round execution per instance. Round 1 uses the assigned plan chunk and the evaluation scope. Round 2+ uses the plan chunk, the evaluation scope, AND the accumulated discovery doc from previous rounds. The Claude prompt for subsequent rounds should instruct Claude to review the discovery doc and focus on gaps. The scope is always included in every round's prompt. See requirements.md "Round execution" under Architecture.
- **Verification**: Run a mock 2-round execution. Confirm round 1 prompt includes the plan chunk and scope. Confirm round 2 prompt includes the plan chunk, scope, and the discovery doc from round 1. Confirm the checkpoint correctly advances the round number.

### TASK-013: Failure detection, retry, and resume
- **Status**: done
- **Dependencies**: TASK-008, TASK-012
- **Description**: Implement failure detection for Claude Code subprocesses (crash, timeout, error output). On failure, read the instance's checkpoint file and retry the instance with a resume prompt that continues from the last checkpoint state. Handle the case where the checkpoint file itself is missing or corrupted (restart the round from scratch). Enforce a maximum retry count per instance (default: 3). If the retry limit is exceeded, mark the instance as permanently failed and continue with remaining instances. See requirements.md "Failure handling" under Architecture.
- **Verification**: Simulate an instance crash at a known checkpoint. Confirm the orchestrator detects the failure, reads the checkpoint, and retries with a resume prompt. Confirm the retried instance resumes from the correct point. Simulate a corrupted checkpoint and confirm the round restarts cleanly. Simulate exceeding the retry limit and confirm the instance is marked as permanently failed.

### TASK-014: CLI progress display — progress bars
- **Status**: done
- **Dependencies**: TASK-007, TASK-008
- **Description**: Implement the real-time CLI progress display with one progress bar per instance. Each bar shows: instance ID, current round, visual bar, percentage, stats (items checked, findings, duration), and estimated time remaining. Read checkpoint and discovery files to determine progress. See requirements.md "CLI Progress Display" section.
- **Verification**: Run with 2 mock instances. Confirm each has its own progress bar that updates. Confirm the percentage advances as checkpoint areas are marked complete. Confirm stats and ETA are displayed.

### TASK-015: Progress bar scale recalibration
- **Status**: done
- **Dependencies**: TASK-014, TASK-012
- **Description**: In round 1, the progress scale is based on plan items assigned to the instance. In round 2+, recalibrate the progress scale to use the more granular discovery doc (which has more detailed area/element breakdowns). See requirements.md "Progress Scale" section.
- **Verification**: Confirm round 1 progress is based on plan items. Start round 2 and confirm the progress bar recalibrates to use the discovery doc's more detailed item list. Confirm the bar doesn't jump or regress unexpectedly during recalibration.

### TASK-016: Progress bar color states
- **Status**: done
- **Dependencies**: TASK-014, TASK-013
- **Description**: Implement color states for progress bars: white while running, red on failure (with error description shown), white again on successful retry, green when all rounds for that instance are complete. If an instance exceeds the retry limit, the bar stays red permanently with a final error message. See requirements.md "Color States" section.
- **Verification**: Simulate a running instance (white), then a failure (red with error message), then a successful retry (back to white), then completion (green). Simulate exceeding retry limit and confirm bar stays red. Confirm each state renders correctly.

### TASK-017: Consolidation phase progress indicator
- **Status**: done
- **Dependencies**: TASK-014
- **Description**: Implement a progress indicator for the consolidation phase that appears after all instances complete (or permanently fail). Show a spinner or status line (e.g., "Consolidating reports...") while consolidation is running. On completion, display the paths to the final report and discovery doc. See requirements.md "Completion" section.
- **Verification**: Simulate all instances completing. Confirm the consolidation indicator appears. Confirm it shows the output file paths on completion.

### TASK-018: Report consolidation — merging and deduplication
- **Status**: done
- **Dependencies**: TASK-005, TASK-010
- **Description**: Implement the report consolidation step using the shared Claude CLI utility (TASK-005) for the deduplication Claude call. Merge all per-instance reports into a single report. Use Claude to detect duplicate findings across instances (same issue spotted independently) and merge them. Err on the side of keeping findings separate rather than over-merging. See requirements.md "Final Consolidated Report" section.
- **Verification**: Provide reports from 3 instances where 2 instances found the same issue. Confirm the duplicate is merged into one finding. Confirm similar-but-distinct findings are kept separate.

### TASK-019: Report consolidation — ID reassignment and screenshot remapping
- **Status**: pending
- **Dependencies**: TASK-018, TASK-011
- **Description**: After deduplication, assign clean sequential IDs (`UXR-001`, `UXR-002`, ...) to all findings in the consolidated report. Copy screenshots from instance working directories to the output directory, renaming them to match the new IDs. Update all screenshot references in the report. See requirements.md "Final Consolidated Report" and "Screenshots" sections.
- **Verification**: Confirm all findings in the final report have sequential `UXR-` IDs with no gaps. Confirm screenshots in the output directory are renamed correctly. Confirm report references match the new file names.

### TASK-020: Report consolidation — hierarchical grouping
- **Status**: pending
- **Dependencies**: TASK-018
- **Description**: Group findings in the final report by logical UI area. Within each area, structure findings as a hierarchy — dependent changes indented under parent findings. Top-level items must be independent and parallelizable. See requirements.md "Final Consolidated Report" example structure.
- **Verification**: Confirm findings are grouped by UI area. Confirm dependent findings are indented under their parent. Confirm all top-level findings are independent of each other.

### TASK-021: Discovery document consolidation
- **Status**: pending
- **Dependencies**: TASK-005, TASK-009
- **Description**: Merge all per-instance discovery docs into a single consolidated discovery doc using the shared Claude CLI utility (TASK-005) for the merging Claude call. Deduplicate overlapping areas explored by multiple instances. Structure as an indented hierarchy of UI areas and specific UI features/elements. Format it so it can be reused as a review plan for a future run. Write to the output directory. See requirements.md "Consolidated Discovery Doc" section.
- **Verification**: Provide discovery docs from 3 instances with overlapping areas. Confirm the consolidated doc is deduplicated, hierarchically structured, and readable as a review plan.

### TASK-022: Parallel instance orchestration
- **Status**: pending
- **Dependencies**: TASK-007, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021
- **Description**: Wire together the full orchestration flow for parallel execution: spawn all instances, monitor all progress bars simultaneously, handle failures and retries across instances (respecting max retry limits), wait for all to complete or permanently fail, show the consolidation progress indicator, trigger consolidation (report merging, deduplication, ID reassignment, hierarchical grouping, discovery doc consolidation), and output final file paths. Handle the case where some instances finish earlier than others. See requirements.md "Orchestration Flow" section.
- **Verification**: Run with 3 instances and 2 rounds. Confirm all 3 run in parallel with independent progress bars. Confirm one finishing early doesn't affect others. Confirm consolidation only triggers after all are complete. Confirm consolidation indicator is shown. Confirm final output paths are displayed.

### TASK-023: Rate limit and backoff handling
- **Status**: pending
- **Dependencies**: TASK-022
- **Description**: Handle API rate limiting when multiple Claude Code instances run simultaneously. Detect rate limit errors from Claude Code subprocess output and implement graceful backoff — pause and retry rather than fail. See requirements.md "Constraints and Edge Cases" section.
- **Verification**: Simulate rate limit errors from 2 concurrent instances. Confirm the orchestrator backs off and retries without crashing. Confirm progress bars reflect the pause.

### TASK-024: Integration tests — happy path single instance
- **Status**: pending
- **Dependencies**: TASK-002, TASK-007, TASK-009, TASK-010, TASK-018
- **Description**: Write integration tests for the happy path: single instance, single round. Mock the Claude Code CLI to return expected responses for work distribution, discovery, and report writing. Verify the full flow from CLI args to final consolidated report. Include testing with default scope and custom scope. See requirements.md "Testing Strategy" section.
- **Verification**: `npx vitest run` passes. The test covers: arg parsing (including scope), plan splitting (skipped with 1 instance), instance execution, discovery doc, report writing, and consolidation.

### TASK-025: Integration tests — multi-instance multi-round
- **Status**: pending
- **Dependencies**: TASK-024, TASK-022
- **Description**: Write integration tests for multiple instances with multiple rounds. Mock Claude Code CLI responses for each instance across rounds. Verify work distribution, parallel execution, round progression with discovery doc feedback, and final consolidation. See requirements.md "Testing Strategy" section.
- **Verification**: `npx vitest run` passes. The test covers: plan splitting across instances, parallel mock execution, round 2 receiving discovery doc from round 1, and correct consolidation.

### TASK-026: Integration tests — failure, retry, and resume
- **Status**: pending
- **Dependencies**: TASK-024, TASK-013
- **Description**: Write integration tests for failure scenarios. Mock an instance crash at various points, verify checkpoint-based resume, verify corrupted/missing checkpoint fallback (restart round), verify max retry limit exceeded. Verify progress bar color changes during failure, retry, and permanent failure. See requirements.md "Testing Strategy" section.
- **Verification**: `npx vitest run` passes. Tests cover: mid-area crash with checkpoint resume, missing checkpoint restart, corrupted checkpoint restart, max retry exceeded, and progress display during failure/retry/permanent failure.

### TASK-027: Integration tests — deduplication and consolidation
- **Status**: pending
- **Dependencies**: TASK-024, TASK-018, TASK-019, TASK-020, TASK-021
- **Description**: Write integration tests for the consolidation step. Provide mock reports from multiple instances with overlapping findings. Verify duplicate detection, merging, ID reassignment, screenshot remapping, hierarchical grouping, and discovery doc consolidation. See requirements.md "Testing Strategy" section.
- **Verification**: `npx vitest run` passes. Tests cover: duplicate merged, similar-but-distinct kept separate, IDs are sequential, screenshots renamed, hierarchy is correct, discovery doc is deduplicated and reusable.

### TASK-028: Integration tests — edge cases and input handling
- **Status**: pending
- **Dependencies**: TASK-024
- **Description**: Write integration tests for edge cases: inline text vs file paths for intro/plan/scope, default scope when --scope omitted, --show-default-scope output, single-area plan, single instance skips work distribution, all instances fail, missing optional params use defaults, invalid URL, invalid instance/round counts. See requirements.md "Testing Strategy" section.
- **Verification**: `npx vitest run` passes. All edge cases have test coverage.

### TASK-029: E2E test web app fixture
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: Build a simple static HTML test web app to be used as the e2e test fixture. The app should have 3-4 distinct UI areas (e.g., a navigation/header, a dashboard page, a form/settings page, a listing page) with intentional UX issues spread across them: inconsistent button styling, missing form validation feedback, broken navigation flow (dead-end page), poor contrast text, inconsistent terminology ("Save" vs "Submit" vs "Confirm"), missing loading/empty states, and misaligned elements. Serve it locally via a lightweight HTTP server (e.g., `http-server` or a simple Node `http` server) during test runs. See requirements.md "End-to-End Test" section.
- **Verification**: Start the local server and confirm the test app loads in a browser. Visually confirm the intentional UX issues are present. Confirm at least 3-4 distinct UI areas exist.

### TASK-030: E2E test — full tool run with real Claude instances
- **Status**: pending
- **Dependencies**: TASK-022, TASK-029
- **Description**: Write an e2e test that runs the full tool against the test web app fixture (TASK-029) with real Claude instances (no mocks). Run with 2-3 Claude instances, each assigned a subset of the test app areas, with 1 round each. Verify: the tool completes without crashing, the final report contains findings with unique `UXR-` IDs and screenshot references, screenshots exist in the output directory, the consolidated discovery doc is present and hierarchically structured, and findings are grouped by UI area. This test should be tagged/configured to run separately from the fast integration tests (e.g., separate Vitest config or `--e2e` flag). See requirements.md "End-to-End Test" section.
- **Verification**: Run the e2e test with real Claude API access. The tool completes successfully. The final report contains multiple findings with `UXR-` IDs. Screenshots exist in the output. Discovery doc is present. No crashes or unhandled errors.

### TASK-031: Code coverage enforcement
- **Status**: pending
- **Dependencies**: TASK-024, TASK-025, TASK-026, TASK-027, TASK-028
- **Description**: Verify that all integration tests together meet the coverage threshold. Review coverage report and add any missing tests to reach 90% coverage (80% hard minimum enforced by Vitest config from TASK-001). Fill gaps identified in the coverage report. Note: the e2e test (TASK-030) is excluded from coverage metrics as it runs separately with real Claude instances.
- **Verification**: `npx vitest run --coverage` reports at least 90% coverage across all metrics (statements, branches, functions, lines). Build does not fail on coverage check.

### TASK-032: README documentation
- **Status**: pending
- **Dependencies**: TASK-002, TASK-003, TASK-022
- **Description**: Write the project README with: brief description, prerequisites (Node.js, Claude Code CLI, Playwright MCP), npm installation instructions (global and local), CLI usage with all parameters documented (including --scope and --show-default-scope), usage examples (basic single-instance, multi-instance with files, custom output with multiple rounds, exporting and customizing the default scope), explanation of output files, how to customize evaluation scope, how to reuse the discovery doc as a plan, and how to run the e2e test separately. See requirements.md "README" section.
- **Verification**: README is clear, examples are copy-pasteable, all CLI parameters are documented, scope customization workflow is explained, discovery doc reuse workflow is explained, and e2e test instructions are included.
