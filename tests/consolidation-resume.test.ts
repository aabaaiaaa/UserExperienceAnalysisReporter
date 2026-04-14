import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanTestDirs } from './test-helpers.js';

// --- Test-isolated directory structure ---
const TEST_BASE = resolve('.uxreview-integ-consol-resume-test');
const TEMP_DIR = join(TEST_BASE, '.uxreview-temp');
const OUTPUT_DIR = join(TEST_BASE, 'output');
const CHECKPOINT_PATH = join(TEMP_DIR, 'consolidation-checkpoint.json');

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

vi.mock('../src/logger.js', () => ({
  setVerbose: vi.fn(),
  debug: vi.fn(),
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
import {
  readConsolidationCheckpoint,
  writeConsolidationCheckpoint,
  ConsolidationCheckpoint,
  CONSOLIDATION_STEPS,
} from '../src/consolidation-checkpoint.js';

const mockRunClaude = vi.mocked(runClaude);
const mockInitWorkspace = vi.mocked(initWorkspace);

// --- Mock data ---

const PLAN = `## Navigation
- Review main nav bar

## Dashboard
- Check card grid layout`;

const INTRO = 'Test app for UX review.';

const WORK_DISTRIBUTION_RESPONSE = `## Navigation
- Review main nav bar
---CHUNK---
## Dashboard
- Check card grid layout`;

const MOCK_DISCOVERY_I1 = `# Discovery Document - Instance 1

## Round 1

### Navigation Bar
- **Visited**: 2026-04-02T10:00:00.000Z
- **Elements Observed**: Main menu items
- **Checked**: Layout consistency
`;

const MOCK_DISCOVERY_I2 = `# Discovery Document - Instance 2

## Round 1

### Card Grid
- **Visited**: 2026-04-02T10:00:00.000Z
- **Elements Observed**: Dashboard cards
- **Checked**: Spacing
`;

const MOCK_REPORT_I1 = `# UX Report - Instance 1

## I1-UXR-001: Inconsistent hover states on nav items

- **UI Area**: Navigation
- **Severity**: major
- **Description**: Primary and secondary nav items use different hover effects
- **Suggestion**: Standardize hover styles across all nav items
- **Screenshot**: I1-UXR-001.png
`;

const MOCK_REPORT_I2 = `# UX Report - Instance 2

## I2-UXR-001: Card layout breaks at medium breakpoints

- **UI Area**: Dashboard
- **Severity**: major
- **Description**: At medium breakpoints the card grid collapses incorrectly
- **Suggestion**: Fix the CSS grid breakpoint
- **Screenshot**: I2-UXR-001.png
`;

const MOCK_CONSOLIDATED_DISCOVERY = `# Navigation

- Main menu items
  - Checked: Layout consistency

# Dashboard

- Dashboard cards
  - Checked: Spacing`;

// Minimal valid PNG header for dummy screenshots
const DUMMY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- Helpers ---

function createTestDirs() {
  mkdirSync(TEMP_DIR, { recursive: true });
  for (let i = 1; i <= 2; i++) {
    const paths = testInstancePaths(i);
    mkdirSync(paths.dir, { recursive: true });
    mkdirSync(paths.screenshots, { recursive: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'screenshots'), { recursive: true });
}

function writeInstanceFiles() {
  const p1 = testInstancePaths(1);
  writeFileSync(p1.discovery, MOCK_DISCOVERY_I1, 'utf-8');
  writeFileSync(p1.report, MOCK_REPORT_I1, 'utf-8');
  writeFileSync(join(p1.screenshots, 'I1-UXR-001.png'), DUMMY_PNG);

  const p2 = testInstancePaths(2);
  writeFileSync(p2.discovery, MOCK_DISCOVERY_I2, 'utf-8');
  writeFileSync(p2.report, MOCK_REPORT_I2, 'utf-8');
  writeFileSync(join(p2.screenshots, 'I2-UXR-001.png'), DUMMY_PNG);
}

function makeArgs(overrides?: Partial<ParsedArgs>): ParsedArgs {
  return {
    url: 'https://example.com/app',
    intro: INTRO,
    plan: PLAN,
    scope: DEFAULT_SCOPE,
    instances: 2,
    rounds: 1,
    output: OUTPUT_DIR,
    keepTemp: true,
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
 * Set up the runClaude mock for the full consolidation pipeline.
 *
 * Handles:
 * 1. Work distribution
 * 2. Instance analysis (writes mock files as side effects)
 * 3. Deduplication — NO_DUPLICATES (2 findings from different areas)
 * 4. Hierarchy determination per UI area
 * 5. Discovery doc consolidation
 */
function setupRunClaudeMock() {
  mockRunClaude.mockImplementation(async (options) => {
    const prompt = options.prompt;

    // Work distribution
    if (prompt.includes('work distribution assistant')) {
      return {
        stdout: WORK_DISTRIBUTION_RESPONSE,
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // Instance analysis
    if (prompt.includes('You are a UX analyst')) {
      let instanceNum = 0;
      if (prompt.includes('I1-UXR-')) instanceNum = 1;
      else if (prompt.includes('I2-UXR-')) instanceNum = 2;

      if (instanceNum > 0) {
        const paths = testInstancePaths(instanceNum);
        if (instanceNum === 1) {
          writeFileSync(paths.discovery, MOCK_DISCOVERY_I1, 'utf-8');
          writeFileSync(paths.report, MOCK_REPORT_I1, 'utf-8');
          writeFileSync(join(paths.screenshots, 'I1-UXR-001.png'), DUMMY_PNG);
        } else if (instanceNum === 2) {
          writeFileSync(paths.discovery, MOCK_DISCOVERY_I2, 'utf-8');
          writeFileSync(paths.report, MOCK_REPORT_I2, 'utf-8');
          writeFileSync(join(paths.screenshots, 'I2-UXR-001.png'), DUMMY_PNG);
        }
      }
      return { stdout: 'Analysis complete', stderr: '', exitCode: 0, success: true };
    }

    // Deduplication — no duplicates (different areas)
    if (prompt.includes('deduplication assistant')) {
      return {
        stdout: 'NO_DUPLICATES',
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // Hierarchy — no dependencies (single finding per area)
    if (prompt.includes('UX report organizer')) {
      return {
        stdout: 'NO_DEPENDENCIES',
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // Discovery consolidation
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

/**
 * Count how many times runClaude was called with a prompt containing the given text.
 */
function countClaudeCallsMatching(text: string): number {
  return mockRunClaude.mock.calls.filter(
    (call) => call[0].prompt.includes(text),
  ).length;
}

// =============================================================================
// Tests
// =============================================================================

describe('Integration: Consolidation checkpoint resumability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTestDirs();
    writeInstanceFiles();
    mockInitWorkspace.mockReturnValue({
      tempDir: TEMP_DIR,
      instanceDirs: [testInstanceDir(1), testInstanceDir(2)],
      outputDir: OUTPUT_DIR,
    });
    setupRunClaudeMock();
  });

  afterEach(async () => {
    await cleanTestDirs(TEST_BASE);
  });

  // ---------------------------------------------------------------------------
  // 1. Full consolidation produces checkpoints at each step
  // ---------------------------------------------------------------------------

  describe('full consolidation produces checkpoints at each step', () => {
    it('writes a consolidation checkpoint after each consolidation step', async () => {
      const args = makeArgs();
      await orchestrate(args);

      // Verify checkpoint file exists and has all steps completed
      const checkpoint = readConsolidationCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.completedSteps).toEqual(CONSOLIDATION_STEPS);
    });

    it('checkpoint contains dedup output after dedup step', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const checkpoint = readConsolidationCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.dedupOutput).not.toBeNull();

      expect(checkpoint!.dedupOutput!.findings).toBeDefined();
      expect(Array.isArray(checkpoint!.dedupOutput!.findings)).toBe(true);
    });

    it('checkpoint contains reassign output after reassign step', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const checkpoint = readConsolidationCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.reassignOutput).not.toBeNull();

      expect(Array.isArray(checkpoint!.reassignOutput)).toBe(true);
      // Findings should have final UXR-NNN IDs
      expect(checkpoint!.reassignOutput![0].id).toMatch(/^UXR-\d{3}$/);
    });

    it('checkpoint contains hierarchy output after hierarchy step', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const checkpoint = readConsolidationCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.hierarchyOutput).not.toBeNull();

      expect(Array.isArray(checkpoint!.hierarchyOutput)).toBe(true);
      // Should have UI area groups
      expect(checkpoint!.hierarchyOutput![0].area).toBeDefined();
      expect(checkpoint!.hierarchyOutput![0].findings).toBeDefined();
    });

    it('checkpoint contains format-report output after format step', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const checkpoint = readConsolidationCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.formatReportOutput).not.toBeNull();
      expect(checkpoint!.formatReportOutput).toContain('UX Analysis Report');
    });

    it('checkpoint contains discovery-merge output after discovery step', async () => {
      const args = makeArgs();
      await orchestrate(args);

      const checkpoint = readConsolidationCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.discoveryMergeOutput).not.toBeNull();
      expect(checkpoint!.discoveryMergeOutput).toContain('Navigation');
    });

    it('all Claude calls are made during full consolidation', async () => {
      const args = makeArgs();
      await orchestrate(args);

      // Work distribution + dedup + hierarchy (for each area) + discovery merge
      // Dedup: 1 call (deduplication assistant)
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(1);
      // Discovery merge: 1 call (document consolidation assistant)
      expect(countClaudeCallsMatching('document consolidation assistant')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Resume after dedup skips dedup and runs remaining steps
  // ---------------------------------------------------------------------------

  describe('resume after dedup completion', () => {
    it('skips dedup Claude call when checkpoint has dedup completed', async () => {
      // Pre-populate checkpoint with dedup completed
      const dedupResult = {
        findings: [
          {
            id: 'I1-UXR-001',
            title: 'Inconsistent hover states on nav items',
            uiArea: 'Navigation',
            severity: 'major' as const,
            description: 'Primary and secondary nav items use different hover effects',
            suggestion: 'Standardize hover styles across all nav items',
            screenshot: 'I1-UXR-001.png',
          },
          {
            id: 'I2-UXR-001',
            title: 'Card layout breaks at medium breakpoints',
            uiArea: 'Dashboard',
            severity: 'major' as const,
            description: 'At medium breakpoints the card grid collapses incorrectly',
            suggestion: 'Fix the CSS grid breakpoint',
            screenshot: 'I2-UXR-001.png',
          },
        ],
        duplicateGroups: [],
        usedClaude: true,
      };

      const checkpoint: ConsolidationCheckpoint = {
        completedSteps: ['dedup'],
        dedupOutput: dedupResult,
        reassignOutput: null,
        hierarchyOutput: null,
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf-8');

      const args = makeArgs();
      await orchestrate(args);

      // Dedup should NOT be called again
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(0);

      // But hierarchy and discovery merge should still run
      expect(countClaudeCallsMatching('document consolidation assistant')).toBe(1);

      // Final report should still be produced
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const report = readFileSync(reportPath, 'utf-8');
      expect(report).toContain('UXR-001');
      expect(report).toContain('UXR-002');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Resume after hierarchy skips dedup + hierarchy
  // ---------------------------------------------------------------------------

  describe('resume after hierarchy completion', () => {
    it('skips dedup and hierarchy when checkpoint has both completed', async () => {
      // Pre-populate checkpoint with dedup + reassign + hierarchy completed
      const dedupResult = {
        findings: [
          {
            id: 'I1-UXR-001',
            title: 'Hover states',
            uiArea: 'Navigation',
            severity: 'major' as const,
            description: 'Inconsistent hover effects',
            suggestion: 'Standardize hover styles',
            screenshot: 'I1-UXR-001.png',
          },
          {
            id: 'I2-UXR-001',
            title: 'Card layout',
            uiArea: 'Dashboard',
            severity: 'major' as const,
            description: 'Card grid collapses incorrectly',
            suggestion: 'Fix breakpoint',
            screenshot: 'I2-UXR-001.png',
          },
        ],
        duplicateGroups: [],
        usedClaude: true,
      };

      const reassignedFindings = [
        {
          id: 'UXR-001',
          title: 'Hover states',
          uiArea: 'Navigation',
          severity: 'major' as const,
          description: 'Inconsistent hover effects',
          suggestion: 'Standardize hover styles',
          screenshot: 'UXR-001.png',
        },
        {
          id: 'UXR-002',
          title: 'Card layout',
          uiArea: 'Dashboard',
          severity: 'major' as const,
          description: 'Card grid collapses incorrectly',
          suggestion: 'Fix breakpoint',
          screenshot: 'UXR-002.png',
        },
      ];

      const hierarchyGroups = [
        {
          area: 'Navigation',
          findings: [
            { finding: reassignedFindings[0], children: [] },
          ],
        },
        {
          area: 'Dashboard',
          findings: [
            { finding: reassignedFindings[1], children: [] },
          ],
        },
      ];

      const checkpoint: ConsolidationCheckpoint = {
        completedSteps: ['dedup', 'reassign', 'hierarchy'],
        dedupOutput: dedupResult,
        reassignOutput: reassignedFindings,
        hierarchyOutput: hierarchyGroups,
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf-8');

      const args = makeArgs();
      await orchestrate(args);

      // Dedup should NOT be called
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(0);
      // Hierarchy should NOT be called
      expect(countClaudeCallsMatching('UX report organizer')).toBe(0);
      // Discovery merge should still run
      expect(countClaudeCallsMatching('document consolidation assistant')).toBe(1);

      // Final report should be produced from the checkpoint data
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const report = readFileSync(reportPath, 'utf-8');
      expect(report).toContain('# UX Analysis Report');
      expect(report).toContain('UXR-001');
      expect(report).toContain('UXR-002');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Resume after discovery merge writes final output
  // ---------------------------------------------------------------------------

  describe('resume after discovery merge completion', () => {
    it('skips all Claude calls when checkpoint has all steps except write-discovery', async () => {
      const reassignedFindings = [
        {
          id: 'UXR-001',
          title: 'Hover states',
          uiArea: 'Navigation',
          severity: 'major' as const,
          description: 'Inconsistent hover effects',
          suggestion: 'Standardize hover styles',
          screenshot: 'UXR-001.png',
        },
      ];

      const hierarchyGroups = [
        {
          area: 'Navigation',
          findings: [{ finding: reassignedFindings[0], children: [] }],
        },
      ];

      const checkpoint: ConsolidationCheckpoint = {
        completedSteps: ['dedup', 'reassign', 'hierarchy', 'format-report', 'discovery-merge'],
        dedupOutput: { findings: reassignedFindings, duplicateGroups: [], usedClaude: false },
        reassignOutput: reassignedFindings,
        hierarchyOutput: hierarchyGroups,
        formatReportOutput: '# UX Analysis Report\n\n## Navigation\n\n### UXR-001: Hover states\n',
        discoveryMergeOutput: MOCK_CONSOLIDATED_DISCOVERY,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf-8');

      const args = makeArgs();
      await orchestrate(args);

      // No consolidation Claude calls should be made (only work distribution + instance analysis)
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(0);
      expect(countClaudeCallsMatching('UX report organizer')).toBe(0);
      expect(countClaudeCallsMatching('document consolidation assistant')).toBe(0);

      // Discovery file should still be written
      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      expect(existsSync(discoveryPath)).toBe(true);
      const discovery = readFileSync(discoveryPath, 'utf-8');
      expect(discovery).toContain('Navigation');
    });

    it('produces final output when all steps are checkpointed', async () => {
      const reassignedFindings = [
        {
          id: 'UXR-001',
          title: 'Hover states',
          uiArea: 'Navigation',
          severity: 'major' as const,
          description: 'Inconsistent hover effects',
          suggestion: 'Standardize hover styles',
          screenshot: 'UXR-001.png',
        },
      ];

      const hierarchyGroups = [
        {
          area: 'Navigation',
          findings: [{ finding: reassignedFindings[0], children: [] }],
        },
      ];

      // All steps completed including write-discovery
      const checkpoint: ConsolidationCheckpoint = {
        completedSteps: [...CONSOLIDATION_STEPS],
        dedupOutput: { findings: reassignedFindings, duplicateGroups: [], usedClaude: false },
        reassignOutput: reassignedFindings,
        hierarchyOutput: hierarchyGroups,
        formatReportOutput: '# UX Analysis Report\n\n## Navigation\n\n### UXR-001: Hover states\n',
        discoveryMergeOutput: MOCK_CONSOLIDATED_DISCOVERY,
        timestamp: new Date().toISOString(),
      };
      writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf-8');

      const args = makeArgs();
      await orchestrate(args);

      // No consolidation Claude calls at all
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(0);
      expect(countClaudeCallsMatching('UX report organizer')).toBe(0);
      expect(countClaudeCallsMatching('document consolidation assistant')).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Corrupted checkpoint triggers full reconsolidation
  // ---------------------------------------------------------------------------

  describe('corrupted checkpoint triggers full reconsolidation', () => {
    it('runs full consolidation when checkpoint contains invalid JSON', async () => {
      writeFileSync(CHECKPOINT_PATH, 'not valid json {{{', 'utf-8');

      const args = makeArgs();
      await orchestrate(args);

      // All consolidation Claude calls should be made
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(1);
      expect(countClaudeCallsMatching('document consolidation assistant')).toBe(1);

      // Final output should be produced
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const report = readFileSync(reportPath, 'utf-8');
      expect(report).toContain('# UX Analysis Report');
    });

    it('runs full consolidation when checkpoint has unknown step names', async () => {
      writeFileSync(
        CHECKPOINT_PATH,
        JSON.stringify({
          completedSteps: ['dedup', 'bogus-step'],
          dedupOutput: '{}',
          reassignOutput: null,
          hierarchyOutput: null,
          formatReportOutput: null,
          discoveryMergeOutput: null,
          timestamp: new Date().toISOString(),
        }),
        'utf-8',
      );

      const args = makeArgs();
      await orchestrate(args);

      // Should run full consolidation since checkpoint is invalid
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(1);
      expect(countClaudeCallsMatching('document consolidation assistant')).toBe(1);

      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
    });

    it('runs full consolidation when checkpoint is missing required fields', async () => {
      writeFileSync(
        CHECKPOINT_PATH,
        JSON.stringify({ completedSteps: ['dedup'] }), // missing timestamp and other fields
        'utf-8',
      );

      const args = makeArgs();
      await orchestrate(args);

      // Should run full consolidation
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Missing checkpoint triggers full consolidation (normal case)
  // ---------------------------------------------------------------------------

  describe('missing checkpoint triggers full consolidation', () => {
    it('runs full consolidation when no checkpoint file exists', async () => {
      // Ensure no checkpoint file exists
      expect(existsSync(CHECKPOINT_PATH)).toBe(false);

      const args = makeArgs();
      await orchestrate(args);

      // All consolidation Claude calls should be made
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(1);
      expect(countClaudeCallsMatching('document consolidation assistant')).toBe(1);

      // Final output should be produced
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const report = readFileSync(reportPath, 'utf-8');
      expect(report).toContain('# UX Analysis Report');
      expect(report).toContain('UXR-001');
      expect(report).toContain('UXR-002');
    });

    it('creates checkpoint file after full consolidation completes', async () => {
      expect(existsSync(CHECKPOINT_PATH)).toBe(false);

      const args = makeArgs();
      await orchestrate(args);

      // Checkpoint should now exist with all steps completed
      expect(existsSync(CHECKPOINT_PATH)).toBe(true);
      const checkpoint = readConsolidationCheckpoint();
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.completedSteps).toEqual(CONSOLIDATION_STEPS);
    });

    it('produces both report.md and discovery.md output files', async () => {
      const args = makeArgs();
      await orchestrate(args);

      expect(existsSync(join(OUTPUT_DIR, 'report.md'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'discovery.md'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Cross-run resume: initTempDir preserves checkpoint data
  // ---------------------------------------------------------------------------

  describe('cross-run resume: initTempDir preserves checkpoint data', () => {
    // Use vi.importActual to get the real file-manager functions (bypassing
    // the mock) so we can verify that TASK-002a's changes to initTempDir
    // actually preserve checkpoint data when re-initializing the temp dir.
    async function getRealFileManager() {
      return vi.importActual<typeof import('../src/file-manager.js')>('../src/file-manager.js');
    }

    afterEach(async () => {
      try {
        const real = await getRealFileManager();
        await real.cleanupTempDir();
      } catch {
        // Ignore cleanup errors from parallel test file contention on Windows
      }
    });

    it('preserves consolidation checkpoint when initTempDir is called on existing temp dir', { timeout: 30000 }, async () => {
      const real = await getRealFileManager();
      const tempDir = real.getTempDir();

      // Simulate first run: create temp dir with 2 instances
      await real.initTempDir(2);

      // Write a consolidation checkpoint (simulating interrupted run after dedup)
      const checkpoint: ConsolidationCheckpoint = {
        completedSteps: ['dedup'],
        dedupOutput: { findings: [], duplicateGroups: [], usedClaude: true },
        reassignOutput: null,
        hierarchyOutput: null,
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: new Date().toISOString(),
      };
      const cpPath = join(tempDir, 'consolidation-checkpoint.json');
      writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2), 'utf-8');

      // Let Windows release file handles before re-initializing (TOCTTOU mitigation)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify checkpoint data is detected
      expect(real.hasExistingCheckpointData()).toBe(true);

      // Simulate second run (restart): call initTempDir again
      await real.initTempDir(2);

      // Checkpoint file should survive the re-initialization
      expect(existsSync(cpPath)).toBe(true);

      // Checkpoint content should be intact
      const preserved = JSON.parse(readFileSync(cpPath, 'utf-8'));
      expect(preserved.completedSteps).toEqual(['dedup']);
      expect(preserved.dedupOutput).not.toBeNull();
    });

    it('preserves instance checkpoint files when initTempDir is called on existing temp dir', { timeout: 30000 }, async () => {
      const real = await getRealFileManager();
      const tempDir = real.getTempDir();

      // First run: create temp dir with instances
      await real.initTempDir(2);

      // Write an instance checkpoint (simulating completed instance work)
      const instanceCpPath = join(tempDir, 'instance-1', 'checkpoint.json');
      writeFileSync(instanceCpPath, JSON.stringify({ items: ['item-a'], completed: true }), 'utf-8');

      // Checkpoint data should be detected (instance checkpoint counts)
      expect(real.hasExistingCheckpointData()).toBe(true);

      // Second run: initTempDir again
      await real.initTempDir(2);

      // Instance checkpoint should survive
      expect(existsSync(instanceCpPath)).toBe(true);
      const preserved = JSON.parse(readFileSync(instanceCpPath, 'utf-8'));
      expect(preserved.items).toEqual(['item-a']);
      expect(preserved.completed).toBe(true);
    });

    it('cleans temp dir normally when no checkpoint data exists', { timeout: 30000 }, async () => {
      const real = await getRealFileManager();
      const tempDir = real.getTempDir();

      // First run: create temp dir with a non-checkpoint file
      await real.initTempDir(2);
      const stalePath = join(tempDir, 'instance-1', 'stale-file.txt');
      writeFileSync(stalePath, 'old data', 'utf-8');

      // No checkpoint data exists
      expect(real.hasExistingCheckpointData()).toBe(false);

      // Second run: should clean the temp dir (no checkpoints to preserve)
      await real.initTempDir(1);

      // Stale file should be gone (directory was cleaned and recreated)
      expect(existsSync(stalePath)).toBe(false);
      // instance-2 should not exist since we only asked for 1 instance
      expect(existsSync(join(tempDir, 'instance-2'))).toBe(false);
      // instance-1 should exist (freshly created)
      expect(existsSync(join(tempDir, 'instance-1'))).toBe(true);
    });

    it('checkpoint survives initWorkspace and orchestrator resumes from correct step', { timeout: 30000 }, async () => {
      const real = await getRealFileManager();
      const tempDir = real.getTempDir();

      // Simulate first run: create temp dir and write a partial checkpoint
      await real.initTempDir(2);

      const dedupResult = {
        findings: [
          {
            id: 'I1-UXR-001',
            title: 'Hover states',
            uiArea: 'Navigation',
            severity: 'major' as const,
            description: 'Inconsistent hover effects',
            suggestion: 'Standardize',
            screenshot: 'I1-UXR-001.png',
          },
        ],
        duplicateGroups: [],
        usedClaude: true,
      };

      const checkpoint: ConsolidationCheckpoint = {
        completedSteps: ['dedup'],
        dedupOutput: dedupResult,
        reassignOutput: null,
        hierarchyOutput: null,
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: new Date().toISOString(),
      };
      const cpPath = join(tempDir, 'consolidation-checkpoint.json');
      writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2), 'utf-8');

      // Simulate second run: initTempDir preserves checkpoint
      await real.initTempDir(2);
      expect(existsSync(cpPath)).toBe(true);

      // Now configure mocks for orchestrate to use the test directory.
      // The orchestrator reads the checkpoint via the mocked getTempDir
      // (which points to TEST_BASE's temp dir), so copy the checkpoint there too.
      writeFileSync(CHECKPOINT_PATH, readFileSync(cpPath, 'utf-8'), 'utf-8');

      const args = makeArgs();
      await orchestrate(args);

      // Dedup should be skipped (resumed from checkpoint)
      expect(countClaudeCallsMatching('deduplication assistant')).toBe(0);

      // Discovery merge should still run (not in checkpoint)
      expect(countClaudeCallsMatching('document consolidation assistant')).toBe(1);

      // Final report should be produced
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const report = readFileSync(reportPath, 'utf-8');
      expect(report).toContain('UXR-001');
    });
  });
});
