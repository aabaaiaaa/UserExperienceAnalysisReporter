# uxreview

A TypeScript CLI tool that orchestrates multiple Claude Code instances to autonomously explore and review a web application's user experience via Playwright MCP. It produces a consolidated markdown report of UX findings, each uniquely identified and grouped by UI area in a hierarchical structure suitable for parallel work planning.

The tool runs unattended. You provide a URL, context about the app, and a review plan. The tool handles everything else -- splitting work across instances, managing Claude sessions, tracking progress, retrying failures, and consolidating results.

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
| `--instances <n>` | `1` | Number of parallel Claude Code instances to run. |
| `--rounds <n>` | `1` | Number of review rounds per instance. Additional rounds use findings from prior rounds to go deeper. |
| `--output <dir>` | `./uxreview-output` | Output directory for final deliverables. |
| `--help` | — | Show usage information and exit. |

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
  report.md               # Final consolidated report
  discovery.md            # Consolidated discovery document
  screenshots/            # Screenshots as evidence for findings
```

### report.md

The consolidated UX report with all findings. Each finding has:

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
