import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanTestDirs } from './test-helpers.js';

// --- Test-isolated directory structure ---
const TEST_BASE = resolve('.uxreview-integ-multi-test');
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
  formatDuration: (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
  },
}));

vi.mock('../src/browser-open.js', () => ({
  openInBrowser: vi.fn(),
}));

// --- Imports (after mocks are declared) ---
import { runClaude } from '../src/claude-cli.js';
import { initWorkspace } from '../src/file-manager.js';
import { orchestrate } from '../src/orchestrator.js';
import { ParsedArgs } from '../src/cli.js';
import { DEFAULT_SCOPE } from '../src/default-scope.js';
import { distributePlan } from '../src/work-distribution.js';
import { ProgressDisplay } from '../src/progress-display.js';

const mockRunClaude = vi.mocked(runClaude);
const mockInitWorkspace = vi.mocked(initWorkspace);

// --- Mock data ---

const PLAN = `## Navigation
- Review main nav bar
- Check breadcrumb trail
- Test mobile menu

## Dashboard
- Check card grid layout
- Verify empty states
- Check widget interactions

## Settings
- Test form validation
- Check save/cancel flows
- Review password change`;

const INTRO = 'Test app for UX review. Login at https://example.com with admin/admin.';

// Work distribution response: 3 chunks separated by ---CHUNK---
const WORK_DISTRIBUTION_RESPONSE = `## Navigation
- Review main nav bar
- Check breadcrumb trail
- Test mobile menu
---CHUNK---
## Dashboard
- Check card grid layout
- Verify empty states
- Check widget interactions
---CHUNK---
## Settings
- Test form validation
- Check save/cancel flows
- Review password change`;

// ---- Instance 1 (Navigation) ----

const MOCK_DISCOVERY_I1_R1 = `# Discovery Document - Instance 1

## Round 1

### Navigation Bar
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home → Navigation Bar
- **Elements Observed**:
  - Main menu items
  - Logo
  - Hover states
- **Checked**:
  - Layout consistency
  - Navigation flow

### Breadcrumb Trail
- **Visited**: 2026-04-02T10:05:00.000Z
- **Navigation Path**: Home → Sub-page → Breadcrumb
- **Elements Observed**:
  - Breadcrumb links
  - Current page indicator
- **Checked**:
  - Navigation flow
  - Discoverability
`;

const MOCK_DISCOVERY_I1_R2 = MOCK_DISCOVERY_I1_R1 + `
## Round 2

### Mobile Navigation
- **Visited**: 2026-04-02T10:10:00.000Z
- **Navigation Path**: Home → Viewport resize → Mobile menu
- **Elements Observed**:
  - Hamburger menu
  - Mobile nav drawer
- **Checked**:
  - Responsiveness
  - Touch targets
`;

const MOCK_REPORT_I1_ROUND1 = `# UX Report - Instance 1

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
`;

const MOCK_REPORT_I1_FINAL = MOCK_REPORT_I1_ROUND1 + `
## I1-UXR-003: Mobile hamburger menu animation is janky

- **UI Area**: Navigation
- **Severity**: minor
- **Description**: The hamburger menu animation stutters on mobile devices
- **Suggestion**: Use CSS transitions instead of JS animations
- **Screenshot**: I1-UXR-003.png
`;

// ---- Instance 2 (Dashboard) ----

const MOCK_DISCOVERY_I2_R1 = `# Discovery Document - Instance 2

## Round 1

### Card Grid
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home → Dashboard
- **Elements Observed**:
  - Dashboard cards
  - Grid layout
  - Card content
- **Checked**:
  - Layout consistency
  - Spacing
`;

const MOCK_DISCOVERY_I2_R2 = MOCK_DISCOVERY_I2_R1 + `
## Round 2

### Widget Panel
- **Visited**: 2026-04-02T10:10:00.000Z
- **Navigation Path**: Home → Dashboard → Widgets
- **Elements Observed**:
  - Widget controls
  - Empty state message
- **Checked**:
  - Empty states
  - Content hierarchy
`;

