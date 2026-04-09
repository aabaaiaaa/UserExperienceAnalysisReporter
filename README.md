# uxreview

A TypeScript CLI tool that orchestrates multiple Claude Code instances to autonomously explore and review a web application's user experience via Playwright MCP. It produces both a self-contained HTML report and a markdown report of UX findings, each uniquely identified and grouped by UI area in a hierarchical structure suitable for parallel work planning.

The tool runs unattended. You provide a URL, context about the app, and a review plan. The tool handles everything else -- splitting work across instances, managing Claude sessions, tracking progress, retrying failures, and consolidating results. When finished, the HTML report opens automatically in your browser.

## Prerequisites

- **Node.js** >= 16.9.0
- **Claude Code CLI** installed and authenticated (`claude` available on PATH)
- **Playwright MCP** configured in Claude Code (used by Claude to interact with the browser)

## Installation

**Global install** (recommended for CLI use):

```bash
npm install -g uxreview
```

**Local install** (for development or project-scoped use):

```bash
npm install uxreview
```

If installed locally, run via `npx uxreview` instead of `uxreview`.

## Usage

```
uxreview --url <url> --intro <text|filepath> --plan <text|filepath> [options]
uxreview --show-default-scope
```

### Required Parameters

| Parameter | Description |
|-----------|-------------|
| `--url <url>` | URL of the web application to review (must start with `http://` or `https://`) |
| `--intro <text\|filepath>` | Introduction/context about the app. Provide inline text (quoted) or a path to a file. The tool auto-detects which by checking if the value is an existing file path. |
| `--plan <text\|filepath>` | Review plan describing areas to review or skip. Inline text or file path (same auto-detection). |

### Optional Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--scope <text\|filepath>` | Built-in default | UX evaluation criteria defining what Claude should look for. Inline text or file path. If omitted, the built-in default scope is used. |
| `--show-default-scope` | — | Print the built-in default evaluation scope to stdout and exit. No other parameters required. |
| `--instances <n>` | auto | Number of parallel Claude Code instances to run. When omitted, auto-detected from the number of areas in the plan (max 5). |
| `--rounds <n>` | `1` | Number of review rounds per instance. Additional rounds use findings from prior rounds to go deeper. |
| `--output <dir>` | `./uxreview-output` | Output directory for final deliverables. |
| `--keep-temp` | `false` | Preserve the `.uxreview-temp/` working directory after the run. Useful for debugging. By default, the temp directory is deleted on completion. |
| `--max-retries <n>` | `3` | Maximum normal retry attempts per instance when a round fails. |
| `--instance-timeout <min>` | `30` | Timeout per Claude instance in minutes. Increase for complex apps that need longer analysis time. |
| `--rate-limit-retries <n>` | `10` | Maximum rate-limit retry attempts globally across all rounds and retries. Rate-limit retries use exponential backoff. |
| `--append` | `false` | Append new findings to the existing output directory instead of overwriting. New findings are deduplicated against previous results, screenshots are preserved, and the report is regenerated with all findings. |
| `--dry-run` | `false` | Preview work distribution without running analysis instances. Shows instance count, plan chunks, assigned areas, and evaluation scope, then exits. Only the distribution Claude call runs (or none for single-instance). |
| `--verbose` | `false` | Enable debug logging to stderr. Logs subprocess spawn/exit, file operations, retry decisions, and phase timing. |
| `--suppress-open` | `false` | Do not open the HTML report in the browser after completion. By default, the report opens automatically. |
| `--help` | — | Show usage information and exit. |
| `--version` | — | Show the version number and exit. |

## Examples

### Basic single-instance run with inline text

```bash
uxreview \
  --url https://myapp.example.com \
  --intro "A project management app. Login with user@example.com / password123. After login you land on the dashboard." \
  --plan "Review the dashboard page, the project list, and the settings form."
```

### Multi-instance run with file references

```bash
uxreview \
  --url https://myapp.example.com \
  --intro ./docs/app-intro.md \
  --plan ./docs/review-plan.md \
  --instances 3
```

The tool uses Claude to split the review plan into 3 logical chunks, one per instance, then runs them in parallel.

