import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// --- Test-isolated directory structure ---
const TEST_BASE = resolve('.uxreview-integ-append-test');
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
  updateProgress: vi.fn(),
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

const mockRunClaude = vi.mocked(runClaude);
const mockInitWorkspace = vi.mocked(initWorkspace);

// --- Existing output from a "previous run" ---

const EXISTING_REPORT = `# UX Analysis Report

## Navigation

### UXR-001: Inconsistent hover states on nav items

- **Severity**: major
- **Description**: Primary and secondary nav items use different hover effects
- **Suggestion**: Standardize hover styles across all nav items
- **Screenshot**: UXR-001.png

### UXR-002: Breadcrumb trail missing on sub-pages

- **Severity**: minor
- **Description**: Sub-pages deeper than level 2 have no breadcrumb trail
- **Suggestion**: Add breadcrumb navigation to all sub-pages
- **Screenshot**: UXR-002.png

## Dashboard

### UXR-003: Card grid spacing inconsistent

- **Severity**: minor
- **Description**: Dashboard card grid has uneven gaps between cards
- **Suggestion**: Use CSS grid with consistent gap values
- **Screenshot**: UXR-003.png
`;

const EXISTING_DISCOVERY = `# Navigation

- Main menu items
  - Checked: Layout consistency, Navigation flow
- Hover states
  - Checked: Interactive element consistency

# Dashboard

- Dashboard cards
  - Checked: Layout consistency, Spacing
`;

// Minimal valid PNG header for dummy screenshots
const DUMMY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXISTING_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

// --- New run instance data ---

const MOCK_DISCOVERY_I1 = `# Discovery Document - Instance 1

## Round 1

### Settings
- **Visited**: 2026-04-07T10:00:00.000Z
- **Navigation Path**: Home → Settings
- **Elements Observed**:
  - Input fields
  - Save button
- **Checked**:
  - Form usability
  - Validation feedback
`;

const MOCK_REPORT_I1 = `# UX Report - Instance 1

## I1-UXR-001: Navigation hover effects inconsistent

- **UI Area**: Navigation
- **Severity**: major
- **Description**: Primary and secondary nav items use different hover effects
- **Suggestion**: Standardize hover styles
- **Screenshot**: I1-UXR-001.png

## I1-UXR-002: Missing form validation feedback on settings

- **UI Area**: Settings
- **Severity**: major
- **Description**: No inline validation feedback when entering invalid data
- **Suggestion**: Add real-time inline validation with descriptive error messages
- **Screenshot**: I1-UXR-002.png

## I1-UXR-003: Save button uses inconsistent styling

- **UI Area**: Settings
- **Severity**: minor
- **Description**: The save button uses a different color than other CTAs
- **Suggestion**: Use the shared button component
- **Screenshot**: I1-UXR-003.png
`;

const PLAN = `## Settings
- Test form validation
- Check save/cancel flows`;

const INTRO = 'Test app for UX review.';

// --- Helpers ---

function createTestDirs() {
  mkdirSync(TEMP_DIR, { recursive: true });
  const paths = testInstancePaths(1);
  mkdirSync(paths.dir, { recursive: true });
  mkdirSync(paths.screenshots, { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'screenshots'), { recursive: true });
}

function cleanTestDirs() {
  if (existsSync(TEST_BASE)) {
    rmSync(TEST_BASE, { recursive: true, force: true });
  }
}

function writeExistingOutput() {
  writeFileSync(join(OUTPUT_DIR, 'report.md'), EXISTING_REPORT, 'utf-8');
  writeFileSync(join(OUTPUT_DIR, 'discovery.md'), EXISTING_DISCOVERY, 'utf-8');
  writeFileSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001.png'), EXISTING_PNG);
  writeFileSync(join(OUTPUT_DIR, 'screenshots', 'UXR-002.png'), EXISTING_PNG);
  writeFileSync(join(OUTPUT_DIR, 'screenshots', 'UXR-003.png'), EXISTING_PNG);
}

