import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// --- Test-isolated directory structure ---
const TEST_BASE = resolve('.uxreview-integ-failure-test');
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

// Mock the sleep function to avoid real delays in tests
vi.mock('../src/rate-limit.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/rate-limit.js')>();
  return {
    ...original,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

// --- Imports (after mocks are declared) ---
import { runClaude } from '../src/claude-cli.js';
import { initWorkspace } from '../src/file-manager.js';
import { orchestrate } from '../src/orchestrator.js';
import { ParsedArgs } from '../src/cli.js';
import { DEFAULT_SCOPE } from '../src/default-scope.js';
import { ProgressDisplay } from '../src/progress-display.js';
import { Checkpoint } from '../src/checkpoint.js';

const mockRunClaude = vi.mocked(runClaude);
const mockInitWorkspace = vi.mocked(initWorkspace);

// --- Mock data ---

const PLAN = `## Navigation
- Review main nav bar
- Check breadcrumb trail

## Dashboard
- Check card grid layout
- Verify empty states`;

const INTRO = 'Test app for UX review. Login at https://example.com with admin/admin.';

const MOCK_DISCOVERY = `# Discovery Document - Instance 1

## Round 1

### Navigation Bar
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home → Navigation Bar
- **Elements Observed**:
  - Main menu items
  - Logo
- **Checked**:
  - Layout consistency

### Dashboard
- **Visited**: 2026-04-02T10:05:00.000Z
- **Navigation Path**: Home → Dashboard
- **Elements Observed**:
  - Card grid
  - Widgets
- **Checked**:
  - Layout consistency
`;

const MOCK_REPORT = `# UX Report - Instance 1

## I1-UXR-001: Inconsistent button styles in navigation

- **UI Area**: Navigation
- **Severity**: major
- **Description**: Primary and secondary nav buttons use different padding
- **Suggestion**: Standardize button styles
- **Screenshot**: I1-UXR-001.png

## I1-UXR-002: Dashboard cards have inconsistent spacing

- **UI Area**: Dashboard
- **Severity**: minor
- **Description**: Card grid has uneven gaps between cards
- **Suggestion**: Use CSS grid with consistent gap values
- **Screenshot**: I1-UXR-002.png
`;

const MOCK_CONSOLIDATED_DISCOVERY = `# Navigation

- Main menu items
  - Checked: Layout consistency

# Dashboard

- Card grid
  - Checked: Layout consistency`;

const DUMMY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- Helpers ---

function createTestDirs(instanceCount = 1) {
  mkdirSync(TEMP_DIR, { recursive: true });
  for (let i = 1; i <= instanceCount; i++) {
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
    ...overrides,
  };
}

/**
 * Write mock output files that a successful instance would produce.
 */
function writeMockInstanceOutput(instanceNumber: number) {
  const paths = testInstancePaths(instanceNumber);
  writeFileSync(paths.discovery, MOCK_DISCOVERY, 'utf-8');
  writeFileSync(paths.report, MOCK_REPORT.replace(/I1/g, `I${instanceNumber}`), 'utf-8');
  writeFileSync(join(paths.screenshots, `I${instanceNumber}-UXR-001.png`), DUMMY_PNG);
  writeFileSync(join(paths.screenshots, `I${instanceNumber}-UXR-002.png`), DUMMY_PNG);
}

// =============================================================================
// Tests
// =============================================================================

describe('Integration: Failure, retry, and resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTestDirs();
    mockInitWorkspace.mockReturnValue({
      tempDir: TEMP_DIR,
      instanceDirs: [testInstanceDir(1)],
      outputDir: OUTPUT_DIR,
    });
  });

  afterEach(() => {
    cleanTestDirs();
  });

  // ---------------------------------------------------------------------------
  // Mid-area crash with checkpoint resume
  // ---------------------------------------------------------------------------

  describe('mid-area crash with checkpoint resume', () => {
    it('detects crash, reads checkpoint, resumes from last state, and produces final output', async () => {
      let callCount = 0;
      const checkpointPath = testInstancePaths(1).checkpoint;

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        // Instance analysis calls
        if (prompt.includes('You are a UX analyst')) {
          callCount++;

          if (callCount === 1) {
            // First attempt: simulate partial progress then crash
            // Write checkpoint showing Navigation complete, Dashboard in-progress
            const midCheckpoint: Checkpoint = {
              instanceId: 1,
              assignedAreas: ['Navigation', 'Dashboard'],
              currentRound: 1,
              areas: [
                { name: 'Navigation', status: 'complete' },
                { name: 'Dashboard', status: 'in-progress' },
              ],
              lastAction: 'Checked card grid spacing',
              timestamp: '2026-04-02T10:05:00.000Z',
            };
            writeFileSync(checkpointPath, JSON.stringify(midCheckpoint, null, 2), 'utf-8');
            return { stdout: '', stderr: 'MCP connection lost', exitCode: 1, success: false };
          }

          // Second attempt (retry with resume): verify it contains resume instructions then succeed
          writeMockInstanceOutput(1);
          return { stdout: 'Analysis complete', stderr: '', exitCode: 0, success: true };
        }

        // Hierarchy determination
        if (prompt.includes('UX report organizer')) {
          return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
        }

        // Discovery consolidation
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }

        return { stdout: '', stderr: 'Unexpected call', exitCode: 1, success: false };
      });

      const args = makeArgs();
      await orchestrate(args);

      // --- Verify retry prompt contained resume instructions ---
      const analysisCalls = mockRunClaude.mock.calls.filter(
        (call) => call[0].prompt.includes('You are a UX analyst'),
      );
      expect(analysisCalls).toHaveLength(2);

      const retryPrompt = analysisCalls[1][0].prompt;
      expect(retryPrompt).toContain('Resume Instructions');
      expect(retryPrompt).toContain('Completed Areas (skip these)');
      expect(retryPrompt).toContain('Navigation');
      expect(retryPrompt).toContain('In-Progress Areas (resume here)');
      expect(retryPrompt).toContain('Dashboard');
      expect(retryPrompt).toContain('Checked card grid spacing');

      // --- Verify final consolidated output was produced ---
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const reportContent = readFileSync(reportPath, 'utf-8');
      expect(reportContent).toContain('UXR-001');
      expect(reportContent).toContain('UXR-002');

      const discoveryPath = join(OUTPUT_DIR, 'discovery.md');
      expect(existsSync(discoveryPath)).toBe(true);

      // Screenshots should be copied and renamed
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001.png'))).toBe(true);
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-002.png'))).toBe(true);
    });

    it('progress display shows failure then running after successful retry', async () => {
      let callCount = 0;
      const checkpointPath = testInstancePaths(1).checkpoint;

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          callCount++;
          if (callCount === 1) {
            const midCheckpoint: Checkpoint = {
              instanceId: 1,
              assignedAreas: ['Navigation', 'Dashboard'],
              currentRound: 1,
              areas: [
                { name: 'Navigation', status: 'complete' },
                { name: 'Dashboard', status: 'in-progress' },
              ],
              lastAction: 'Reviewing dashboard widgets',
              timestamp: '2026-04-02T10:05:00.000Z',
            };
            writeFileSync(checkpointPath, JSON.stringify(midCheckpoint, null, 2), 'utf-8');
            return { stdout: '', stderr: 'Instance crashed', exitCode: 1, success: false };
          }
          writeMockInstanceOutput(1);
          return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('UX report organizer')) {
          return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(makeArgs());

      // markFailed should have been called with the error
      expect(mockProgressDisplay.markFailed).toHaveBeenCalledWith(1, 'Instance crashed');

      // markRetrying should have been called
      expect(mockProgressDisplay.markRetrying).toHaveBeenCalledWith(1, 1, 3);

      // markRunning should have been called after retry succeeded (via onRetrySuccess -> markRunning)
      expect(mockProgressDisplay.markRunning).toHaveBeenCalled();

      // markCompleted should have been called at the end
      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(1);

      // Output should still be produced (single instance skips consolidation display)
      expect(mockProgressDisplay.completeConsolidation).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Missing checkpoint — restart round
  // ---------------------------------------------------------------------------

  describe('missing checkpoint restart', () => {
    it('restarts round from scratch when checkpoint file is missing on retry', async () => {
      let callCount = 0;
      const checkpointPath = testInstancePaths(1).checkpoint;

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          callCount++;
          if (callCount === 1) {
            // Crash early — delete the checkpoint to simulate it never being written by Claude
            if (existsSync(checkpointPath)) {
              rmSync(checkpointPath);
            }
            return { stdout: '', stderr: 'Early crash before any work', exitCode: 1, success: false };
          }
          // Retry: should be fresh start (no resume prompt)
          writeMockInstanceOutput(1);
          return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('UX report organizer')) {
          return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(makeArgs());

      // Verify the retry was a fresh start (no resume instructions)
      const analysisCalls = mockRunClaude.mock.calls.filter(
        (call) => call[0].prompt.includes('You are a UX analyst'),
      );
      expect(analysisCalls).toHaveLength(2);
      const retryPrompt = analysisCalls[1][0].prompt;
      expect(retryPrompt).not.toContain('Resume Instructions');
      expect(retryPrompt).not.toContain('Completed Areas (skip these)');

      // A fresh checkpoint should have been written before the retry
      expect(existsSync(checkpointPath)).toBe(true);
      const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
      expect(checkpoint.areas.every((a: { status: string }) => a.status === 'not-started')).toBe(true);

      // Final output should still be produced
      expect(existsSync(join(OUTPUT_DIR, 'report.md'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Corrupted checkpoint — restart round
  // ---------------------------------------------------------------------------

  describe('corrupted checkpoint restart', () => {
    it('restarts round from scratch when checkpoint is corrupted JSON', async () => {
      let callCount = 0;
      const checkpointPath = testInstancePaths(1).checkpoint;

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          callCount++;
          if (callCount === 1) {
            // Write corrupted checkpoint
            writeFileSync(checkpointPath, '{{{{not json at all!!!!', 'utf-8');
            return { stdout: '', stderr: 'Crash with corrupted state', exitCode: 1, success: false };
          }
          writeMockInstanceOutput(1);
          return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('UX report organizer')) {
          return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(makeArgs());

      // Verify fresh start (no resume)
      const analysisCalls = mockRunClaude.mock.calls.filter(
        (call) => call[0].prompt.includes('You are a UX analyst'),
      );
      expect(analysisCalls).toHaveLength(2);
      expect(analysisCalls[1][0].prompt).not.toContain('Resume Instructions');

      // Final output should still be produced
      expect(existsSync(join(OUTPUT_DIR, 'report.md'))).toBe(true);
    });

    it('restarts round when checkpoint has valid JSON but invalid structure', async () => {
      let callCount = 0;
      const checkpointPath = testInstancePaths(1).checkpoint;

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          callCount++;
          if (callCount === 1) {
            // Write checkpoint with missing required fields
            writeFileSync(checkpointPath, JSON.stringify({ instanceId: 1, someOtherField: true }), 'utf-8');
            return { stdout: '', stderr: 'Crash', exitCode: 1, success: false };
          }
          writeMockInstanceOutput(1);
          return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('UX report organizer')) {
          return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(makeArgs());

      const analysisCalls = mockRunClaude.mock.calls.filter(
        (call) => call[0].prompt.includes('You are a UX analyst'),
      );
      expect(analysisCalls).toHaveLength(2);
      expect(analysisCalls[1][0].prompt).not.toContain('Resume Instructions');
      expect(existsSync(join(OUTPUT_DIR, 'report.md'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Max retry limit exceeded — permanently failed
  // ---------------------------------------------------------------------------

  describe('max retry exceeded', () => {
    it('marks instance as permanently failed after exhausting retries', async () => {
      // All analysis calls fail persistently
      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          return { stdout: '', stderr: 'Persistent failure', exitCode: 1, success: false };
        }
        // Consolidation calls — these still happen for whatever partial output exists
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: '', stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      const args = makeArgs();
      await orchestrate(args);

      // 1 initial + 3 retries (DEFAULT_MAX_RETRIES=3) = 4 analysis calls
      const analysisCalls = mockRunClaude.mock.calls.filter(
        (call) => call[0].prompt.includes('You are a UX analyst'),
      );
      expect(analysisCalls).toHaveLength(4);

      // Progress display should show: failed, then retrying x3, then permanently failed
      expect(mockProgressDisplay.markFailed).toHaveBeenCalledWith(1, 'Persistent failure');
      expect(mockProgressDisplay.markRetrying).toHaveBeenCalledTimes(3);
      expect(mockProgressDisplay.markRetrying).toHaveBeenCalledWith(1, 1, 3);
      expect(mockProgressDisplay.markRetrying).toHaveBeenCalledWith(1, 2, 3);
      expect(mockProgressDisplay.markRetrying).toHaveBeenCalledWith(1, 3, 3);
      expect(mockProgressDisplay.markPermanentlyFailed).toHaveBeenCalledWith(1, 'Persistent failure');

      // markCompleted should NOT have been called
      expect(mockProgressDisplay.markCompleted).not.toHaveBeenCalled();

      // Output should still be produced (single instance skips consolidation display)
      expect(mockProgressDisplay.completeConsolidation).toHaveBeenCalledTimes(1);
    });

    it('produces consolidated output from partial results when instance fails permanently', async () => {
      let callCount = 0;
      const paths = testInstancePaths(1);

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          callCount++;
          if (callCount === 1) {
            // First attempt: write partial report/discovery before crashing
            writeFileSync(paths.discovery, MOCK_DISCOVERY, 'utf-8');
            writeFileSync(paths.report, `# UX Report - Instance 1

## I1-UXR-001: Inconsistent button styles in navigation

- **UI Area**: Navigation
- **Severity**: major
- **Description**: Primary and secondary nav buttons use different padding
- **Suggestion**: Standardize button styles
- **Screenshot**: I1-UXR-001.png
`, 'utf-8');
            writeFileSync(join(paths.screenshots, 'I1-UXR-001.png'), DUMMY_PNG);
          }
          // All attempts fail
          return { stdout: '', stderr: 'Persistent failure', exitCode: 1, success: false };
        }
        if (prompt.includes('UX report organizer')) {
          return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(makeArgs());

      // The consolidated report should contain findings from the partial output
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const reportContent = readFileSync(reportPath, 'utf-8');
      expect(reportContent).toContain('UXR-001');
      // Only one finding from partial output
      expect(reportContent).not.toContain('UXR-002');

      // Screenshot from partial output should be remapped
      expect(existsSync(join(OUTPUT_DIR, 'screenshots', 'UXR-001.png'))).toBe(true);
    });

    it('completes consolidation even when all instances fail permanently', async () => {
      createTestDirs(2);
      mockInitWorkspace.mockReturnValue({
        tempDir: TEMP_DIR,
        instanceDirs: [testInstanceDir(1), testInstanceDir(2)],
        outputDir: OUTPUT_DIR,
      });

      // All analysis calls fail for both instances
      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          return { stdout: '', stderr: 'Total failure', exitCode: 1, success: false };
        }
        if (prompt.includes('work distribution')) {
          return {
            stdout: `## Navigation\n- Review nav\n---CHUNK---\n## Dashboard\n- Check cards`,
            stderr: '',
            exitCode: 0,
            success: true,
          };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: '', stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      const args = makeArgs({ instances: 2 });
      await orchestrate(args);

      // Both instances should be permanently failed
      expect(mockProgressDisplay.markPermanentlyFailed).toHaveBeenCalledTimes(2);

      // Consolidation should still happen (producing empty output is fine)
      expect(mockProgressDisplay.startConsolidation).toHaveBeenCalledTimes(1);
      expect(mockProgressDisplay.completeConsolidation).toHaveBeenCalledTimes(1);

      // Report should still be written (even if empty)
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Progress display during failure/retry/permanent failure
  // ---------------------------------------------------------------------------

  describe('progress display during failure, retry, and permanent failure', () => {
    it('follows correct color state sequence: running → failed (red) → retrying (red) → running (white) → completed (green)', async () => {
      let callCount = 0;
      const checkpointPath = testInstancePaths(1).checkpoint;
      const callOrder: string[] = [];

      // Track order of progress display calls
      mockProgressDisplay.markRunning.mockImplementation(() => { callOrder.push('running'); });
      mockProgressDisplay.markFailed.mockImplementation(() => { callOrder.push('failed'); });
      mockProgressDisplay.markRetrying.mockImplementation(() => { callOrder.push('retrying'); });
      mockProgressDisplay.markCompleted.mockImplementation(() => { callOrder.push('completed'); });

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          callCount++;
          if (callCount === 1) {
            const midCheckpoint: Checkpoint = {
              instanceId: 1,
              assignedAreas: ['Navigation', 'Dashboard'],
              currentRound: 1,
              areas: [
                { name: 'Navigation', status: 'complete' },
                { name: 'Dashboard', status: 'in-progress' },
              ],
              lastAction: 'Reviewing card spacing',
              timestamp: '2026-04-02T10:05:00.000Z',
            };
            writeFileSync(checkpointPath, JSON.stringify(midCheckpoint, null, 2), 'utf-8');
            return { stdout: '', stderr: 'Connection dropped', exitCode: 1, success: false };
          }
          writeMockInstanceOutput(1);
          return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('UX report organizer')) {
          return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(makeArgs());

      // Verify the state transitions happened in order
      // running (round start) → failed → retrying → running (retry success) → completed
      expect(callOrder).toEqual([
        'running',   // onRoundStart
        'failed',    // onFailure
        'retrying',  // onRetry
        'running',   // onRetrySuccess
        'completed', // onCompleted
      ]);
    });

    it('follows correct state sequence for permanent failure: running → failed → retrying×3 → permanently failed', async () => {
      const callOrder: string[] = [];

      mockProgressDisplay.markRunning.mockImplementation(() => { callOrder.push('running'); });
      mockProgressDisplay.markFailed.mockImplementation(() => { callOrder.push('failed'); });
      mockProgressDisplay.markRetrying.mockImplementation(() => { callOrder.push('retrying'); });
      mockProgressDisplay.markPermanentlyFailed.mockImplementation(() => { callOrder.push('permanently-failed'); });
      mockProgressDisplay.markCompleted.mockImplementation(() => { callOrder.push('completed'); });

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          return { stdout: '', stderr: 'Persistent error', exitCode: 1, success: false };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: '', stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(makeArgs());

      // running (round start) → failed → retrying × 3 → permanently-failed
      expect(callOrder).toEqual([
        'running',            // onRoundStart
        'failed',             // onFailure (initial failure)
        'retrying',           // onRetry attempt 1
        'retrying',           // onRetry attempt 2
        'retrying',           // onRetry attempt 3
        'permanently-failed', // onPermanentlyFailed (retries exhausted)
      ]);

      // markCompleted should NOT appear
      expect(callOrder).not.toContain('completed');
    });

    it('markFailed is called with the actual error message from the crash', async () => {
      let callCount = 0;

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          callCount++;
          if (callCount === 1) {
            return { stdout: '', stderr: 'Specific MCP timeout after 30000ms', exitCode: 1, success: false };
          }
          writeMockInstanceOutput(1);
          return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('UX report organizer')) {
          return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(makeArgs());

      expect(mockProgressDisplay.markFailed).toHaveBeenCalledWith(1, 'Specific MCP timeout after 30000ms');
    });

    it('markPermanentlyFailed shows the last error from failed retries', async () => {
      let callCount = 0;

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          callCount++;
          const errors = ['Error 1', 'Error 2', 'Error 3', 'Final fatal error'];
          return {
            stdout: '',
            stderr: errors[callCount - 1] || 'Unknown',
            exitCode: 1,
            success: false,
          };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: '', stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      await orchestrate(makeArgs());

      // The permanent failure message should be the last error
      expect(mockProgressDisplay.markPermanentlyFailed).toHaveBeenCalledWith(1, 'Final fatal error');
    });
  });

  // ---------------------------------------------------------------------------
  // Multi-instance: one fails, others succeed
  // ---------------------------------------------------------------------------

  describe('multi-instance with mixed success/failure', () => {
    it('continues other instances when one fails permanently', async () => {
      createTestDirs(2);
      mockInitWorkspace.mockReturnValue({
        tempDir: TEMP_DIR,
        instanceDirs: [testInstanceDir(1), testInstanceDir(2)],
        outputDir: OUTPUT_DIR,
      });

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        // Work distribution
        if (prompt.includes('work distribution')) {
          return {
            stdout: `## Navigation\n- Review nav\n---CHUNK---\n## Dashboard\n- Check cards`,
            stderr: '',
            exitCode: 0,
            success: true,
          };
        }

        if (prompt.includes('You are a UX analyst')) {
          // Instance 1 always fails
          if (options.cwd === testInstanceDir(1)) {
            return { stdout: '', stderr: 'Instance 1 failure', exitCode: 1, success: false };
          }
          // Instance 2 succeeds
          if (options.cwd === testInstanceDir(2)) {
            writeMockInstanceOutput(2);
            return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
          }
        }

        if (prompt.includes('UX report organizer')) {
          return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
        }

        if (prompt.includes('document consolidation assistant')) {
          return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
        }

        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      const args = makeArgs({ instances: 2 });
      await orchestrate(args);

      // Instance 1 permanently failed
      expect(mockProgressDisplay.markPermanentlyFailed).toHaveBeenCalledWith(1, 'Instance 1 failure');

      // Instance 2 completed
      expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(2);

      // Consolidation happened with instance 2's output
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const reportContent = readFileSync(reportPath, 'utf-8');
      expect(reportContent).toContain('UXR-001');
    });
  });
});
