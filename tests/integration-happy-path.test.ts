import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanTestDirs } from './test-helpers.js';

// --- Test-isolated directory structure ---
const TEST_BASE = resolve('.uxreview-integ-happy-test');
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

// Mock the Claude CLI — the only external boundary
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

// Mock file-manager to redirect all paths to test directory
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

// Mock progress display to avoid terminal output
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
import { parseArgs, resolveTextOrFile, ParsedArgs } from '../src/cli.js';
import { DEFAULT_SCOPE } from '../src/default-scope.js';
import { distributePlan } from '../src/work-distribution.js';
import { ProgressDisplay } from '../src/progress-display.js';

const mockRunClaude = vi.mocked(runClaude);
const mockInitWorkspace = vi.mocked(initWorkspace);

// --- Mock data: what a Claude instance would produce ---

const PLAN = `## Navigation
- Review main nav bar
- Check breadcrumb trail

## Dashboard
- Check card grid layout
- Verify empty states`;

const INTRO = 'Test app for UX review. Login at https://example.com with admin/admin.';
const CUSTOM_SCOPE = 'Only check button consistency and form validation.';

const MOCK_DISCOVERY = `# Discovery Document - Instance 1

## Round 1

### Navigation Bar
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home → Navigation Bar
- **Elements Observed**:
  - Main menu items
  - Logo
  - Search bar
- **Checked**:
  - Layout consistency
  - Navigation flow

### Dashboard
- **Visited**: 2026-04-02T10:05:00.000Z
- **Navigation Path**: Home → Dashboard
- **Elements Observed**:
  - Card grid
  - Widgets
- **Checked**:
  - Layout consistency
  - Loading states
`;

const MOCK_REPORT = `# UX Report - Instance 1

## I1-UXR-001: Inconsistent button styles in navigation

- **UI Area**: Navigation
- **Severity**: major
- **Description**: Primary and secondary nav buttons use different padding and font sizes
- **Suggestion**: Standardize button styles using a shared component
- **Screenshot**: I1-UXR-001.png

## I1-UXR-002: Missing hover states on nav links

- **UI Area**: Navigation
- **Severity**: minor
- **Description**: Some navigation links lack hover state feedback
- **Suggestion**: Add consistent hover styles to all nav links
- **Screenshot**: I1-UXR-002.png

## I1-UXR-003: Dashboard cards have inconsistent spacing

- **UI Area**: Dashboard
- **Severity**: minor
- **Description**: Card grid has uneven gaps between cards at medium breakpoints
- **Suggestion**: Use CSS grid with consistent gap values
- **Screenshot**: I1-UXR-003.png
`;

const MOCK_CONSOLIDATED_DISCOVERY = `# Navigation

- Main menu items
  - Checked: Layout consistency, Navigation flow
- Logo
  - Checked: Layout consistency
- Search bar
  - Checked: Layout consistency

# Dashboard

- Card grid
  - Checked: Layout consistency, Loading states
- Widgets
  - Checked: Layout consistency, Loading states`;

// Minimal valid PNG header for dummy screenshots
const DUMMY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- Helpers ---

function createTestDirs() {
  mkdirSync(TEMP_DIR, { recursive: true });
  const paths = testInstancePaths(1);
  mkdirSync(paths.dir, { recursive: true });
  mkdirSync(paths.screenshots, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'screenshots'), { recursive: true });
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
    append: false,
    dryRun: false,
    verbose: false,
    maxRetries: 3,
    instanceTimeout: 30,
    rateLimitRetries: 10,
    suppressOpen: true,
    ...overrides,
  };
}

/**
 * Set up the runClaude mock to simulate a complete single-instance analysis.
 *
 * Handles three types of calls:
 * 1. Instance analysis — writes discovery, report, screenshots as side effects
 * 2. Hierarchy determination — returns parent-child relationships
 * 3. Discovery consolidation — returns restructured discovery doc
 */