const MOCK_REPORT_I2_ROUND1 = `# UX Report - Instance 2

## I2-UXR-001: Card grid spacing inconsistent at medium breakpoints

- **UI Area**: Dashboard
- **Severity**: minor
- **Description**: Dashboard card grid has uneven gaps between cards at tablet width
- **Suggestion**: Use CSS grid with consistent gap values
- **Screenshot**: I2-UXR-001.png

## I2-UXR-002: Inconsistent hover states in navigation discovered during dashboard review

- **UI Area**: Navigation
- **Severity**: major
- **Description**: While reviewing the dashboard, noticed that navigation items have inconsistent hover effects across different sections of the application
- **Suggestion**: Standardize hover styles across all navigation items using a shared component
- **Screenshot**: I2-UXR-002.png
`;

const MOCK_REPORT_I2_FINAL = MOCK_REPORT_I2_ROUND1 + `
## I2-UXR-003: Empty state message is generic and unhelpful

- **UI Area**: Dashboard
- **Severity**: minor
- **Description**: When no widgets are configured, the empty state just says No data
- **Suggestion**: Provide actionable empty state with a link to add widgets
- **Screenshot**: I2-UXR-003.png
`;

// ---- Instance 3 (Settings) ----

const MOCK_DISCOVERY_I3_R1 = `# Discovery Document - Instance 3

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
`;

const MOCK_DISCOVERY_I3_R2 = MOCK_DISCOVERY_I3_R1 + `
## Round 2

### Password Change
- **Visited**: 2026-04-02T10:10:00.000Z
- **Navigation Path**: Home → Settings → Security
- **Elements Observed**:
  - Password fields
  - Strength indicator
- **Checked**:
  - Form validation
  - Error messaging
`;

const MOCK_REPORT_I3_ROUND1 = `# UX Report - Instance 3

## I3-UXR-001: Missing form validation feedback on settings page

- **UI Area**: Settings
- **Severity**: major
- **Description**: No inline validation feedback when entering invalid data in settings forms
- **Suggestion**: Add real-time inline validation with descriptive error messages
- **Screenshot**: I3-UXR-001.png

## I3-UXR-002: Save button uses different styling than other CTAs

- **UI Area**: Settings
- **Severity**: minor
- **Description**: The save button in settings uses a different color and size than other primary action buttons
- **Suggestion**: Use the shared button component with consistent styling
- **Screenshot**: I3-UXR-002.png
`;

const MOCK_REPORT_I3_FINAL = MOCK_REPORT_I3_ROUND1 + `
## I3-UXR-003: Password strength indicator not visible enough

- **UI Area**: Settings
- **Severity**: minor
- **Description**: The password strength indicator has poor contrast and is easy to miss
- **Suggestion**: Increase contrast and add text label alongside the visual indicator
- **Screenshot**: I3-UXR-003.png
`;

// Consolidated discovery (output from Claude merging all 3 instance discovery docs)
const MOCK_CONSOLIDATED_DISCOVERY = `# Navigation

- Main menu items
  - Checked: Layout consistency, Navigation flow
- Logo
  - Checked: Layout consistency
- Hover states
  - Checked: Layout consistency
- Breadcrumb links
  - Checked: Navigation flow, Discoverability
- Hamburger menu
  - Checked: Responsiveness, Touch targets

# Dashboard

- Dashboard cards
  - Checked: Layout consistency, Spacing
- Grid layout
  - Checked: Layout consistency
- Widget controls
  - Checked: Empty states
- Empty state message
  - Checked: Content hierarchy

# Settings

- Input fields
  - Checked: Form usability, Validation feedback
- Save button
  - Checked: Form usability
- Password fields
  - Checked: Form validation, Error messaging`;

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