### Custom output directory with multiple rounds

```bash
uxreview \
  --url https://myapp.example.com \
  --intro ./docs/app-intro.md \
  --plan ./docs/review-plan.md \
  --instances 2 \
  --rounds 3 \
  --output ./reports/sprint-12-ux
```

Each instance runs 3 sequential rounds. Round 2+ reviews the discovery doc from prior rounds to identify missed areas and go deeper.

### Exporting and customizing the default scope

```bash
# Export the built-in default scope to a file
uxreview --show-default-scope > my-scope.md

# Edit the file to add, remove, or modify criteria
# e.g., add "## 11. Dark Mode Support" or remove sections you don't care about

# Run with the customized scope
uxreview \
  --url https://myapp.example.com \
  --intro ./docs/app-intro.md \
  --plan ./docs/review-plan.md \
  --scope my-scope.md
```

## Output Files

After a run completes, the output directory contains:

```
uxreview-output/          # or your --output path
  report.html             # Self-contained HTML report (opens automatically)
  report.md               # Markdown version of the report
  discovery.md            # Consolidated discovery document
  screenshots/            # Screenshots as evidence for findings
```

### report.html

A self-contained HTML report with inline CSS, embedded base64 screenshots, severity color coding, collapsible sections per UI area, and a table of contents. Opens automatically in your default browser after the run completes (use `--suppress-open` to disable).

### report.md

The markdown version of the same report. Each finding has:

- A unique sequential ID (`UXR-001`, `UXR-002`, ...)
- UI area, title, description, and suggestion
- Severity assessment
- Screenshot reference(s)

Findings are grouped by UI area and structured hierarchically. Top-level items are independent and can be worked on in parallel. Dependent changes are indented under their parent finding.

```markdown
## Navigation

### UXR-001: Inconsistent hover states on main nav items
...
  #### UXR-002: Mobile hamburger menu animation is janky
  ...

## Dashboard

### UXR-003: Card grid spacing inconsistent at medium breakpoints
...
```

### discovery.md

A hierarchical document of all UI areas, elements, and features explored during the review. Tracks what was visited, what was checked, and navigation paths taken.

### screenshots/

PNG screenshots captured by Claude via Playwright as evidence for each finding. Named by finding ID (e.g., `UXR-001.png`). Findings with multiple screenshots use suffixes (e.g., `UXR-001-a.png`, `UXR-001-b.png`).

> **Note:** Screenshot suffixes use lowercase letters (a-z), supporting a maximum of 26 screenshots per finding.

## Customizing the Evaluation Scope

The evaluation scope controls what Claude looks for when analyzing the app. The built-in default covers 10 areas:

1. Layout Consistency and Spacing
2. Navigation Flow and Discoverability
3. Form Usability and Validation Feedback
4. Error Messaging and Empty States
5. Loading States and Transitions
6. Accessibility Basics
7. Responsiveness and Viewport Behavior
8. Interactive Element Consistency
9. Content Hierarchy and Readability
10. Terminology and Labeling Consistency

To customize:

1. Export the default: `uxreview --show-default-scope > my-scope.md`
2. Edit the file -- add new sections, remove areas you don't care about, or adjust criteria
3. Pass it back: `uxreview --url ... --intro ... --plan ... --scope my-scope.md`

The custom scope completely replaces the default. All instances evaluate against the same scope.

## Reusing the Discovery Doc as a Plan

The consolidated `discovery.md` is formatted so it can be reused as a review plan for a subsequent run. This creates a feedback loop where each run refines and deepens the review:

```bash
# First run — broad review
uxreview \
  --url https://myapp.example.com \
  --intro ./docs/app-intro.md \
  --plan "Review all main pages and flows" \
  --output ./round-1

# Second run — use the discovery doc from round 1 as the plan
uxreview \
  --url https://myapp.example.com \
  --intro ./docs/app-intro.md \
  --plan ./round-1/discovery.md \
  --instances 3 \
  --rounds 2 \
  --output ./round-2
```

The second run benefits from the detailed area/element breakdown discovered in the first run, leading to more targeted and thorough analysis.

## Incremental Output with `--append`

