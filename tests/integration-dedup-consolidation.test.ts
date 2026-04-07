import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// --- Test-isolated directory structure ---
const TEST_BASE = resolve('.uxreview-integ-dedup-test');
const TEMP_DIR = join(TEST_BASE, '.uxreview-temp');
const OUTPUT_DIR = join(TEST_BASE, 'output');

function testInstanceDir(n: number) {
  return join(TEMP_DIR, `instance-${n}`);
}

function testInstancePaths(n: number) {
  const dir = testInstanceDir(n);
  return {
    dir,
    discovery: join(dir, 'discovery.md'),
    checkpoint: join(dir, 'checkpoint.json'),
    report: join(dir, 'report.md'),
    screenshots: join(dir, 'screenshots'),
  };
}

// --- Mocks ---

vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

vi.mock('../src/file-manager.js', () => ({
  getTempDir: () => TEMP_DIR,
  getInstanceDir: (n: number) => testInstanceDir(n),
  getInstancePaths: (n: number) => testInstancePaths(n),
  getWorkDistributionPath: () => join(TEMP_DIR, 'work-distribution.md'),
  initWorkspace: vi.fn(),
  initTempDir: vi.fn(),
  initOutputDir: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

const mockProgressDisplay = {
  start: vi.fn(),
  stop: vi.fn(),
  markRunning: vi.fn(),
  markCompleted: vi.fn(),
  markFailed: vi.fn(),
  markRetrying: vi.fn(),
  markPermanentlyFailed: vi.fn(),
  markRoundComplete: vi.fn(),
  markRateLimited: vi.fn(),
  startConsolidation: vi.fn(),
  completeConsolidation: vi.fn(),
  renderToTerminal: vi.fn(),
  updateAllFromFiles: vi.fn(),
};

vi.mock('../src/progress-display.js', () => ({
  ProgressDisplay: vi.fn().mockImplementation(() => mockProgressDisplay),
}));

// --- Imports (after mocks are declared) ---
import { runClaude } from '../src/claude-cli.js';
import { initWorkspace } from '../src/file-manager.js';
import { orchestrate } from '../src/orchestrator.js';
import { ParsedArgs } from '../src/cli.js';
import { DEFAULT_SCOPE } from '../src/default-scope.js';
import {
  collectFindings,
  applyDeduplication,
  mergeDuplicateGroup,
  reassignIds,
  copyScreenshots,
  buildFinalId,
  parseScreenshotRefs,
  buildNewScreenshotFilenames,
  groupFindingsByArea,
  buildHierarchy,
  formatConsolidatedReport,
  consolidateReports,
  reassignAndRemapScreenshots,
  organizeHierarchically,
  consolidateDiscoveryDocs,
  writeConsolidatedDiscovery,
  parseDeduplicationResponse,
  parseHierarchyResponse,
} from '../src/consolidation.js';
import { Finding, InstanceReport } from '../src/report.js';

const mockRunClaude = vi.mocked(runClaude);
const mockInitWorkspace = vi.mocked(initWorkspace);

// --- Mock data ---

const PLAN = `## Navigation
- Review main nav bar
- Check hover states
- Test breadcrumbs

## Dashboard
- Check card grid layout
- Verify empty states

## Settings
- Test form validation
- Check save/cancel flows`;

const INTRO = 'Test app for UX review. Login at https://example.com with admin/admin.';

const WORK_DISTRIBUTION_RESPONSE = `## Navigation
- Review main nav bar
- Check hover states
- Test breadcrumbs
---CHUNK---
## Dashboard
- Check card grid layout
- Verify empty states
---CHUNK---
## Settings
- Test form validation
- Check save/cancel flows`;

// ---- Instance 1 (Navigation) — has hover states finding that will be a 3-way duplicate ----

const MOCK_DISCOVERY_I1 = `# Discovery Document - Instance 1

## Round 1

### Navigation Bar
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home → Navigation Bar
- **Elements Observed**:
  - Main menu items
  - Hover states
  - Breadcrumb links
- **Checked**:
  - Layout consistency
  - Navigation flow
  - Interactive element consistency
`;

const MOCK_REPORT_I1 = `# UX Report - Instance 1

## I1-UXR-001: Inconsistent hover states on nav items

- **UI Area**: Navigation
- **Severity**: major
- **Description**: Primary and secondary nav items use different hover effects
- **Suggestion**: Standardize hover styles across all nav items
- **Screenshot**: I1-UXR-001.png

## I1-UXR-002: Breadcrumb trail missing on sub-pages

- **UI Area**: Navigation
- **Severity**: minor
- **Description**: Sub-pages deeper than level 2 have no breadcrumb trail
- **Suggestion**: Add breadcrumb navigation to all sub-pages
- **Screenshot**: I1-UXR-002.png

## I1-UXR-003: Card grid spacing issues spotted from nav

- **UI Area**: Dashboard
- **Severity**: minor
- **Description**: Dashboard card grid has uneven gaps between cards
- **Suggestion**: Use CSS grid with consistent gap values
- **Screenshot**: I1-UXR-003.png
`;

// ---- Instance 2 (Dashboard) — has similar-but-distinct card finding AND hover duplicate ----

const MOCK_DISCOVERY_I2 = `# Discovery Document - Instance 2

## Round 1

### Card Grid
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home → Dashboard
- **Elements Observed**:
  - Dashboard cards
  - Grid layout
  - Empty state message
- **Checked**:
  - Layout consistency
  - Spacing
  - Responsiveness

### Navigation Bar
- **Visited**: 2026-04-02T10:05:00.000Z
- **Navigation Path**: Dashboard → Navigation Bar
- **Elements Observed**:
  - Main menu items
  - Hover effects
- **Checked**:
  - Interactive element consistency
`;

const MOCK_REPORT_I2 = `# UX Report - Instance 2

## I2-UXR-001: Card layout breaks at medium breakpoints

- **UI Area**: Dashboard
- **Severity**: major
- **Description**: At medium breakpoints the card grid collapses incorrectly leaving some cards overlapping and others floating with broken alignment
- **Suggestion**: Fix the CSS grid breakpoint to handle medium viewports gracefully
- **Screenshot**: I2-UXR-001.png

## I2-UXR-002: Navigation hover effects inconsistent across sections

- **UI Area**: Navigation
- **Severity**: critical
- **Description**: While navigating the app noticed that primary and secondary navigation items have inconsistent hover effects applied differently across sections making the experience feel disjointed and unpredictable for users
- **Suggestion**: Standardize hover styles across all navigation items using a shared component
- **Screenshot**: I2-UXR-002.png

## I2-UXR-003: Generic empty state message on dashboard

- **UI Area**: Dashboard
- **Severity**: minor
- **Description**: When no widgets are configured the empty state just says No data
- **Suggestion**: Provide actionable empty state with a link to add widgets
- **Screenshot**: I2-UXR-003.png
`;

// ---- Instance 3 (Settings) — has another hover duplicate ----

const MOCK_DISCOVERY_I3 = `# Discovery Document - Instance 3

## Round 1

### Form Fields
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home → Settings
- **Elements Observed**:
  - Input fields
  - Save button
  - Cancel button
- **Checked**:
  - Form usability
  - Validation feedback

### Navigation Bar
- **Visited**: 2026-04-02T10:05:00.000Z
- **Navigation Path**: Settings → Navigation Bar
- **Elements Observed**:
  - Main menu items
  - Hover states
- **Checked**:
  - Interactive element consistency
`;

const MOCK_REPORT_I3 = `# UX Report - Instance 3

## I3-UXR-001: Missing form validation feedback on settings page

- **UI Area**: Settings
- **Severity**: major
- **Description**: No inline validation feedback when entering invalid data in settings forms
- **Suggestion**: Add real-time inline validation with descriptive error messages
- **Screenshot**: I3-UXR-001.png

## I3-UXR-002: Inconsistent hover states in main navigation

- **UI Area**: Navigation
- **Severity**: major
- **Description**: The main navigation has hover effects that differ between primary and secondary items
- **Suggestion**: Use consistent hover styling for all navigation items
- **Screenshot**: I3-UXR-002.png

## I3-UXR-003: Save button uses different styling than other CTAs

- **UI Area**: Settings
- **Severity**: minor
- **Description**: The save button in settings uses a different color and size than other primary action buttons
- **Suggestion**: Use the shared button component with consistent styling
- **Screenshot**: I3-UXR-003.png
`;

// Consolidated discovery output from Claude merging 3 instance docs (overlapping Navigation)
const MOCK_CONSOLIDATED_DISCOVERY = `# Navigation

- Main menu items
  - Checked: Layout consistency, Navigation flow, Interactive element consistency
- Hover states
  - Checked: Interactive element consistency
- Breadcrumb links
  - Checked: Navigation flow

# Dashboard

- Dashboard cards
  - Checked: Layout consistency, Spacing, Responsiveness
- Grid layout
  - Checked: Layout consistency
- Empty state message
  - Checked: Responsiveness

# Settings

- Input fields
  - Checked: Form usability, Validation feedback
- Save button
  - Checked: Form usability
- Cancel button
  - Checked: Form usability`;

// Minimal valid PNG header for dummy screenshots
const DUMMY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- Helpers ---

function createTestDirs() {
  mkdirSync(TEMP_DIR, { recursive: true });
  for (let i = 1; i <= 3; i++) {
    const paths = testInstancePaths(i);
    mkdirSync(paths.dir, { recursive: true });
    mkdirSync(paths.screenshots, { recursive: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'screenshots'), { recursive: true });
}

function cleanTestDirs() {
  if (existsSync(TEST_BASE)) {
    rmSync(TEST_BASE, { recursive: true, force: true });
  }
}

function makeArgs(overrides?: Partial<ParsedArgs>): ParsedArgs {
  return {
    url: 'https://example.com/app',
    intro: INTRO,
    plan: PLAN,
    scope: DEFAULT_SCOPE,
    instances: 3,
    rounds: 1,
    output: OUTPUT_DIR,
    keepTemp: false,
    ...overrides,
  };
}

/**
 * Write mock instance files directly (reports, discovery docs, screenshots)
 * to simulate completed instances without running the full analysis pipeline.
 */
function writeInstanceFiles() {
  // Instance 1
  const p1 = testInstancePaths(1);
  writeFileSync(p1.discovery, MOCK_DISCOVERY_I1, 'utf-8');
  writeFileSync(p1.report, MOCK_REPORT_I1, 'utf-8');
  writeFileSync(join(p1.screenshots, 'I1-UXR-001.png'), DUMMY_PNG);
  writeFileSync(join(p1.screenshots, 'I1-UXR-002.png'), DUMMY_PNG);
  writeFileSync(join(p1.screenshots, 'I1-UXR-003.png'), DUMMY_PNG);

  // Instance 2
  const p2 = testInstancePaths(2);
  writeFileSync(p2.discovery, MOCK_DISCOVERY_I2, 'utf-8');
  writeFileSync(p2.report, MOCK_REPORT_I2, 'utf-8');
  writeFileSync(join(p2.screenshots, 'I2-UXR-001.png'), DUMMY_PNG);
  writeFileSync(join(p2.screenshots, 'I2-UXR-002.png'), DUMMY_PNG);
  writeFileSync(join(p2.screenshots, 'I2-UXR-003.png'), DUMMY_PNG);

  // Instance 3
  const p3 = testInstancePaths(3);
  writeFileSync(p3.discovery, MOCK_DISCOVERY_I3, 'utf-8');
  writeFileSync(p3.report, MOCK_REPORT_I3, 'utf-8');
  writeFileSync(join(p3.screenshots, 'I3-UXR-001.png'), DUMMY_PNG);
  writeFileSync(join(p3.screenshots, 'I3-UXR-002.png'), DUMMY_PNG);
  writeFileSync(join(p3.screenshots, 'I3-UXR-003.png'), DUMMY_PNG);
}

/**
 * Set up the runClaude mock for full pipeline tests.
 *
 * Handles:
 * 1. Work distribution — splits plan into 3 chunks
 * 2. Instance analysis — writes mock files as side effects
 * 3. Deduplication — 3-way duplicate: I1-UXR-001 + I2-UXR-002 + I3-UXR-002
 *    (similar-but-distinct I1-UXR-003 and I2-UXR-001 are NOT flagged)
 * 4. Hierarchy determination per UI area
 * 5. Discovery doc consolidation
 */
function setupRunClaudeMock() {
  mockRunClaude.mockImplementation(async (options) => {
    const prompt = options.prompt;

    // 1. Work distribution
    if (prompt.includes('work distribution assistant')) {
      return {
        stdout: WORK_DISTRIBUTION_RESPONSE,
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // 2. Instance analysis — write mock files based on instance number
    if (prompt.includes('You are a UX analyst')) {
      let instanceNum = 0;
      if (prompt.includes('I1-UXR-')) instanceNum = 1;
      else if (prompt.includes('I2-UXR-')) instanceNum = 2;
      else if (prompt.includes('I3-UXR-')) instanceNum = 3;

      const paths = testInstancePaths(instanceNum);

      if (instanceNum === 1) {
        writeFileSync(paths.discovery, MOCK_DISCOVERY_I1, 'utf-8');
        writeFileSync(paths.report, MOCK_REPORT_I1, 'utf-8');
        writeFileSync(join(paths.screenshots, 'I1-UXR-001.png'), DUMMY_PNG);
        writeFileSync(join(paths.screenshots, 'I1-UXR-002.png'), DUMMY_PNG);
        writeFileSync(join(paths.screenshots, 'I1-UXR-003.png'), DUMMY_PNG);
      } else if (instanceNum === 2) {
        writeFileSync(paths.discovery, MOCK_DISCOVERY_I2, 'utf-8');
        writeFileSync(paths.report, MOCK_REPORT_I2, 'utf-8');
        writeFileSync(join(paths.screenshots, 'I2-UXR-001.png'), DUMMY_PNG);
        writeFileSync(join(paths.screenshots, 'I2-UXR-002.png'), DUMMY_PNG);
        writeFileSync(join(paths.screenshots, 'I2-UXR-003.png'), DUMMY_PNG);
      } else if (instanceNum === 3) {
        writeFileSync(paths.discovery, MOCK_DISCOVERY_I3, 'utf-8');
        writeFileSync(paths.report, MOCK_REPORT_I3, 'utf-8');
        writeFileSync(join(paths.screenshots, 'I3-UXR-001.png'), DUMMY_PNG);
        writeFileSync(join(paths.screenshots, 'I3-UXR-002.png'), DUMMY_PNG);
        writeFileSync(join(paths.screenshots, 'I3-UXR-003.png'), DUMMY_PNG);
      }

      return { stdout: 'Analysis complete', stderr: '', exitCode: 0, success: true };
    }

    // 3. Deduplication — 3-way merge for hover states findings
    // I1-UXR-003 (card spacing) and I2-UXR-001 (card breakpoints) are NOT duplicates
    if (prompt.includes('deduplication assistant')) {
      return {
        stdout: 'DUPLICATE_GROUP: I1-UXR-001, I2-UXR-002, I3-UXR-002',
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // 4. Hierarchy determination (per UI area, after ID reassignment)
    // After dedup and reassignment the 7 findings are:
    //   UXR-001: Merged hover (Navigation, critical)
    //   UXR-002: Breadcrumbs (Navigation, minor)
    //   UXR-003: Card spacing (Dashboard, minor)
    //   UXR-004: Card breakpoints (Dashboard, major)
    //   UXR-005: Empty state (Dashboard, minor)
    //   UXR-006: Form validation (Settings, major)
    //   UXR-007: Save button (Settings, minor)
    if (prompt.includes('UX report organizer')) {
      // Navigation: UXR-002 child of UXR-001
      if (prompt.includes('UXR-001') && prompt.includes('UXR-002') && !prompt.includes('UXR-003')) {
        return {
          stdout: 'CHILD_OF: UXR-002, UXR-001',
          stderr: '',
          exitCode: 0,
          success: true,
        };
      }
      // Dashboard: UXR-003 child of UXR-004, UXR-005 independent
      if (prompt.includes('UXR-003') && prompt.includes('UXR-004') && prompt.includes('UXR-005')) {
        return {
          stdout: 'CHILD_OF: UXR-003, UXR-004',
          stderr: '',
          exitCode: 0,
          success: true,
        };
      }
      // Settings: UXR-007 child of UXR-006
      if (prompt.includes('UXR-006') && prompt.includes('UXR-007')) {
        return {
          stdout: 'CHILD_OF: UXR-007, UXR-006',
          stderr: '',
          exitCode: 0,
          success: true,
        };
      }
      return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
    }

    // 5. Discovery consolidation
    if (prompt.includes('document consolidation assistant')) {
      return {
        stdout: MOCK_CONSOLIDATED_DISCOVERY,
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    return { stdout: '', stderr: 'Unexpected runClaude call', exitCode: 1, success: false };
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('Integration: Deduplication and consolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTestDirs();
    mockInitWorkspace.mockReturnValue({
      tempDir: TEMP_DIR,
      instanceDirs: [testInstanceDir(1), testInstanceDir(2), testInstanceDir(3)],
      outputDir: OUTPUT_DIR,
    });
    setupRunClaudeMock();
  });

  afterEach(() => {
    cleanTestDirs();
  });

  // ---------------------------------------------------------------------------
  // 3-way duplicate merge through full pipeline
  // ---------------------------------------------------------------------------

  describe('3-way duplicate merge', () => {
    it('merges 3 findings from different instances into one via full pipeline', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportPath = join(OUTPUT_DIR, 'report.md');
      const reportContent = readFileSync(reportPath, 'utf-8');

      // 9 original findings - 2 removed by 3-way merge = 7 unique findings
      expect(reportContent).toContain('UXR-001');
      expect(reportContent).toContain('UXR-007');
      expect(reportContent).not.toContain('UXR-008');
    });

    it('merged finding uses the longest description (I2-UXR-002)', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // I2-UXR-002 had the longest description with "disjointed and unpredictable"
      expect(reportContent).toContain('disjointed and unpredictable');
      // I1-UXR-001's shorter description should not be the primary
      expect(reportContent).not.toMatch(/### UXR-001:.*\n.*\n.*Primary and secondary nav items use different hover effects/);
    });

    it('merged finding uses the highest severity (critical from I2-UXR-002)', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // UXR-001 is the merged hover states finding — should be critical
      // Find the UXR-001 section and check its severity
      const uxr001Section = reportContent.slice(
        reportContent.indexOf('### UXR-001:'),
        reportContent.indexOf('UXR-002'),
      );
      expect(uxr001Section).toContain('**Severity**: critical');
    });

    it('merged finding combines screenshots from all 3 instances', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const screenshotDir = join(OUTPUT_DIR, 'screenshots');

      // UXR-001 has 3 screenshots from the 3-way merge
      expect(existsSync(join(screenshotDir, 'UXR-001.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-001-a.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-001-b.png'))).toBe(true);
    });

    it('report references all 3 merged screenshots for UXR-001', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      expect(reportContent).toContain('UXR-001.png');
      expect(reportContent).toContain('UXR-001-a.png');
      expect(reportContent).toContain('UXR-001-b.png');
    });
  });

  // ---------------------------------------------------------------------------
  // Similar-but-distinct findings kept separate
  // ---------------------------------------------------------------------------

  describe('similar-but-distinct findings kept separate', () => {
    it('card spacing (I1-UXR-003) and card breakpoints (I2-UXR-001) are separate findings', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // Both findings should exist as separate entries
      // I1-UXR-003 becomes UXR-003, I2-UXR-001 becomes UXR-004
      expect(reportContent).toContain('uneven gaps between cards');
      expect(reportContent).toContain('collapses incorrectly');
    });

    it('deduplication prompt contains all 9 findings from 3 instances', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const dedupCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('deduplication assistant'),
      );
      expect(dedupCalls).toHaveLength(1);

      const dedupPrompt = dedupCalls[0][0].prompt;
      // All 9 original findings should appear in the dedup prompt
      expect(dedupPrompt).toContain('I1-UXR-001');
      expect(dedupPrompt).toContain('I1-UXR-002');
      expect(dedupPrompt).toContain('I1-UXR-003');
      expect(dedupPrompt).toContain('I2-UXR-001');
      expect(dedupPrompt).toContain('I2-UXR-002');
      expect(dedupPrompt).toContain('I2-UXR-003');
      expect(dedupPrompt).toContain('I3-UXR-001');
      expect(dedupPrompt).toContain('I3-UXR-002');
      expect(dedupPrompt).toContain('I3-UXR-003');
    });
  });

  // ---------------------------------------------------------------------------
  // Sequential ID assignment
  // ---------------------------------------------------------------------------

  describe('sequential ID assignment', () => {
    it('assigns UXR-001 through UXR-007 with no gaps after 3-way merge', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      for (let i = 1; i <= 7; i++) {
        const id = `UXR-${String(i).padStart(3, '0')}`;
        expect(reportContent).toContain(id);
      }

      // Should not have UXR-008 or UXR-009 (only 7 after dedup)
      expect(reportContent).not.toContain('UXR-008');
      expect(reportContent).not.toContain('UXR-009');
    });

    it('no instance-scoped IDs remain in final report', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      expect(reportContent).not.toContain('I1-UXR-');
      expect(reportContent).not.toContain('I2-UXR-');
      expect(reportContent).not.toContain('I3-UXR-');
    });

    it('no instance-scoped screenshot references remain in final report', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      expect(reportContent).not.toMatch(/I\d+-UXR-\d+\.png/);
    });
  });

  // ---------------------------------------------------------------------------
  // Screenshot remapping
  // ---------------------------------------------------------------------------

  describe('screenshot remapping', () => {
    it('all non-merged findings have single screenshots renamed to new IDs', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const screenshotDir = join(OUTPUT_DIR, 'screenshots');

      // UXR-002 through UXR-007 each have one screenshot
      for (let i = 2; i <= 7; i++) {
        const id = `UXR-${String(i).padStart(3, '0')}`;
        expect(existsSync(join(screenshotDir, `${id}.png`))).toBe(true);
      }
    });

    it('no instance-scoped screenshot files exist in output', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const screenshotDir = join(OUTPUT_DIR, 'screenshots');

      // No I1-, I2-, I3- prefixed files
      expect(existsSync(join(screenshotDir, 'I1-UXR-001.png'))).toBe(false);
      expect(existsSync(join(screenshotDir, 'I2-UXR-001.png'))).toBe(false);
      expect(existsSync(join(screenshotDir, 'I3-UXR-001.png'))).toBe(false);
    });

    it('total screenshot count is 9 (7 singles + 2 extras from 3-way merge)', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const screenshotDir = join(OUTPUT_DIR, 'screenshots');

      // UXR-001 has 3 screenshots (3-way merge)
      // UXR-002 through UXR-007 have 1 screenshot each (6 total)
      // Total = 3 + 6 = 9
      let count = 0;
      for (let i = 1; i <= 7; i++) {
        const id = `UXR-${String(i).padStart(3, '0')}`;
        if (existsSync(join(screenshotDir, `${id}.png`))) count++;
        // Check suffixed screenshots
        for (const suffix of ['a', 'b', 'c']) {
          if (existsSync(join(screenshotDir, `${id}-${suffix}.png`))) count++;
        }
      }
      expect(count).toBe(9);
    });
  });

  // ---------------------------------------------------------------------------
  // Hierarchical grouping
  // ---------------------------------------------------------------------------

  describe('hierarchical grouping', () => {
    it('groups findings by UI area', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      expect(reportContent).toContain('## Navigation');
      expect(reportContent).toContain('## Dashboard');
      expect(reportContent).toContain('## Settings');
    });

    it('Navigation: UXR-002 is child of UXR-001', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      expect(reportContent).toMatch(/### UXR-001:/);
      expect(reportContent).toMatch(/#### UXR-002:/);
    });

    it('Dashboard: UXR-003 is child of UXR-004, UXR-005 is independent', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // UXR-004 is parent (###), UXR-003 is child (####)
      expect(reportContent).toMatch(/### UXR-004:/);
      expect(reportContent).toMatch(/#### UXR-003:/);
      // UXR-005 is independent top-level
      expect(reportContent).toMatch(/### UXR-005:/);
    });

    it('Settings: UXR-007 is child of UXR-006', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      expect(reportContent).toMatch(/### UXR-006:/);
      expect(reportContent).toMatch(/#### UXR-007:/);
    });

    it('hierarchy calls are made per UI area', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const hierarchyCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('UX report organizer'),
      );

      // 3 UI areas = 3 hierarchy calls
      expect(hierarchyCalls).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Discovery doc consolidation
  // ---------------------------------------------------------------------------

  describe('discovery doc consolidation', () => {
    it('reads discovery docs from all 3 instances', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const discoveryCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('document consolidation assistant'),
      );
      expect(discoveryCalls).toHaveLength(1);

      const prompt = discoveryCalls[0][0].prompt;
      expect(prompt).toContain('INSTANCE 1 DISCOVERY');
      expect(prompt).toContain('INSTANCE 2 DISCOVERY');
      expect(prompt).toContain('INSTANCE 3 DISCOVERY');
    });

    it('overlapping Navigation areas from all 3 instances are present in consolidation prompt', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const discoveryCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('document consolidation assistant'),
      );
      const prompt = discoveryCalls[0][0].prompt;

      // All 3 instances explored Navigation Bar — all should be in the prompt
      const navOccurrences = (prompt.match(/Navigation Bar/g) || []).length;
      expect(navOccurrences).toBeGreaterThanOrEqual(3);
    });

    it('writes deduplicated consolidated discovery to output', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      expect(existsSync(discoveryPath)).toBe(true);

      const content = readFileSync(discoveryPath, 'utf-8');
      // All areas present
      expect(content).toContain('Navigation');
      expect(content).toContain('Dashboard');
      expect(content).toContain('Settings');
      // Merged elements from multiple instances
      expect(content).toContain('Main menu items');
      expect(content).toContain('Hover states');
      expect(content).toContain('Dashboard cards');
      expect(content).toContain('Input fields');
    });

    it('consolidated discovery is structured hierarchically and reusable as plan', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const content = readFileSync(join(OUTPUT_DIR, 'discovery.md'), 'utf-8');

      // Top-level headings for areas
      expect(content).toMatch(/^# Navigation/m);
      expect(content).toMatch(/^# Dashboard/m);
      expect(content).toMatch(/^# Settings/m);

      // Nested bullet items under each area
      expect(content).toMatch(/^- .+$/m);
      expect(content).toMatch(/^\s+- Checked:/m);
    });
  });

  // ---------------------------------------------------------------------------
  // Direct consolidation function tests (more focused, no orchestrator)
  // ---------------------------------------------------------------------------

  describe('direct consolidation: deduplication logic', () => {
    it('parseDeduplicationResponse handles 3-way duplicate group', () => {
      const response = 'DUPLICATE_GROUP: I1-UXR-001, I2-UXR-002, I3-UXR-002';
      const groups = parseDeduplicationResponse(response);

      expect(groups).toHaveLength(1);
      expect(groups[0].findingIds).toEqual(['I1-UXR-001', 'I2-UXR-002', 'I3-UXR-002']);
    });

    it('parseDeduplicationResponse handles multiple duplicate groups', () => {
      const response = `DUPLICATE_GROUP: I1-UXR-001, I2-UXR-002
DUPLICATE_GROUP: I1-UXR-003, I3-UXR-001`;
      const groups = parseDeduplicationResponse(response);

      expect(groups).toHaveLength(2);
      expect(groups[0].findingIds).toEqual(['I1-UXR-001', 'I2-UXR-002']);
      expect(groups[1].findingIds).toEqual(['I1-UXR-003', 'I3-UXR-001']);
    });

    it('parseDeduplicationResponse returns empty for NO_DUPLICATES', () => {
      const groups = parseDeduplicationResponse('NO_DUPLICATES');
      expect(groups).toHaveLength(0);
    });

    it('mergeDuplicateGroup uses longest description as base', () => {
      const findings: Finding[] = [
        {
          id: 'I1-UXR-001', title: 'Short title', uiArea: 'Nav', severity: 'minor',
          description: 'Short desc', suggestion: 'Fix it', screenshot: 'I1-UXR-001.png',
        },
        {
          id: 'I2-UXR-002', title: 'Detailed title', uiArea: 'Nav', severity: 'major',
          description: 'This is a much longer and more detailed description of the issue',
          suggestion: 'Fix it properly', screenshot: 'I2-UXR-002.png',
        },
      ];

      const merged = mergeDuplicateGroup(findings);
      expect(merged.description).toBe('This is a much longer and more detailed description of the issue');
      expect(merged.title).toBe('Detailed title');
    });

    it('mergeDuplicateGroup uses highest severity', () => {
      const findings: Finding[] = [
        {
          id: 'I1-UXR-001', title: 'A', uiArea: 'Nav', severity: 'minor',
          description: 'desc', suggestion: 'fix', screenshot: 'I1-UXR-001.png',
        },
        {
          id: 'I2-UXR-001', title: 'B', uiArea: 'Nav', severity: 'critical',
          description: 'description', suggestion: 'fix', screenshot: 'I2-UXR-001.png',
        },
        {
          id: 'I3-UXR-001', title: 'C', uiArea: 'Nav', severity: 'major',
          description: 'descriptions', suggestion: 'fix', screenshot: 'I3-UXR-001.png',
        },
      ];

      const merged = mergeDuplicateGroup(findings);
      expect(merged.severity).toBe('critical');
    });

    it('mergeDuplicateGroup combines all screenshot references', () => {
      const findings: Finding[] = [
        {
          id: 'I1-UXR-001', title: 'A', uiArea: 'Nav', severity: 'major',
          description: 'desc', suggestion: 'fix', screenshot: 'I1-UXR-001.png',
        },
        {
          id: 'I2-UXR-002', title: 'B', uiArea: 'Nav', severity: 'major',
          description: 'description', suggestion: 'fix', screenshot: 'I2-UXR-002.png',
        },
        {
          id: 'I3-UXR-003', title: 'C', uiArea: 'Nav', severity: 'major',
          description: 'descriptions', suggestion: 'fix', screenshot: 'I3-UXR-003.png',
        },
      ];

      const merged = mergeDuplicateGroup(findings);
      expect(merged.screenshot).toBe('I1-UXR-001.png, I2-UXR-002.png, I3-UXR-003.png');
    });

    it('applyDeduplication reduces 9 findings to 7 with a 3-way merge', () => {
      const findings: Finding[] = [
        { id: 'I1-UXR-001', title: 'Hover A', uiArea: 'Nav', severity: 'major', description: 'short', suggestion: 'fix', screenshot: 'I1-UXR-001.png' },
        { id: 'I1-UXR-002', title: 'Breadcrumbs', uiArea: 'Nav', severity: 'minor', description: 'breadcrumbs', suggestion: 'fix', screenshot: 'I1-UXR-002.png' },
        { id: 'I1-UXR-003', title: 'Card gaps', uiArea: 'Dashboard', severity: 'minor', description: 'gaps', suggestion: 'fix', screenshot: 'I1-UXR-003.png' },
        { id: 'I2-UXR-001', title: 'Card breakpoints', uiArea: 'Dashboard', severity: 'major', description: 'breakpoints issue', suggestion: 'fix', screenshot: 'I2-UXR-001.png' },
        { id: 'I2-UXR-002', title: 'Hover B', uiArea: 'Nav', severity: 'critical', description: 'longest description of hover effects issue across the application', suggestion: 'fix', screenshot: 'I2-UXR-002.png' },
        { id: 'I2-UXR-003', title: 'Empty state', uiArea: 'Dashboard', severity: 'minor', description: 'empty', suggestion: 'fix', screenshot: 'I2-UXR-003.png' },
        { id: 'I3-UXR-001', title: 'Form validation', uiArea: 'Settings', severity: 'major', description: 'validation', suggestion: 'fix', screenshot: 'I3-UXR-001.png' },
        { id: 'I3-UXR-002', title: 'Hover C', uiArea: 'Nav', severity: 'major', description: 'hover description', suggestion: 'fix', screenshot: 'I3-UXR-002.png' },
        { id: 'I3-UXR-003', title: 'Save button', uiArea: 'Settings', severity: 'minor', description: 'button', suggestion: 'fix', screenshot: 'I3-UXR-003.png' },
      ];

      const groups = [{ findingIds: ['I1-UXR-001', 'I2-UXR-002', 'I3-UXR-002'] }];
      const result = applyDeduplication(findings, groups);

      expect(result).toHaveLength(7);
      // Merged finding is at position 0 (replaces I1-UXR-001's position)
      expect(result[0].severity).toBe('critical');
      expect(result[0].description).toBe('longest description of hover effects issue across the application');
      expect(result[0].screenshot).toContain('I1-UXR-001.png');
      expect(result[0].screenshot).toContain('I2-UXR-002.png');
      expect(result[0].screenshot).toContain('I3-UXR-002.png');

      // Non-duplicate findings preserved in order
      expect(result[1].id).toBe('I1-UXR-002');
      expect(result[2].id).toBe('I1-UXR-003');
      expect(result[3].id).toBe('I2-UXR-001');
      expect(result[4].id).toBe('I2-UXR-003');
      expect(result[5].id).toBe('I3-UXR-001');
      expect(result[6].id).toBe('I3-UXR-003');
    });
  });

  describe('direct consolidation: ID reassignment', () => {
    it('assigns sequential IDs starting from UXR-001', () => {
      const findings: Finding[] = [
        { id: 'I2-UXR-002', title: 'A', uiArea: 'Nav', severity: 'critical', description: 'a', suggestion: 'a', screenshot: 'I1-UXR-001.png, I2-UXR-002.png' },
        { id: 'I1-UXR-002', title: 'B', uiArea: 'Nav', severity: 'minor', description: 'b', suggestion: 'b', screenshot: 'I1-UXR-002.png' },
        { id: 'I1-UXR-003', title: 'C', uiArea: 'Dashboard', severity: 'minor', description: 'c', suggestion: 'c', screenshot: 'I1-UXR-003.png' },
      ];

      const result = reassignIds(findings);

      expect(result.findings[0].id).toBe('UXR-001');
      expect(result.findings[1].id).toBe('UXR-002');
      expect(result.findings[2].id).toBe('UXR-003');
    });

    it('idMapping maps old IDs to new IDs', () => {
      const findings: Finding[] = [
        { id: 'I2-UXR-002', title: 'A', uiArea: 'Nav', severity: 'critical', description: 'a', suggestion: 'a', screenshot: 'I2-UXR-002.png' },
        { id: 'I1-UXR-002', title: 'B', uiArea: 'Nav', severity: 'minor', description: 'b', suggestion: 'b', screenshot: 'I1-UXR-002.png' },
      ];

      const result = reassignIds(findings);

      expect(result.idMapping.get('I2-UXR-002')).toBe('UXR-001');
      expect(result.idMapping.get('I1-UXR-002')).toBe('UXR-002');
    });

    it('generates correct screenshot ops for merged finding with 3 screenshots', () => {
      const findings: Finding[] = [
        {
          id: 'I2-UXR-002', title: 'Merged', uiArea: 'Nav', severity: 'critical',
          description: 'merged', suggestion: 'fix',
          screenshot: 'I1-UXR-001.png, I2-UXR-002.png, I3-UXR-002.png',
        },
      ];

      const result = reassignIds(findings);

      expect(result.screenshotOps).toHaveLength(3);
      expect(result.screenshotOps[0]).toEqual({
        instanceNumber: 1,
        sourceFilename: 'I1-UXR-001.png',
        destFilename: 'UXR-001.png',
      });
      expect(result.screenshotOps[1]).toEqual({
        instanceNumber: 2,
        sourceFilename: 'I2-UXR-002.png',
        destFilename: 'UXR-001-a.png',
      });
      expect(result.screenshotOps[2]).toEqual({
        instanceNumber: 3,
        sourceFilename: 'I3-UXR-002.png',
        destFilename: 'UXR-001-b.png',
      });

      // Finding's screenshot field is updated to new filenames
      expect(result.findings[0].screenshot).toBe('UXR-001.png, UXR-001-a.png, UXR-001-b.png');
    });

    it('buildNewScreenshotFilenames generates correct names for various counts', () => {
      expect(buildNewScreenshotFilenames('UXR-001', 1)).toEqual(['UXR-001.png']);
      expect(buildNewScreenshotFilenames('UXR-001', 2)).toEqual(['UXR-001.png', 'UXR-001-a.png']);
      expect(buildNewScreenshotFilenames('UXR-001', 3)).toEqual(['UXR-001.png', 'UXR-001-a.png', 'UXR-001-b.png']);
      expect(buildNewScreenshotFilenames('UXR-001', 0)).toEqual([]);
    });

    it('parseScreenshotRefs handles comma-separated references', () => {
      expect(parseScreenshotRefs('I1-UXR-001.png, I2-UXR-002.png, I3-UXR-002.png'))
        .toEqual(['I1-UXR-001.png', 'I2-UXR-002.png', 'I3-UXR-002.png']);
      expect(parseScreenshotRefs('I1-UXR-001.png')).toEqual(['I1-UXR-001.png']);
      expect(parseScreenshotRefs('')).toEqual([]);
    });
  });

  describe('direct consolidation: screenshot copy', () => {
    it('copies and renames screenshots from instance dirs to output', () => {
      writeInstanceFiles();

      const ops = [
        { instanceNumber: 1, sourceFilename: 'I1-UXR-001.png', destFilename: 'UXR-001.png' },
        { instanceNumber: 2, sourceFilename: 'I2-UXR-002.png', destFilename: 'UXR-001-a.png' },
        { instanceNumber: 3, sourceFilename: 'I3-UXR-002.png', destFilename: 'UXR-001-b.png' },
        { instanceNumber: 1, sourceFilename: 'I1-UXR-002.png', destFilename: 'UXR-002.png' },
      ];

      copyScreenshots(ops, OUTPUT_DIR);

      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001.png'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001-a.png'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001-b.png'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-002.png'))).toBe(true);
    });

    it('silently skips missing source screenshots', () => {
      writeInstanceFiles();

      const ops = [
        { instanceNumber: 1, sourceFilename: 'I1-UXR-001.png', destFilename: 'UXR-001.png' },
        { instanceNumber: 1, sourceFilename: 'I1-UXR-NONEXISTENT.png', destFilename: 'UXR-099.png' },
      ];

      // Should not throw
      copyScreenshots(ops, OUTPUT_DIR);

      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001.png'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-099.png'))).toBe(false);
    });
  });

  describe('direct consolidation: hierarchical grouping', () => {
    it('groupFindingsByArea groups correctly', () => {
      const findings: Finding[] = [
        { id: 'UXR-001', title: 'A', uiArea: 'Navigation', severity: 'major', description: 'a', suggestion: 'a', screenshot: '' },
        { id: 'UXR-002', title: 'B', uiArea: 'Navigation', severity: 'minor', description: 'b', suggestion: 'b', screenshot: '' },
        { id: 'UXR-003', title: 'C', uiArea: 'Dashboard', severity: 'minor', description: 'c', suggestion: 'c', screenshot: '' },
      ];

      const groups = groupFindingsByArea(findings);
      expect(groups.get('Navigation')).toHaveLength(2);
      expect(groups.get('Dashboard')).toHaveLength(1);
    });

    it('buildHierarchy creates correct parent-child structure', () => {
      const findings: Finding[] = [
        { id: 'UXR-001', title: 'Parent', uiArea: 'Nav', severity: 'major', description: 'p', suggestion: 'p', screenshot: '' },
        { id: 'UXR-002', title: 'Child', uiArea: 'Nav', severity: 'minor', description: 'c', suggestion: 'c', screenshot: '' },
        { id: 'UXR-003', title: 'Independent', uiArea: 'Nav', severity: 'minor', description: 'i', suggestion: 'i', screenshot: '' },
      ];

      const childToParent = new Map([['UXR-002', 'UXR-001']]);
      const hierarchy = buildHierarchy(findings, childToParent);

      expect(hierarchy).toHaveLength(2); // UXR-001 (with child) and UXR-003
      const parent = hierarchy.find((h) => h.finding.id === 'UXR-001')!;
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0].id).toBe('UXR-002');

      const independent = hierarchy.find((h) => h.finding.id === 'UXR-003')!;
      expect(independent.children).toHaveLength(0);
    });

    it('parseHierarchyResponse handles CHILD_OF lines correctly', () => {
      const response = `CHILD_OF: UXR-002, UXR-001
CHILD_OF: UXR-003, UXR-004`;

      const mapping = parseHierarchyResponse(response);
      expect(mapping.get('UXR-002')).toBe('UXR-001');
      expect(mapping.get('UXR-003')).toBe('UXR-004');
    });

    it('parseHierarchyResponse returns empty map for NO_DEPENDENCIES', () => {
      const mapping = parseHierarchyResponse('NO_DEPENDENCIES');
      expect(mapping.size).toBe(0);
    });

    it('formatConsolidatedReport produces correct markdown hierarchy', () => {
      const groups = [
        {
          area: 'Navigation',
          findings: [
            {
              finding: { id: 'UXR-001', title: 'Parent', uiArea: 'Navigation', severity: 'major' as const, description: 'parent desc', suggestion: 'fix parent', screenshot: 'UXR-001.png' },
              children: [
                { id: 'UXR-002', title: 'Child', uiArea: 'Navigation', severity: 'minor' as const, description: 'child desc', suggestion: 'fix child', screenshot: 'UXR-002.png' },
              ],
            },
          ],
        },
      ];

      const report = formatConsolidatedReport(groups);

      expect(report).toContain('## Navigation');
      expect(report).toMatch(/### UXR-001: Parent/);
      expect(report).toMatch(/#### UXR-002: Child/);
      expect(report).toContain('parent desc');
      expect(report).toContain('child desc');
    });
  });

  describe('direct consolidation: discovery doc merging', () => {
    it('consolidateDiscoveryDocs reads from all instances and merges', async () => {
      writeInstanceFiles();

      const result = await consolidateDiscoveryDocs([1, 2, 3]);

      expect(result.instanceCount).toBe(3);
      expect(result.usedClaude).toBe(true);
      expect(result.content).toContain('Navigation');
      expect(result.content).toContain('Dashboard');
      expect(result.content).toContain('Settings');
    });

    it('consolidateDiscoveryDocs skips instances with no discovery file', async () => {
      // Only write for instances 1 and 2, skip 3
      const p1 = testInstancePaths(1);
      const p2 = testInstancePaths(2);
      writeFileSync(p1.discovery, MOCK_DISCOVERY_I1, 'utf-8');
      writeFileSync(p2.discovery, MOCK_DISCOVERY_I2, 'utf-8');
      // Instance 3 has no discovery file

      const result = await consolidateDiscoveryDocs([1, 2, 3]);

      expect(result.instanceCount).toBe(2);
      expect(result.usedClaude).toBe(true);
    });

    it('consolidateDiscoveryDocs returns empty for no discovery files', async () => {
      // No files written — all instances have no discovery doc
      const result = await consolidateDiscoveryDocs([1, 2, 3]);

      expect(result.instanceCount).toBe(0);
      expect(result.usedClaude).toBe(false);
      expect(result.content).toBe('');
    });

    it('writeConsolidatedDiscovery writes to output/discovery.md', () => {
      writeConsolidatedDiscovery(OUTPUT_DIR, MOCK_CONSOLIDATED_DISCOVERY);

      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      expect(existsSync(discoveryPath)).toBe(true);

      const content = readFileSync(discoveryPath, 'utf-8');
      expect(content).toContain('# Navigation');
      expect(content).toContain('# Dashboard');
      expect(content).toContain('# Settings');
    });
  });

  // ---------------------------------------------------------------------------
  // End-to-end consolidation flow (direct function calls, not orchestrator)
  // ---------------------------------------------------------------------------

  describe('end-to-end consolidation flow via direct function calls', () => {
    it('full consolidation pipeline: dedup → reassign → hierarchy → format → discovery', async () => {
      writeInstanceFiles();

      // Step 1: Consolidate reports (reads instance files, calls Claude for dedup)
      const consolidation = await consolidateReports([1, 2, 3]);

      expect(consolidation.usedClaude).toBe(true);
      expect(consolidation.duplicateGroups).toHaveLength(1);
      expect(consolidation.duplicateGroups[0].findingIds).toEqual(['I1-UXR-001', 'I2-UXR-002', 'I3-UXR-002']);
      expect(consolidation.findings).toHaveLength(7);

      // Step 2: Reassign IDs and remap screenshots
      const { findings } = reassignAndRemapScreenshots(consolidation, OUTPUT_DIR);

      expect(findings).toHaveLength(7);
      expect(findings[0].id).toBe('UXR-001');
      expect(findings[6].id).toBe('UXR-007');

      // Verify screenshots were copied
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001.png'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001-a.png'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001-b.png'))).toBe(true);

      // Step 3: Organize hierarchically
      const groups = await organizeHierarchically(findings);

      expect(groups).toHaveLength(3);
      expect(groups.map((g) => g.area)).toEqual(['Navigation', 'Dashboard', 'Settings']);

      // Step 4: Format report
      const reportContent = formatConsolidatedReport(groups);

      expect(reportContent).toContain('## Navigation');
      expect(reportContent).toContain('## Dashboard');
      expect(reportContent).toContain('## Settings');
      expect(reportContent).toMatch(/### UXR-001:/);
      expect(reportContent).toMatch(/#### UXR-002:/);

      // Step 5: Consolidate discovery
      const discoveryResult = await consolidateDiscoveryDocs([1, 2, 3]);

      expect(discoveryResult.instanceCount).toBe(3);
      expect(discoveryResult.content).toContain('Navigation');
      expect(discoveryResult.content).toContain('Dashboard');
      expect(discoveryResult.content).toContain('Settings');
    });
  });
});