function makeArgs(overrides?: Partial<ParsedArgs>): ParsedArgs {
  return {
    url: 'https://example.com/app',
    intro: INTRO,
    plan: PLAN,
    scope: DEFAULT_SCOPE,
    instances: 3,
    rounds: 2,
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
 * Set up the runClaude mock to simulate:
 * - Work distribution splitting the plan into 3 chunks
 * - 3 instances × 2 rounds of analysis (6 instance calls total)
 * - Deduplication detecting one cross-instance duplicate
 * - Hierarchy determination per UI area
 * - Discovery consolidation merging 3 docs
 */
function setupRunClaudeMock() {
  mockRunClaude.mockImplementation(async (options) => {
    const prompt = options.prompt;

    // 1. Work distribution call
    if (prompt.includes('work distribution assistant')) {
      return {
        stdout: WORK_DISTRIBUTION_RESPONSE,
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // 2. Instance analysis calls — determine instance and round from prompt
    if (prompt.includes('You are a UX analyst')) {
      let instanceNum = 0;
      if (prompt.includes('I1-UXR-')) instanceNum = 1;
      else if (prompt.includes('I2-UXR-')) instanceNum = 2;
      else if (prompt.includes('I3-UXR-')) instanceNum = 3;

      const roundMatch = prompt.match(/Current round: (\d+)/);
      const round = roundMatch ? parseInt(roundMatch[1], 10) : 1;

      const paths = testInstancePaths(instanceNum);

      if (instanceNum === 1) {
        if (round === 1) {
          writeFileSync(paths.discovery, MOCK_DISCOVERY_I1_R1, 'utf-8');
          writeFileSync(paths.report, MOCK_REPORT_I1_ROUND1, 'utf-8');
          writeFileSync(join(paths.screenshots, 'I1-UXR-001.png'), DUMMY_PNG);
          writeFileSync(join(paths.screenshots, 'I1-UXR-002.png'), DUMMY_PNG);
        } else {
          writeFileSync(paths.discovery, MOCK_DISCOVERY_I1_R2, 'utf-8');
          writeFileSync(paths.report, MOCK_REPORT_I1_FINAL, 'utf-8');
          writeFileSync(join(paths.screenshots, 'I1-UXR-003.png'), DUMMY_PNG);
        }
      } else if (instanceNum === 2) {
        if (round === 1) {
          writeFileSync(paths.discovery, MOCK_DISCOVERY_I2_R1, 'utf-8');
          writeFileSync(paths.report, MOCK_REPORT_I2_ROUND1, 'utf-8');
          writeFileSync(join(paths.screenshots, 'I2-UXR-001.png'), DUMMY_PNG);
          writeFileSync(join(paths.screenshots, 'I2-UXR-002.png'), DUMMY_PNG);
        } else {
          writeFileSync(paths.discovery, MOCK_DISCOVERY_I2_R2, 'utf-8');
          writeFileSync(paths.report, MOCK_REPORT_I2_FINAL, 'utf-8');
          writeFileSync(join(paths.screenshots, 'I2-UXR-003.png'), DUMMY_PNG);
        }
      } else if (instanceNum === 3) {
        if (round === 1) {
          writeFileSync(paths.discovery, MOCK_DISCOVERY_I3_R1, 'utf-8');
          writeFileSync(paths.report, MOCK_REPORT_I3_ROUND1, 'utf-8');
          writeFileSync(join(paths.screenshots, 'I3-UXR-001.png'), DUMMY_PNG);
          writeFileSync(join(paths.screenshots, 'I3-UXR-002.png'), DUMMY_PNG);
        } else {
          writeFileSync(paths.discovery, MOCK_DISCOVERY_I3_R2, 'utf-8');
          writeFileSync(paths.report, MOCK_REPORT_I3_FINAL, 'utf-8');
          writeFileSync(join(paths.screenshots, 'I3-UXR-003.png'), DUMMY_PNG);
        }
      }

      return { stdout: 'Analysis complete', stderr: '', exitCode: 0, success: true };
    }

    // 3. Deduplication call — I1-UXR-001 and I2-UXR-002 are duplicates
    if (prompt.includes('deduplication assistant')) {
      return {
        stdout: 'DUPLICATE_GROUP: I1-UXR-001, I2-UXR-002',
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // 4. Hierarchy determination (per UI area, after ID reassignment)
    if (prompt.includes('UX report organizer')) {
      // Navigation area: UXR-002 (breadcrumb) is child of UXR-001 (hover states)
      if (prompt.includes('UXR-001') && prompt.includes('UXR-002') && prompt.includes('UXR-003') && !prompt.includes('UXR-004')) {
        return {
          stdout: 'CHILD_OF: UXR-002, UXR-001',
          stderr: '',
          exitCode: 0,
          success: true,
        };
      }
      // Dashboard area: independent findings
      if (prompt.includes('UXR-004') && prompt.includes('UXR-005')) {
        return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
      }
      // Settings area: UXR-008 (password) is child of UXR-006 (form validation)
      if (prompt.includes('UXR-006') && prompt.includes('UXR-007') && prompt.includes('UXR-008')) {
        return {
          stdout: 'CHILD_OF: UXR-008, UXR-006',
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

describe('Integration: Multi-instance, multi-round (3 instances × 2 rounds)', () => {
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

  afterEach(async () => {
    await cleanTestDirs(TEST_BASE);
  });

  // ---------------------------------------------------------------------------
  // Plan splitting across instances
  // ---------------------------------------------------------------------------

  describe('plan splitting across instances', () => {
    it('calls Claude to split the plan into 3 chunks', async () => {
      const result = await distributePlan(PLAN, 3);

      expect(result.usedClaude).toBe(true);
      expect(result.chunks).toHaveLength(3);
      expect(mockRunClaude).toHaveBeenCalledTimes(1);

      // Each chunk should contain one section
      expect(result.chunks[0]).toContain('Navigation');
      expect(result.chunks[1]).toContain('Dashboard');
      expect(result.chunks[2]).toContain('Settings');
    });

    it('writes work-distribution.md noting Claude split', async () => {
      await distributePlan(PLAN, 3);

      const workDistPath = join(TEMP_DIR, 'work-distribution.md');
      expect(existsSync(workDistPath)).toBe(true);

      const content = readFileSync(workDistPath, 'utf-8');
      expect(content).toContain('# Work Distribution');
      expect(content).toContain('split into 3 chunks via Claude');
      expect(content).toContain('## Instance 1');
      expect(content).toContain('## Instance 2');
      expect(content).toContain('## Instance 3');
    });
  });

  // ---------------------------------------------------------------------------
  // Full pipeline — parallel execution with multi-round
  // ---------------------------------------------------------------------------

  describe('full pipeline', () => {
    it('runs 3 instances × 2 rounds through consolidation to final output', async () => {
      const args = makeArgs();
      await orchestrate(args);

      // --- Verify total runClaude calls ---
      // 1 work distribution + 6 instance analysis (3×2) + 1 dedup + 3 hierarchy + 1 discovery = 12
      const allCalls = mockRunClaude.mock.calls;

      const workDistCalls = allCalls.filter((c) => c[0].prompt.includes('work distribution assistant'));
      const analysisCalls = allCalls.filter((c) => c[0].prompt.includes('You are a UX analyst'));
      const dedupCalls = allCalls.filter((c) => c[0].prompt.includes('deduplication assistant'));
      const hierarchyCalls = allCalls.filter((c) => c[0].prompt.includes('UX report organizer'));
      const discoveryCalls = allCalls.filter((c) => c[0].prompt.includes('document consolidation assistant'));

      expect(workDistCalls).toHaveLength(1);
      expect(analysisCalls).toHaveLength(6); // 3 instances × 2 rounds
      expect(dedupCalls).toHaveLength(1);
      expect(hierarchyCalls).toHaveLength(3); // one per UI area
      expect(discoveryCalls).toHaveLength(1);

      // --- Verify work distribution ---
      const workDistPath = join(TEMP_DIR, 'work-distribution.md');
      expect(existsSync(workDistPath)).toBe(true);
      const workDistContent = readFileSync(workDistPath, 'utf-8');
      expect(workDistContent).toContain('split into 3 chunks');

      // --- Verify consolidated report ---
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const reportContent = readFileSync(reportPath, 'utf-8');

      // 8 findings after deduplication (9 original - 1 merged pair)
      expect(reportContent).toContain('UXR-001');
      expect(reportContent).toContain('UXR-008');
      // No instance-scoped IDs in final report
      expect(reportContent).not.toContain('I1-UXR-');
      expect(reportContent).not.toContain('I2-UXR-');
      expect(reportContent).not.toContain('I3-UXR-');

      // Grouped by UI area
      expect(reportContent).toContain('## Navigation');
      expect(reportContent).toContain('## Dashboard');
      expect(reportContent).toContain('## Settings');

      // --- Verify consolidated discovery doc ---
      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      expect(existsSync(discoveryPath)).toBe(true);
      const discoveryContent = readFileSync(discoveryPath, 'utf-8');
      expect(discoveryContent).toContain('Navigation');
      expect(discoveryContent).toContain('Dashboard');
      expect(discoveryContent).toContain('Settings');

      // --- Verify progress display lifecycle ---
      expect(ProgressDisplay).toHaveBeenCalledWith([1, 2, 3], 2);
      expect(mockProgressDisplay.start).toHaveBeenCalledTimes(1);
      expect(mockProgressDisplay.stop).toHaveBeenCalledTimes(2);
      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(1);
      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(2);
      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(3);
      expect(mockProgressDisplay.startConsolidation).toHaveBeenCalledTimes(1);
      expect(mockProgressDisplay.completeConsolidation).toHaveBeenCalledTimes(1);

      const completeArgs = mockProgressDisplay.completeConsolidation.mock.calls[0];
      expect(completeArgs[0]).toContain('report.html');
      expect(completeArgs[1]).toContain('discovery.md');
    });
  });

  // ---------------------------------------------------------------------------
  // Parallel mock execution — all instances start
  // ---------------------------------------------------------------------------

  describe('parallel instance execution', () => {
    it('sends each instance its own plan chunk', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const analysisCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('You are a UX analyst'),
      );

      // Instance 1 gets Navigation chunk
      const i1Calls = analysisCalls.filter((c) => c[0].prompt.includes('I1-UXR-'));
      expect(i1Calls.length).toBe(2); // 2 rounds
      expect(i1Calls[0][0].prompt).toContain('## Navigation');
      expect(i1Calls[0][0].prompt).not.toContain('## Dashboard');
      expect(i1Calls[0][0].prompt).not.toContain('## Settings');

      // Instance 2 gets Dashboard chunk
      const i2Calls = analysisCalls.filter((c) => c[0].prompt.includes('I2-UXR-'));
      expect(i2Calls.length).toBe(2);
      expect(i2Calls[0][0].prompt).toContain('## Dashboard');

      // Instance 3 gets Settings chunk
      const i3Calls = analysisCalls.filter((c) => c[0].prompt.includes('I3-UXR-'));
      expect(i3Calls.length).toBe(2);
      expect(i3Calls[0][0].prompt).toContain('## Settings');
    });

    it('each instance has its own working directory', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const analysisCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('You are a UX analyst'),
      );

      // Separate cwd per instance
      const i1Call = analysisCalls.find((c) => c[0].prompt.includes('I1-UXR-'));
      const i2Call = analysisCalls.find((c) => c[0].prompt.includes('I2-UXR-'));
      const i3Call = analysisCalls.find((c) => c[0].prompt.includes('I3-UXR-'));

      expect(i1Call![0].cwd).toBe(testInstanceDir(1));
      expect(i2Call![0].cwd).toBe(testInstanceDir(2));
      expect(i3Call![0].cwd).toBe(testInstanceDir(3));
    });

    it('all instances include the evaluation scope in their prompts', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const analysisCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('You are a UX analyst'),
      );

      for (const call of analysisCalls) {
        expect(call[0].prompt).toContain('Layout Consistency and Spacing');
        expect(call[0].prompt).toContain('Navigation Flow and Discoverability');
      }
    });

    it('checkpoints are written before each round for each instance', async () => {
      const args = makeArgs();

      // Track checkpoint existence at analysis call time
      const checkpointExisted: { instance: number; round: number; existed: boolean }[] = [];

      const originalMock = mockRunClaude.getMockImplementation()!;
      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;
        if (prompt.includes('You are a UX analyst')) {
          let instanceNum = 0;
          if (prompt.includes('I1-UXR-')) instanceNum = 1;
          else if (prompt.includes('I2-UXR-')) instanceNum = 2;
          else if (prompt.includes('I3-UXR-')) instanceNum = 3;

          const roundMatch = prompt.match(/Current round: (\d+)/);
          const round = roundMatch ? parseInt(roundMatch[1], 10) : 1;

          const cpPath = testInstancePaths(instanceNum).checkpoint;
          checkpointExisted.push({
            instance: instanceNum,
            round,
            existed: existsSync(cpPath),
          });
        }
        return originalMock(options);
      });

      await orchestrate(args);

      // All 6 analysis calls should have had a checkpoint file present
      expect(checkpointExisted).toHaveLength(6);
      for (const entry of checkpointExisted) {
        expect(entry.existed).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Round 2 receives discovery doc from round 1
  // ---------------------------------------------------------------------------

  describe('round 2 discovery context', () => {
    it('round 1 prompts do NOT include discovery context', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const analysisCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('You are a UX analyst'),
      );

      // Find round 1 calls (those with "Current round: 1")
      const round1Calls = analysisCalls.filter((c) => c[0].prompt.includes('Current round: 1'));
      expect(round1Calls).toHaveLength(3);

      for (const call of round1Calls) {
        expect(call[0].prompt).not.toContain('Previous Discovery');
      }
    });

    it('round 2 prompts include discovery context from round 1', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const analysisCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('You are a UX analyst'),
      );

      // Find round 2 calls (those with "Current round: 2")
      const round2Calls = analysisCalls.filter((c) => c[0].prompt.includes('Current round: 2'));
      expect(round2Calls).toHaveLength(3);

      for (const call of round2Calls) {
        expect(call[0].prompt).toContain('Previous Discovery');
        expect(call[0].prompt).toContain('areas have already been explored');
      }

      // Instance 1 round 2 should include its round 1 discovery content
      const i1r2 = round2Calls.find((c) => c[0].prompt.includes('I1-UXR-'));
      expect(i1r2).toBeDefined();
      expect(i1r2![0].prompt).toContain('Navigation Bar');
      expect(i1r2![0].prompt).toContain('Breadcrumb Trail');
      expect(i1r2![0].prompt).toContain('Main menu items');

      // Instance 2 round 2 should include its round 1 discovery content
      const i2r2 = round2Calls.find((c) => c[0].prompt.includes('I2-UXR-'));
      expect(i2r2).toBeDefined();
      expect(i2r2![0].prompt).toContain('Card Grid');
      expect(i2r2![0].prompt).toContain('Dashboard cards');

      // Instance 3 round 2 should include its round 1 discovery content
      const i3r2 = round2Calls.find((c) => c[0].prompt.includes('I3-UXR-'));
      expect(i3r2).toBeDefined();
      expect(i3r2![0].prompt).toContain('Form Fields');
      expect(i3r2![0].prompt).toContain('Input fields');
    });

    it('round 2 checkpoints use discovery items for recalibrated progress', async () => {
      const args = makeArgs();
      await orchestrate(args);

      // After orchestration, the round 2 checkpoint for instance 1 should use
      // the granular discovery items (e.g., "Navigation Bar: Main menu items")
      // rather than the original plan areas ("Navigation")
      const cpPath = testInstancePaths(1).checkpoint;
      expect(existsSync(cpPath)).toBe(true);
      const cp = JSON.parse(readFileSync(cpPath, 'utf-8'));

      // Round 2 checkpoint should have more granular areas from discovery
      // The discovery doc has 5 elements across 2 areas (Navigation Bar: 3, Breadcrumb Trail: 2)
      expect(cp.currentRound).toBe(2);
      expect(cp.assignedAreas.length).toBeGreaterThan(1);
      // Discovery items are formatted as "Area: Element"
      expect(cp.assignedAreas.some((a: string) => a.includes(':'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Deduplication for multi-instance
  // ---------------------------------------------------------------------------

  describe('deduplication', () => {
    it('calls Claude deduplication for multi-instance findings', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const dedupCalls = mockRunClaude.mock.calls.filter(
        (c) => c[0].prompt.includes('deduplication assistant'),
      );
      expect(dedupCalls).toHaveLength(1);

      // The dedup prompt should contain findings from all 3 instances
      const dedupPrompt = dedupCalls[0][0].prompt;
      expect(dedupPrompt).toContain('I1-UXR-001');
      expect(dedupPrompt).toContain('I2-UXR-001');
      expect(dedupPrompt).toContain('I3-UXR-001');
    });

    it('merges duplicate findings and produces 8 unique findings from 9', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportPath = join(OUTPUT_DIR, 'report.md');
      const reportContent = readFileSync(reportPath, 'utf-8');

      // 8 findings after merging I1-UXR-001 + I2-UXR-002
      expect(reportContent).toContain('UXR-001');
      expect(reportContent).toContain('UXR-002');
      expect(reportContent).toContain('UXR-003');
      expect(reportContent).toContain('UXR-004');
      expect(reportContent).toContain('UXR-005');
      expect(reportContent).toContain('UXR-006');
      expect(reportContent).toContain('UXR-007');
      expect(reportContent).toContain('UXR-008');
      // Should not have UXR-009 (only 8 after dedup)
      expect(reportContent).not.toContain('UXR-009');
    });

    it('merged finding uses the longer description', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportPath = join(OUTPUT_DIR, 'report.md');
      const reportContent = readFileSync(reportPath, 'utf-8');

      // I2-UXR-002 had the longer description, so the merged UXR-001 should use it
      expect(reportContent).toContain('inconsistent hover effects across different sections');
    });
  });

  // ---------------------------------------------------------------------------
  // Consolidation — hierarchy, screenshots, discovery
  // ---------------------------------------------------------------------------

  describe('report consolidation', () => {
    it('assigns sequential UXR IDs with no gaps', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportPath = join(OUTPUT_DIR, 'report.md');
      const reportContent = readFileSync(reportPath, 'utf-8');

      for (let i = 1; i <= 8; i++) {
        const id = `UXR-${String(i).padStart(3, '0')}`;
        expect(reportContent).toContain(id);
      }
    });

    it('groups findings by UI area', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      const navIdx = reportContent.indexOf('## Navigation');
      const dashIdx = reportContent.indexOf('## Dashboard');
      const settIdx = reportContent.indexOf('## Settings');

      expect(navIdx).toBeGreaterThan(-1);
      expect(dashIdx).toBeGreaterThan(-1);
      expect(settIdx).toBeGreaterThan(-1);
    });

    it('applies parent-child hierarchy within areas', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // Navigation: UXR-001 is parent (###), UXR-002 is child (####)
      expect(reportContent).toMatch(/### UXR-001:/);
      expect(reportContent).toMatch(/#### UXR-002:/);

      // Settings: UXR-006 is parent (###), UXR-008 is child (####)
      expect(reportContent).toMatch(/### UXR-006:/);
      expect(reportContent).toMatch(/#### UXR-008:/);

      // Dashboard: both UXR-004 and UXR-005 are top-level (###)
      expect(reportContent).toMatch(/### UXR-004:/);
      expect(reportContent).toMatch(/### UXR-005:/);
    });

    it('copies and renames screenshots from all instances to output', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const screenshotDir = join(OUTPUT_DIR, 'screenshots');

      // 9 screenshot files (8 findings, but UXR-001 has 2 from merged finding)
      expect(existsSync(join(screenshotDir, 'UXR-001.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-001-a.png'))).toBe(true); // second screenshot from merged
      expect(existsSync(join(screenshotDir, 'UXR-002.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-003.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-004.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-005.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-006.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-007.png'))).toBe(true);
      expect(existsSync(join(screenshotDir, 'UXR-008.png'))).toBe(true);

      // Original instance-scoped screenshots should NOT be in output
      expect(existsSync(join(screenshotDir, 'I1-UXR-001.png'))).toBe(false);
      expect(existsSync(join(screenshotDir, 'I2-UXR-001.png'))).toBe(false);
      expect(existsSync(join(screenshotDir, 'I3-UXR-001.png'))).toBe(false);
    });

    it('screenshot references in report use new IDs', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const reportContent = readFileSync(join(OUTPUT_DIR, 'report.md'), 'utf-8');

      // Report should reference the new screenshot filenames
      expect(reportContent).toContain('UXR-001.png');
      expect(reportContent).toContain('UXR-002.png');
      expect(reportContent).toContain('UXR-008.png');

      // No instance-scoped screenshot references
      expect(reportContent).not.toMatch(/I\d+-UXR-\d+\.png/);
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

    it('writes consolidated discovery to output', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      expect(existsSync(discoveryPath)).toBe(true);

      const content = readFileSync(discoveryPath, 'utf-8');
      expect(content).toContain('Navigation');
      expect(content).toContain('Dashboard');
      expect(content).toContain('Settings');
      expect(content).toContain('Main menu items');
      expect(content).toContain('Dashboard cards');
      expect(content).toContain('Input fields');
    });
  });

  // ---------------------------------------------------------------------------
  // Progress display for multi-instance
  // ---------------------------------------------------------------------------

  describe('progress display', () => {
    it('creates ProgressDisplay with 3 instances and 2 rounds', async () => {
      const args = makeArgs();
      await orchestrate(args);

      expect(ProgressDisplay).toHaveBeenCalledWith([1, 2, 3], 2);
    });

    it('marks all 3 instances as completed', async () => {
      const args = makeArgs();
      await orchestrate(args);

      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(1);
      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(2);
      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(3);
      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledTimes(3);
    });

    it('consolidation only starts after all instances complete', async () => {
      const args = makeArgs();
      await orchestrate(args);

      // startConsolidation should be called after all markCompleted calls
      const completedOrder = mockProgressDisplay.markCompleted.mock.invocationCallOrder;
      const consolidationOrder = mockProgressDisplay.startConsolidation.mock.invocationCallOrder;

      const lastCompleted = Math.max(...completedOrder);
      const consolidationStart = consolidationOrder[0];
      expect(consolidationStart).toBeGreaterThan(lastCompleted);
    });
  });
});