Use `--append` to add findings from a new run to an existing output directory without losing previous results:

```bash
# First run — review navigation and dashboard
uxreview \
  --url https://myapp.example.com \
  --intro ./docs/app-intro.md \
  --plan "Review the navigation bar and dashboard page" \
  --output ./ux-report

# Second run — review settings, appending to the same output
uxreview \
  --url https://myapp.example.com \
  --intro ./docs/app-intro.md \
  --plan "Review the settings page and forms" \
  --output ./ux-report \
  --append
```

When `--append` is used:

- New findings are deduplicated against existing findings to avoid reporting the same issue twice.
- New finding IDs continue sequentially from the highest existing ID (e.g., if the previous run ended at UXR-005, the next run starts at UXR-006).
- Existing screenshots are preserved. New screenshots are added alongside them.
- The discovery document is merged with the existing one.
- The final report is regenerated with all findings (old and new) organized hierarchically.

If `--append` is used but the output directory doesn't exist yet, the tool behaves as a fresh run. If the existing report is corrupt or unparseable, the tool warns and starts fresh.

## Recovery and Resumption

The tool uses a checkpoint system that allows interrupted runs to be resumed. If a run is interrupted (e.g., via Ctrl+C or a crash), you can re-run the same command and the tool will pick up where it left off.

### Interruption during instance execution

Each Claude instance writes a checkpoint file after every completed round. If the tool is interrupted while instances are running:

- Instances that finished all rounds keep their results.
- Instances that were mid-round lose the current round's progress, but retain checkpoints from any previously completed rounds.
- On re-run, the tool reads existing checkpoints and resumes each instance from its last completed round rather than starting over.

The SIGINT/SIGTERM handler ensures child Claude processes are terminated cleanly on interruption.

### Interruption during consolidation

If the tool is interrupted during the consolidation phase (deduplication, hierarchy determination, or discovery merging), consolidation checkpoints preserve progress:

- Completed consolidation steps are saved to a checkpoint file.
- On re-run, consolidation resumes from the last completed step instead of re-running all Claude calls.

### How to resume

Simply re-run the same command:

```bash
uxreview \
  --url https://myapp.example.com \
  --intro ./docs/app-intro.md \
  --plan ./docs/review-plan.md \
  --instances 3
```

The tool detects existing checkpoint data in `.uxreview-temp/` and resumes automatically. No special flags are needed.

### Preserving intermediate state with `--keep-temp`

By default, the `.uxreview-temp/` directory is deleted after a successful run. To preserve it for debugging or manual inspection, pass `--keep-temp`:

```bash
uxreview \
  --url https://myapp.example.com \
  --intro ./docs/app-intro.md \
  --plan ./docs/review-plan.md \
  --keep-temp
```

### Where raw instance data lives

The `.uxreview-temp/` directory contains all intermediate state:

```
.uxreview-temp/
  instance-1/           # Per-instance working directory
    checkpoint.json     # Round progress and resume state
    discovery.md        # Instance-scoped discovery document
    report.md           # Instance-scoped findings report
    screenshots/        # Instance-scoped screenshots
  instance-2/
    ...
  consolidation-checkpoint.json   # Consolidation phase progress
```

Each `instance-*` directory holds the raw data for that instance's analysis. This is useful for debugging individual instance behavior or manually inspecting findings before consolidation.

## Running Tests

```bash
# Run integration tests
npm test

# Run integration tests with coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### E2E Test

The end-to-end test runs the full tool against a local test web app fixture with real Claude Code instances (no mocks). It requires Claude Code CLI to be installed and authenticated.

```bash
npm run test:e2e
```

This test:

- Starts a local HTTP server with a test web app containing intentional UX issues
- Runs the tool with 2 parallel Claude instances
- Verifies the final report contains findings with `UXR-` IDs, screenshots, and hierarchical grouping
- Verifies the discovery doc is present and structured

The e2e test has a 45-minute timeout to allow for real Claude and Playwright interactions. It runs separately from the fast integration tests and is not included in coverage metrics.

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run typecheck

# Build
npm run build

# Run integration tests with coverage
npm run test:coverage
```

## License

MIT