function setupRunClaudeMock() {
  mockRunClaude.mockImplementation(async (options) => {
    const prompt = options.prompt;

    // 1. Instance analysis call (contains "You are a UX analyst")
    if (prompt.includes('You are a UX analyst')) {
      const paths = testInstancePaths(1);
      writeFileSync(paths.discovery, MOCK_DISCOVERY, 'utf-8');
      writeFileSync(paths.report, MOCK_REPORT, 'utf-8');
      writeFileSync(join(paths.screenshots, 'I1-UXR-001.png'), DUMMY_PNG);
      writeFileSync(join(paths.screenshots, 'I1-UXR-002.png'), DUMMY_PNG);
      writeFileSync(join(paths.screenshots, 'I1-UXR-003.png'), DUMMY_PNG);
      return { stdout: 'Analysis complete', stderr: '', exitCode: 0, success: true };
    }

    // 2. Hierarchy determination (contains "UX report organizer")
    if (prompt.includes('UX report organizer')) {
      // Navigation area has 2 findings — make UXR-002 a child of UXR-001
      if (prompt.includes('UXR-001') && prompt.includes('UXR-002')) {
        return {
          stdout: 'CHILD_OF: UXR-002, UXR-001',
          stderr: '',
          exitCode: 0,
          success: true,
        };
      }
      return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
    }

    // 3. Discovery consolidation (contains "document consolidation assistant")
    if (prompt.includes('document consolidation assistant')) {
      return {
        stdout: MOCK_CONSOLIDATED_DISCOVERY,
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    return { stdout: '', stderr: `Unexpected runClaude call`, exitCode: 1, success: false };
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('Integration: Happy path — single instance, single round', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTestDirs();
    mockInitWorkspace.mockReturnValue({
      tempDir: TEMP_DIR,
      instanceDirs: [testInstanceDir(1)],
      outputDir: OUTPUT_DIR,
    });
    setupRunClaudeMock();
  });

  afterEach(async () => {
    await cleanTestDirs(TEST_BASE);
  });

  // ---------------------------------------------------------------------------
  // Arg parsing
  // ---------------------------------------------------------------------------

  describe('arg parsing', () => {
    it('parses required args and applies defaults', () => {
      const args = parseArgs([
        '--url', 'https://example.com/app',
        '--intro', 'Some intro text',
        '--plan', 'Some plan text',
      ]);

      expect(args.url).toBe('https://example.com/app');
      expect(args.intro).toBe('Some intro text');
      expect(args.plan).toBe('Some plan text');
      expect(args.instances).toBe(0);
      expect(args.rounds).toBe(1);
      expect(args.output).toBe('./uxreview-output');
    });

    it('uses DEFAULT_SCOPE when --scope is not provided', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.scope).toBe(DEFAULT_SCOPE);
    });

    it('uses custom inline scope when --scope is provided', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
        '--scope', CUSTOM_SCOPE,
      ]);

      expect(args.scope).toBe(CUSTOM_SCOPE);
    });

    it('resolves scope from file path', () => {
      const scopeFile = join(TEST_BASE, 'custom-scope.md');
      writeFileSync(scopeFile, 'File-based scope content', 'utf-8');

      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
        '--scope', scopeFile,
      ]);

      expect(args.scope).toBe('File-based scope content');
    });

    it('resolves intro and plan from file paths', () => {
      const introFile = join(TEST_BASE, 'intro.md');
      const planFile = join(TEST_BASE, 'plan.md');
      writeFileSync(introFile, 'Intro from file', 'utf-8');
      writeFileSync(planFile, 'Plan from file', 'utf-8');

      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', introFile,
        '--plan', planFile,
      ]);

      expect(args.intro).toBe('Intro from file');
      expect(args.plan).toBe('Plan from file');
    });
  });

  // ---------------------------------------------------------------------------
  // Plan splitting
  // ---------------------------------------------------------------------------

  describe('plan splitting with single instance', () => {
    it('skips Claude call and passes full plan through', async () => {
      const result = await distributePlan(PLAN, 1);

      expect(result.usedClaude).toBe(false);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]).toBe(PLAN);
      expect(mockRunClaude).not.toHaveBeenCalled();
    });

    it('writes work-distribution.md noting single instance passthrough', async () => {
      await distributePlan(PLAN, 1);

      const workDistPath = join(TEMP_DIR, 'work-distribution.md');
      expect(existsSync(workDistPath)).toBe(true);

      const content = readFileSync(workDistPath, 'utf-8');
      expect(content).toContain('# Work Distribution');
      expect(content).toContain('Single instance');
      expect(content).toContain('no Claude call');
    });
  });

  // ---------------------------------------------------------------------------
  // Full pipeline — default scope
  // ---------------------------------------------------------------------------

  describe('full pipeline with default scope', () => {
    it('runs from args through consolidation to final output', async () => {
      const args = makeArgs();
      await orchestrate(args);

      // --- Verify runClaude calls ---
      // Call 1: instance analysis
      // Call 2: discovery consolidation
      // (hierarchy is skipped for single instance — no Claude call needed)
      expect(mockRunClaude).toHaveBeenCalledTimes(2);

      // --- Verify instance prompt ---
      const instanceCall = mockRunClaude.mock.calls[0][0];
      expect(instanceCall.prompt).toContain('https://example.com/app');
      expect(instanceCall.prompt).toContain(INTRO);
      expect(instanceCall.prompt).toContain('## Navigation');
      expect(instanceCall.prompt).toContain('## Dashboard');
      // Default scope should be in the prompt
      expect(instanceCall.prompt).toContain('Layout Consistency and Spacing');
      expect(instanceCall.prompt).toContain('Navigation Flow and Discoverability');
      expect(instanceCall.prompt).toContain('I1-UXR-');

      // --- Verify work distribution ---
      const workDistPath = join(TEMP_DIR, 'work-distribution.md');
      expect(existsSync(workDistPath)).toBe(true);
      const workDistContent = readFileSync(workDistPath, 'utf-8');
      expect(workDistContent).toContain('Single instance');

      // --- Verify consolidated report ---
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const reportContent = readFileSync(reportPath, 'utf-8');

      // Sequential UXR IDs
      expect(reportContent).toContain('UXR-001');
      expect(reportContent).toContain('UXR-002');
      expect(reportContent).toContain('UXR-003');
      // No instance-scoped IDs in final report
      expect(reportContent).not.toContain('I1-UXR-');

      // Grouped by UI area
      expect(reportContent).toContain('## Navigation');
      expect(reportContent).toContain('## Dashboard');

      // Single instance: all findings are flat (###), no hierarchy Claude call
      expect(reportContent).toMatch(/### UXR-001:/);
      expect(reportContent).toMatch(/### UXR-002:/);
      expect(reportContent).toMatch(/### UXR-003:/);

      // Screenshots referenced with new IDs
      expect(reportContent).toContain('UXR-001.png');
      expect(reportContent).toContain('UXR-002.png');
      expect(reportContent).toContain('UXR-003.png');

      // --- Verify screenshots copied and renamed ---
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001.png'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-002.png'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-003.png'))).toBe(true);

      // --- Verify consolidated discovery doc ---
      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      expect(existsSync(discoveryPath)).toBe(true);
      const discoveryContent = readFileSync(discoveryPath, 'utf-8');
      expect(discoveryContent).toContain('Navigation');
      expect(discoveryContent).toContain('Dashboard');
      expect(discoveryContent).toContain('Main menu items');
      expect(discoveryContent).toContain('Card grid');

      // --- Verify progress display lifecycle ---
      expect(ProgressDisplay).toHaveBeenCalledWith([1], 1);
      expect(mockProgressDisplay.start).toHaveBeenCalledTimes(1);
      expect(mockProgressDisplay.stop).toHaveBeenCalledTimes(2);
      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(1);
      // Single instance skips consolidation display (no startConsolidation call)
      expect(mockProgressDisplay.completeConsolidation).toHaveBeenCalledTimes(1);

      // Final paths passed to completeConsolidation
      const completeArgs = mockProgressDisplay.completeConsolidation.mock.calls[0];
      expect(completeArgs[0]).toContain('report.html');
      expect(completeArgs[1]).toContain('discovery.md');
    });

    it('checkpoint is written before instance spawn', async () => {
      const args = makeArgs();

      // Track when checkpoint is written vs when runClaude is called
      let checkpointExistedBeforeSpawn = false;
      mockRunClaude.mockImplementation(async (options) => {
        if (options.prompt.includes('You are a UX analyst')) {
          const paths = testInstancePaths(1);
          // Check if checkpoint was already written by the orchestrator
          checkpointExistedBeforeSpawn = existsSync(paths.checkpoint);
          // Write mock output files
          writeFileSync(paths.discovery, MOCK_DISCOVERY, 'utf-8');
          writeFileSync(paths.report, MOCK_REPORT, 'utf-8');
          writeFileSync(join(paths.screenshots, 'I1-UXR-001.png'), DUMMY_PNG);
          writeFileSync(join(paths.screenshots, 'I1-UXR-002.png'), DUMMY_PNG);
          writeFileSync(join(paths.screenshots, 'I1-UXR-003.png'), DUMMY_PNG);
          return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
        }
        if (options.prompt.includes('UX report organizer')) {
          return { stdout: 'CHILD_OF: UXR-002, UXR-001', stderr: '', exitCode: 0, success: true };
        }
        if (options.prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(args);

      expect(checkpointExistedBeforeSpawn).toBe(true);

      // Verify checkpoint content
      const cpPath = testInstancePaths(1).checkpoint;
      const cp = JSON.parse(readFileSync(cpPath, 'utf-8'));
      expect(cp.instanceId).toBe(1);
      expect(cp.currentRound).toBe(1);
      expect(cp.assignedAreas).toEqual(['Navigation', 'Dashboard']);
    });

    it('deduplication is skipped for single instance', async () => {
      const args = makeArgs();
      await orchestrate(args);

      // The deduplication prompt contains "deduplication assistant"
      // It should NOT have been called since all findings come from one instance
      const dedupCalls = mockRunClaude.mock.calls.filter(
        (call) => call[0].prompt.includes('deduplication assistant'),
      );
      expect(dedupCalls).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Full pipeline — custom scope
  // ---------------------------------------------------------------------------

  describe('full pipeline with custom scope', () => {
    it('passes custom scope to the instance prompt instead of default', async () => {
      const args = makeArgs({ scope: CUSTOM_SCOPE });
      await orchestrate(args);

      // Instance prompt should contain custom scope
      const instanceCall = mockRunClaude.mock.calls[0][0];
      expect(instanceCall.prompt).toContain(CUSTOM_SCOPE);
      // Should NOT contain default scope criteria
      expect(instanceCall.prompt).not.toContain('Layout Consistency and Spacing');
    });

    it('still produces valid consolidated output with custom scope', async () => {
      const args = makeArgs({ scope: CUSTOM_SCOPE });
      await orchestrate(args);

      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);

      const reportContent = readFileSync(reportPath, 'utf-8');
      expect(reportContent).toContain('UXR-001');
      expect(reportContent).toContain('UXR-002');
      expect(reportContent).toContain('UXR-003');

      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      expect(existsSync(discoveryPath)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Instance execution details
  // ---------------------------------------------------------------------------

  describe('instance execution', () => {
    it('spawns instance with correct config including allowed tools', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const instanceCall = mockRunClaude.mock.calls[0][0];
      // Should have timeout set for 30 minutes
      expect(instanceCall.timeout).toBe(30 * 60 * 1000);
      // Should have allowed tools
      expect(instanceCall.extraArgs).toContain('--allowedTools');
      expect(instanceCall.extraArgs?.join(' ')).toContain('mcp__playwright');
      // Working directory should be the instance directory
      expect(instanceCall.cwd).toBe(testInstanceDir(1));
    });

    it('includes discovery and report format instructions in prompt', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const prompt = mockRunClaude.mock.calls[0][0].prompt;
      // Discovery instructions
      expect(prompt).toContain('Discovery Document');
      expect(prompt).toContain('Elements Observed');
      expect(prompt).toContain('Checked');
      // Report instructions
      expect(prompt).toContain('Report Document');
      expect(prompt).toContain('UI Area');
      expect(prompt).toContain('Severity');
      expect(prompt).toContain('Screenshot');
      // Screenshot instructions
      expect(prompt).toContain('Screenshots Directory');
      expect(prompt).toContain('I1-UXR-');
    });
  });

  // ---------------------------------------------------------------------------
  // Report consolidation details
  // ---------------------------------------------------------------------------

  describe('report consolidation', () => {
    it('reassigns IDs sequentially from UXR-001', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // All three findings get sequential IDs
      expect(reportContent).toContain('UXR-001:');
      expect(reportContent).toContain('UXR-002:');
      expect(reportContent).toContain('UXR-003:');

      // Finding titles are preserved
      expect(reportContent).toContain('Inconsistent button styles');
      expect(reportContent).toContain('Missing hover states');
      expect(reportContent).toContain('inconsistent spacing');
    });

    it('groups findings by UI area (flat for single instance)', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // Navigation section comes first
      const navIdx = reportContent.indexOf('## Navigation');
      const dashIdx = reportContent.indexOf('## Dashboard');
      expect(navIdx).toBeGreaterThan(-1);
      expect(dashIdx).toBeGreaterThan(navIdx);

      // Single instance: all findings are flat (###), no hierarchy Claude call
      const uxr001Idx = reportContent.indexOf('### UXR-001:');
      const uxr002Idx = reportContent.indexOf('### UXR-002:');
      expect(uxr001Idx).toBeGreaterThan(-1);
      expect(uxr002Idx).toBeGreaterThan(uxr001Idx);
      // Both should be within Navigation section (before Dashboard)
      expect(uxr001Idx).toBeGreaterThan(navIdx);
      expect(uxr002Idx).toBeLessThan(dashIdx);

      // UXR-003 is top-level (###) in Dashboard
      const uxr003Idx = reportContent.indexOf('### UXR-003:');
      expect(uxr003Idx).toBeGreaterThan(dashIdx);
    });

    it('copies and renames screenshots to output directory', async () => {
      const args = makeArgs();
      await orchestrate(args);

      // Renamed screenshots should exist in output
      const screenshotDir = join(OUTPUT_DIR, 'screenshots');
      expect(existsSync(join(screenshotDir, 'UXR-001.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-002.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-003.png'))).toBe(true);

      // Original instance-scoped screenshots should NOT be in output
      expect(existsSync(join(screenshotDir, 'I1-UXR-001.png'))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Discovery doc consolidation
  // ---------------------------------------------------------------------------

  describe('discovery doc consolidation', () => {
    it('reads per-instance discovery and writes consolidated output', async () => {
      const args = makeArgs();
      await orchestrate(args);

      // Discovery consolidation Claude call was made
      const discoveryCalls = mockRunClaude.mock.calls.filter(
        (call) => call[0].prompt.includes('document consolidation assistant'),
      );
      expect(discoveryCalls).toHaveLength(1);

      // The consolidation prompt included the instance's discovery content
      expect(discoveryCalls[0][0].prompt).toContain('Navigation Bar');
      expect(discoveryCalls[0][0].prompt).toContain('Dashboard');
      expect(discoveryCalls[0][0].prompt).toContain('INSTANCE 1 DISCOVERY');

      // Consolidated discovery written to output
      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      expect(existsSync(discoveryPath)).toBe(true);
      const content = readFileSync(discoveryPath, 'utf-8');
      expect(content).toContain('Navigation');
      expect(content).toContain('Dashboard');
      expect(content).toContain('Main menu items');
    });
  });
});