function writeNewInstanceFiles() {
  const p1 = testInstancePaths(1);
  writeFileSync(p1.discovery, MOCK_DISCOVERY_I1, 'utf-8');
  writeFileSync(p1.report, MOCK_REPORT_I1, 'utf-8');
  writeFileSync(join(p1.screenshots, 'I1-UXR-001.png'), DUMMY_PNG);
  writeFileSync(join(p1.screenshots, 'I1-UXR-002.png'), DUMMY_PNG);
  writeFileSync(join(p1.screenshots, 'I1-UXR-003.png'), DUMMY_PNG);
}

function makeArgs(overrides?: Partial<ParsedArgs>): ParsedArgs {
  return {
    url: 'https://example.com/app',
    intro: INTRO,
    plan: PLAN,
    scope: DEFAULT_SCOPE,
    instances: 1,
    rounds: 1,
    output: OUTPUT_DIR,
    keepTemp: false,
    append: true,
    verbose: false,
    maxRetries: 3,
    instanceTimeout: 30,
    rateLimitRetries: 10,
    ...overrides,
  };
}

function setupRunClaudeMock() {
  mockRunClaude.mockImplementation(async (options) => {
    const prompt = options.prompt;

    // Work distribution (single instance — returns the plan as-is)
    if (prompt.includes('work distribution assistant')) {
      return {
        stdout: PLAN,
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // Instance analysis — write mock files
    if (prompt.includes('You are a UX analyst')) {
      writeNewInstanceFiles();
      return { stdout: 'Analysis complete', stderr: '', exitCode: 0, success: true };
    }

    // Within-run deduplication (single instance — no dupes)
    // This is the first dedup call (within-run, for instance-scoped IDs only)
    if (prompt.includes('deduplication assistant') && prompt.includes('I1-UXR-001') && !prompt.includes('UXR-001\nUI Area')) {
      return {
        stdout: 'NO_DUPLICATES',
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // Cross-run deduplication (existing + new findings)
    // I1-UXR-001 (hover) duplicates existing UXR-001 (hover)
    if (prompt.includes('deduplication assistant') && prompt.includes('UXR-001\nUI Area')) {
      return {
        stdout: 'DUPLICATE_GROUP: UXR-001, I1-UXR-001',
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // Hierarchy determination
    if (prompt.includes('UX report organizer')) {
      // Settings: UXR-005 (save button) child of UXR-004 (validation)
      if (prompt.includes('UXR-004') && prompt.includes('UXR-005')) {
        return {
          stdout: 'CHILD_OF: UXR-005, UXR-004',
          stderr: '',
          exitCode: 0,
          success: true,
        };
      }
      return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
    }

    // Discovery consolidation (single instance — restructures)
    if (prompt.includes('document consolidation assistant')) {
      return {
        stdout: `# Settings

- Input fields
  - Checked: Form usability, Validation feedback
- Save button
  - Checked: Form usability`,
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

describe('Integration: Append mode — cross-run dedup and merged output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTestDirs();
    writeExistingOutput();
    mockInitWorkspace.mockReturnValue({
      tempDir: TEMP_DIR,
      instanceDirs: [testInstanceDir(1)],
      outputDir: OUTPUT_DIR,
    });
    setupRunClaudeMock();
  });

  afterEach(() => {
    cleanTestDirs();
  });

  // ---------------------------------------------------------------------------
  // Cross-run deduplication
  // ---------------------------------------------------------------------------

  describe('cross-run deduplication', () => {
    it('removes new findings that duplicate existing findings', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // I1-UXR-001 (hover) was a dupe of existing UXR-001 — should be removed
      // Only the 2 non-duplicate new findings should appear as new entries
      // Existing: UXR-001, UXR-002, UXR-003
      // New (after cross-run dedup): I1-UXR-002 -> UXR-004, I1-UXR-003 -> UXR-005
      expect(reportContent).toContain('UXR-001');
      expect(reportContent).toContain('UXR-002');
      expect(reportContent).toContain('UXR-003');
      expect(reportContent).toContain('UXR-004');
      expect(reportContent).toContain('UXR-005');
      expect(reportContent).not.toContain('UXR-006');
    });

    it('existing findings retain their original IDs and content', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // Existing findings should still be present with same descriptions
      expect(reportContent).toContain('Breadcrumb trail missing');
      expect(reportContent).toContain('Card grid spacing inconsistent');
    });

    it('new non-duplicate findings are assigned sequential IDs after existing max', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // Existing max ID is 3, new findings start at 4
      expect(reportContent).toContain('UXR-004');
      expect(reportContent).toContain('inline validation');  // I1-UXR-002 content
      expect(reportContent).toContain('UXR-005');
      expect(reportContent).toContain('shared button component');  // I1-UXR-003 content
    });

    it('calls Claude for cross-run dedup with both existing and new findings', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const dedupCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('deduplication assistant'),
      );

      // Should have at least one cross-run dedup call containing both existing and new IDs
      const crossRunCall = dedupCalls.find(
        (c) => c[0].prompt.includes('UXR-001') && c[0].prompt.includes('I1-UXR'),
      );
      expect(crossRunCall).toBeDefined();
    });

    it('no instance-scoped IDs remain in final report', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      expect(reportContent).not.toContain('I1-UXR-');
    });
  });

  // ---------------------------------------------------------------------------
  // Screenshot accumulation
  // ---------------------------------------------------------------------------

  describe('screenshot accumulation', () => {
    it('preserves existing screenshots', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const screenshotDir = join(OUTPUT_DIR, 'screenshots');

      // Existing screenshots should still exist
      expect(existsSync(join(screenshotDir, 'UXR-001.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-002.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-003.png'))).toBe(true);
    });

    it('existing screenshots are not overwritten', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const screenshotDir = join(OUTPUT_DIR, 'screenshots');

      // Existing screenshots should retain their original content (EXISTING_PNG, which is 9 bytes)
      const existingContent = readFileSync(join(screenshotDir, 'UXR-001.png'));
      expect(existingContent.length).toBe(EXISTING_PNG.length);
    });

    it('adds new screenshots for new findings', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const screenshotDir = join(OUTPUT_DIR, 'screenshots');

      // New findings (UXR-004, UXR-005) should have screenshots
      expect(existsSync(join(screenshotDir, 'UXR-004.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-005.png'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Merged report output
  // ---------------------------------------------------------------------------

  describe('merged report output', () => {
    it('report contains all findings from both runs organized hierarchically', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // Should contain headings for all UI areas
      expect(reportContent).toContain('## Navigation');
      expect(reportContent).toContain('## Dashboard');
      expect(reportContent).toContain('## Settings');
    });

    it('report contains findings from both existing and new runs', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // Existing findings content
      expect(reportContent).toContain('hover effects');       // UXR-001 from existing
      expect(reportContent).toContain('breadcrumb trail');     // UXR-002 from existing
      expect(reportContent).toContain('uneven gaps');          // UXR-003 from existing

      // New findings content
      expect(reportContent).toContain('inline validation');    // UXR-004 from new
      expect(reportContent).toContain('shared button');        // UXR-005 from new
    });

    it('hierarchy determination is called for UI areas with multiple findings', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const hierarchyCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('UX report organizer'),
      );

      // Should have hierarchy calls for areas with 2+ findings
      expect(hierarchyCalls.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Discovery document merge
  // ---------------------------------------------------------------------------

  describe('discovery document merge', () => {
    it('merged discovery contains content from both existing and new runs', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      const content = readFileSync(discoveryPath, 'utf-8');

      // Existing discovery content
      expect(content).toContain('Main menu items');
      expect(content).toContain('Hover states');
      expect(content).toContain('Dashboard cards');

      // New discovery content
      expect(content).toContain('Input fields');
      expect(content).toContain('Save button');
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('append mode edge cases', () => {
    it('works as fresh run when output directory has no existing report', async () => {
      // Remove the existing report
      rmSync(join(OUTPUT_DIR, 'report.md'));
      rmSync(join(OUTPUT_DIR, 'discovery.md'));

      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // All 3 new findings should get IDs starting from 1
      expect(reportContent).toContain('UXR-001');
      expect(reportContent).toContain('UXR-002');
      expect(reportContent).toContain('UXR-003');
    });

    it('non-append mode overwrites existing output', async () => {
      const args = makeArgs({ append: false });
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // Should NOT contain old findings (they were overwritten)
      // In non-append mode, only new findings appear
      expect(reportContent).not.toContain('Breadcrumb trail missing');
    });
  });
});
