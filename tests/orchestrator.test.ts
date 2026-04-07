import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractAreasFromPlanChunk } from '../src/orchestrator.js';

// --- Mocks ---

// Mock work-distribution
vi.mock('../src/work-distribution.js', () => ({
  distributePlan: vi.fn(),
}));

// Mock instance-manager
vi.mock('../src/instance-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/instance-manager.js')>();
  return {
    ...original,
    runInstanceRounds: vi.fn(),
    killAllChildProcesses: vi.fn(),
  };
});

// Mock consolidation
vi.mock('../src/consolidation.js', () => ({
  consolidateReports: vi.fn(),
  reassignAndRemapScreenshots: vi.fn(),
  organizeHierarchically: vi.fn(),
  formatConsolidatedReport: vi.fn(),
  consolidateDiscoveryDocs: vi.fn(),
  writeConsolidatedDiscovery: vi.fn(),
  parseExistingReportIds: vi.fn().mockReturnValue({ maxId: 0, success: true }),
}));

// Mock file-manager
vi.mock('../src/file-manager.js', () => ({
  initWorkspace: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
  getInstancePaths: vi.fn((n: number) => {
    const dir = join(resolve('.uxreview-temp-orch-test'), `instance-${n}`);
    return {
      dir,
      discovery: join(dir, 'discovery.md'),
      checkpoint: join(dir, 'checkpoint.json'),
      report: join(dir, 'report.md'),
      screenshots: join(dir, 'screenshots'),
    };
  }),
}));

// Mock progress-display with a spy-able class
const mockProgressDisplay = {
  start: vi.fn(),
  stop: vi.fn(),
  markRunning: vi.fn(),
  markCompleted: vi.fn(),
  markFailed: vi.fn(),
  markRetrying: vi.fn(),
  markPermanentlyFailed: vi.fn(),
  markRoundComplete: vi.fn(),
  startConsolidation: vi.fn(),
  completeConsolidation: vi.fn(),
  renderToTerminal: vi.fn(),
  updateProgress: vi.fn(),
};

vi.mock('../src/progress-display.js', () => ({
  ProgressDisplay: vi.fn().mockImplementation(() => mockProgressDisplay),
}));

// Mock logger
const mockSetVerbose = vi.fn();
const mockDebug = vi.fn();
vi.mock('../src/logger.js', () => ({
  setVerbose: (...args: unknown[]) => mockSetVerbose(...args),
  debug: (...args: unknown[]) => mockDebug(...args),
}));

// Mock consolidation-checkpoint
vi.mock('../src/consolidation-checkpoint.js', () => ({
  readConsolidationCheckpoint: vi.fn(),
  writeConsolidationCheckpoint: vi.fn(),
  createEmptyConsolidationCheckpoint: vi.fn(),
  isStepCompleted: vi.fn(),
}));

// Mock html-report
vi.mock('../src/html-report.js', () => ({
  formatHtmlReport: vi.fn(),
}));

// Import mocked modules
import { distributePlan } from '../src/work-distribution.js';
import { runInstanceRounds, RoundExecutionResult, killAllChildProcesses } from '../src/instance-manager.js';
import {
  consolidateReports,
  reassignAndRemapScreenshots,
  organizeHierarchically,
  formatConsolidatedReport,
  consolidateDiscoveryDocs,
  writeConsolidatedDiscovery,
} from '../src/consolidation.js';
import { initWorkspace, cleanupTempDir } from '../src/file-manager.js';
import { ProgressDisplay } from '../src/progress-display.js';
import { formatHtmlReport } from '../src/html-report.js';
import { orchestrate } from '../src/orchestrator.js';
import { ParsedArgs } from '../src/cli.js';
import {
  readConsolidationCheckpoint,
  writeConsolidationCheckpoint,
  createEmptyConsolidationCheckpoint,
  isStepCompleted,
  ConsolidationCheckpoint,
} from '../src/consolidation-checkpoint.js';

const mockDistributePlan = vi.mocked(distributePlan);
const mockRunInstanceRounds = vi.mocked(runInstanceRounds);
const mockKillAllChildProcesses = vi.mocked(killAllChildProcesses);
const mockConsolidateReports = vi.mocked(consolidateReports);
const mockReassignAndRemap = vi.mocked(reassignAndRemapScreenshots);
const mockOrganizeHierarchically = vi.mocked(organizeHierarchically);
const mockFormatConsolidatedReport = vi.mocked(formatConsolidatedReport);
const mockConsolidateDiscoveryDocs = vi.mocked(consolidateDiscoveryDocs);
const mockWriteConsolidatedDiscovery = vi.mocked(writeConsolidatedDiscovery);
const mockInitWorkspace = vi.mocked(initWorkspace);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockFormatHtmlReport = vi.mocked(formatHtmlReport);
const mockReadConsolidationCheckpoint = vi.mocked(readConsolidationCheckpoint);
const mockWriteConsolidationCheckpoint = vi.mocked(writeConsolidationCheckpoint);
const mockCreateEmptyConsolidationCheckpoint = vi.mocked(createEmptyConsolidationCheckpoint);
const mockIsStepCompleted = vi.mocked(isStepCompleted);

const OUTPUT_DIR = resolve('.uxreview-output-orch-test');

function makeArgs(overrides?: Partial<ParsedArgs>): ParsedArgs {
  return {
    url: 'https://example.com/app',
    intro: 'Test application context',
    plan: '## Navigation\n- Review nav bar\n\n## Dashboard\n- Check widgets\n\n## Settings\n- Check form fields',
    scope: 'Check layout and consistency',
    instances: 3,
    rounds: 2,
    output: OUTPUT_DIR,
    format: 'markdown',
    keepTemp: false,
    append: false,
    verbose: false,
    maxRetries: 3,
    instanceTimeout: 30,
    rateLimitRetries: 10,
    ...overrides,
  };
}

function makeSuccessResult(instanceNumber: number, totalRounds: number): RoundExecutionResult {
  return {
    instanceNumber,
    status: 'completed',
    roundResults: Array.from({ length: totalRounds }, () => ({
      instanceNumber,
      status: 'completed' as const,
    })),
    completedRounds: totalRounds,
    retries: [],
  };
}

function makeFailedResult(instanceNumber: number, error: string): RoundExecutionResult {
  return {
    instanceNumber,
    status: 'failed',
    roundResults: [{ instanceNumber, status: 'failed' as const, error }],
    completedRounds: 0,
    error,
    retries: [{ round: 1, attempts: 3, succeeded: false, errors: [error] }],
    permanentlyFailed: true,
  };
}

describe('extractAreasFromPlanChunk', () => {
  it('extracts ## headings', () => {
    const chunk = '## Navigation\n- Review nav bar\n\n## Dashboard\n- Check widgets';
    expect(extractAreasFromPlanChunk(chunk)).toEqual(['Navigation', 'Dashboard']);
  });

  it('extracts # headings when no ## found', () => {
    const chunk = '# Forms\n- Check validation\n\n# Settings\n- Check toggles';
    expect(extractAreasFromPlanChunk(chunk)).toEqual(['Forms', 'Settings']);
  });

  it('extracts list items when no headings found', () => {
    const chunk = '- Navigation review\n- Dashboard review\n- Settings review';
    expect(extractAreasFromPlanChunk(chunk)).toEqual([
      'Navigation review',
      'Dashboard review',
      'Settings review',
    ]);
  });

  it('returns generic area when nothing found', () => {
    const chunk = 'Just some plain text about the app review';
    expect(extractAreasFromPlanChunk(chunk)).toEqual(['Full review']);
  });

  it('handles * list items', () => {
    const chunk = '* Navigation\n* Dashboard';
    expect(extractAreasFromPlanChunk(chunk)).toEqual(['Navigation', 'Dashboard']);
  });
});

describe('orchestrate', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Create output directory for writeFileSync
    mkdirSync(OUTPUT_DIR, { recursive: true });

    // Default checkpoint mock: no existing checkpoint, all steps not completed
    mockReadConsolidationCheckpoint.mockReturnValue(null);
    mockCreateEmptyConsolidationCheckpoint.mockReturnValue({
      completedSteps: [],
      dedupOutput: null,
      reassignOutput: null,
      hierarchyOutput: null,
      formatReportOutput: null,
      discoveryMergeOutput: null,
      timestamp: new Date().toISOString(),
    });
    mockIsStepCompleted.mockReturnValue(false);

    // Default mock setup
    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-orch-test'),
      instanceDirs: [
        join(resolve('.uxreview-temp-orch-test'), 'instance-1'),
        join(resolve('.uxreview-temp-orch-test'), 'instance-2'),
        join(resolve('.uxreview-temp-orch-test'), 'instance-3'),
      ],
      outputDir: OUTPUT_DIR,
    });
  });

  afterEach(() => {
    if (existsSync(OUTPUT_DIR)) {
      rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  it('runs 3 instances in parallel with 2 rounds each', async () => {
    const args = makeArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: [
        '## Navigation\n- Review nav bar',
        '## Dashboard\n- Check widgets',
        '## Settings\n- Check form fields',
      ],
      usedClaude: true,
    });

    // Track call order to verify parallel execution
    const callOrder: number[] = [];
    mockRunInstanceRounds.mockImplementation(async (config) => {
      callOrder.push(config.instanceNumber);
      // Simulate varying completion times
      await new Promise((r) => setTimeout(r, 10 * config.instanceNumber));
      // Invoke progress callbacks to verify they're wired
      config.progress?.onRoundStart?.(config.instanceNumber, 1);
      config.progress?.onRoundComplete?.(config.instanceNumber, 1, 1000);
      config.progress?.onRoundStart?.(config.instanceNumber, 2);
      config.progress?.onRoundComplete?.(config.instanceNumber, 2, 1500);
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('# UX Analysis Report\n');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '# Discovery\n',
      instanceCount: 3,
      usedClaude: true,
    });

    await orchestrate(args);

    // Verify work distribution was called with 3 instances
    expect(mockDistributePlan).toHaveBeenCalledWith(args.plan, 3);

    // Verify all 3 instances were spawned
    expect(mockRunInstanceRounds).toHaveBeenCalledTimes(3);

    // Verify each instance received the correct config
    for (let i = 0; i < 3; i++) {
      const call = mockRunInstanceRounds.mock.calls[i][0];
      expect(call.instanceNumber).toBe(i + 1);
      expect(call.url).toBe(args.url);
      expect(call.intro).toBe(args.intro);
      expect(call.scope).toBe(args.scope);
      expect(call.totalRounds).toBe(2);
      expect(call.progress).toBeDefined();
    }

    // Verify all 3 were launched (all should appear in callOrder)
    expect(callOrder).toHaveLength(3);
    expect(callOrder).toContain(1);
    expect(callOrder).toContain(2);
    expect(callOrder).toContain(3);

    // Verify progress display was started and stopped
    expect(mockProgressDisplay.start).toHaveBeenCalledTimes(1);
    expect(mockProgressDisplay.stop).toHaveBeenCalledTimes(1);

    // Verify progress callbacks were invoked (3 instances x completed)
    expect(mockProgressDisplay.markCompleted).toHaveBeenCalledTimes(3);
    expect(mockProgressDisplay.markRoundComplete).toHaveBeenCalledTimes(6); // 3 instances x 2 rounds
  });

  it('one instance finishing early does not affect others', async () => {
    const args = makeArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: [
        '## Navigation\n- Review nav bar',
        '## Dashboard\n- Check widgets',
        '## Settings\n- Check form fields',
      ],
      usedClaude: true,
    });

    const completionTimes: { instance: number; time: number }[] = [];

    mockRunInstanceRounds.mockImplementation(async (config) => {
      // Instance 1 finishes very fast, 2 and 3 take longer
      const delay = config.instanceNumber === 1 ? 5 : 50;
      await new Promise((r) => setTimeout(r, delay));
      completionTimes.push({ instance: config.instanceNumber, time: Date.now() });
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('# Report\n');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 3,
      usedClaude: false,
    });

    await orchestrate(args);

    // All 3 completed
    expect(completionTimes).toHaveLength(3);

    // Instance 1 should have finished before 2 and 3
    const i1 = completionTimes.find((c) => c.instance === 1)!;
    const i2 = completionTimes.find((c) => c.instance === 2)!;
    const i3 = completionTimes.find((c) => c.instance === 3)!;
    expect(i1.time).toBeLessThanOrEqual(i2.time);
    expect(i1.time).toBeLessThanOrEqual(i3.time);

    // Consolidation only happened once — after all completed
    expect(mockConsolidateReports).toHaveBeenCalledTimes(1);
    expect(mockProgressDisplay.startConsolidation).toHaveBeenCalledTimes(1);
  });

  it('consolidation only triggers after all instances are complete', async () => {
    const args = makeArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## A', '## B', '## C'],
      usedClaude: true,
    });

    let consolidationCalledAt = 0;
    let lastInstanceCompletedAt = 0;

    mockRunInstanceRounds.mockImplementation(async (config) => {
      await new Promise((r) => setTimeout(r, 10));
      lastInstanceCompletedAt = Date.now();
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockImplementation(async () => {
      consolidationCalledAt = Date.now();
      return { findings: [], duplicateGroups: [], usedClaude: false };
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 3,
      usedClaude: false,
    });

    await orchestrate(args);

    // Consolidation started after all instances completed
    expect(consolidationCalledAt).toBeGreaterThanOrEqual(lastInstanceCompletedAt);
    expect(mockProgressDisplay.startConsolidation).toHaveBeenCalledTimes(1);
  });

  it('consolidation indicator is shown and final paths are displayed', async () => {
    const args = makeArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## A', '## B', '## C'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('# Report\n');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '# Discovery\n',
      instanceCount: 3,
      usedClaude: true,
    });

    await orchestrate(args);

    // Verify consolidation indicator lifecycle
    expect(mockProgressDisplay.startConsolidation).toHaveBeenCalledTimes(1);
    expect(mockProgressDisplay.completeConsolidation).toHaveBeenCalledTimes(1);

    // Verify final paths were passed
    const completeCall = mockProgressDisplay.completeConsolidation.mock.calls[0];
    expect(completeCall[0]).toContain('report.md');
    expect(completeCall[1]).toContain('discovery.md');
  });

  it('handles some instances failing permanently while others succeed', async () => {
    const args = makeArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## A', '## B', '## C'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      if (config.instanceNumber === 2) {
        // Instance 2 fails permanently
        config.progress?.onFailure?.(2, 1, 'Claude crashed');
        config.progress?.onPermanentlyFailed?.(2, 'Claude crashed');
        return makeFailedResult(2, 'Claude crashed');
      }
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 2,
      usedClaude: true,
    });

    await orchestrate(args);

    // Consolidation still happens with whatever output was produced
    expect(mockConsolidateReports).toHaveBeenCalledWith([1, 2, 3]);
    expect(mockProgressDisplay.startConsolidation).toHaveBeenCalledTimes(1);
    expect(mockProgressDisplay.completeConsolidation).toHaveBeenCalledTimes(1);

    // Progress display registered the failure
    expect(mockProgressDisplay.markPermanentlyFailed).toHaveBeenCalledWith(2, 'Claude crashed');
  });

  it('progress display is stopped even when an error occurs during consolidation', async () => {
    const args = makeArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## A', '## B', '## C'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockRejectedValue(new Error('Consolidation failed'));

    await expect(orchestrate(args)).rejects.toThrow('Consolidation failed');

    // Progress display was still stopped (finally block)
    expect(mockProgressDisplay.stop).toHaveBeenCalledTimes(1);
  });

  it('handles unexpected promise rejection from runInstanceRounds', async () => {
    const args = makeArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## A', '## B', '## C'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      if (config.instanceNumber === 3) {
        throw new Error('Unexpected process error');
      }
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 2,
      usedClaude: false,
    });

    // Should not throw — the rejected promise is caught by allSettled
    await orchestrate(args);

    // Instance 3's rejection was handled gracefully
    expect(mockProgressDisplay.markPermanentlyFailed).toHaveBeenCalledWith(
      3,
      'Unexpected process error',
    );

    // Consolidation still ran
    expect(mockConsolidateReports).toHaveBeenCalledTimes(1);
  });

  it('passes assigned areas extracted from plan chunks', async () => {
    const args = makeArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: [
        '## Navigation\n- Review nav bar\n\n## Header\n- Check logo',
        '## Dashboard\n- Check widgets',
        '## Settings\n- Check form fields\n\n## Profile\n- Check avatar',
      ],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 3,
      usedClaude: false,
    });

    await orchestrate(args);

    // Verify assigned areas were extracted from the chunks
    expect(mockRunInstanceRounds.mock.calls[0][0].assignedAreas).toEqual([
      'Navigation',
      'Header',
    ]);
    expect(mockRunInstanceRounds.mock.calls[1][0].assignedAreas).toEqual(['Dashboard']);
    expect(mockRunInstanceRounds.mock.calls[2][0].assignedAreas).toEqual([
      'Settings',
      'Profile',
    ]);
  });

  it('writes consolidated report to output directory', async () => {
    const args = makeArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## A'],
      usedClaude: false,
    });

    // Override to 1 instance for simplicity
    const singleArgs = makeArgs({ instances: 1 });
    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-orch-test'),
      instanceDirs: [join(resolve('.uxreview-temp-orch-test'), 'instance-1')],
      outputDir: OUTPUT_DIR,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('# UX Analysis Report\n\nNo findings.\n');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '# Discovery\n',
      instanceCount: 1,
      usedClaude: true,
    });

    await orchestrate(singleArgs);

    // Report was written
    const reportPath = join(OUTPUT_DIR, 'report.md');
    expect(existsSync(reportPath)).toBe(true);
    expect(readFileSync(reportPath, 'utf-8')).toBe('# UX Analysis Report\n\nNo findings.\n');

    // Discovery consolidation was called
    expect(mockWriteConsolidatedDiscovery).toHaveBeenCalledWith(OUTPUT_DIR, '# Discovery\n');
  });

  it('retry callbacks flow through to progress display', async () => {
    const args = makeArgs({ instances: 1 });

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-orch-test'),
      instanceDirs: [join(resolve('.uxreview-temp-orch-test'), 'instance-1')],
      outputDir: OUTPUT_DIR,
    });

    mockDistributePlan.mockResolvedValue({
      chunks: ['## Navigation\n- Review nav bar'],
      usedClaude: false,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      // Simulate failure → retry → success flow via callbacks
      config.progress?.onRoundStart?.(1, 1);
      config.progress?.onFailure?.(1, 1, 'Timeout');
      config.progress?.onRetry?.(1, 1, 1, 3);
      config.progress?.onRetrySuccess?.(1, 1);
      config.progress?.onRoundComplete?.(1, 1, 5000);
      config.progress?.onCompleted?.(1);
      return makeSuccessResult(1, 1);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 1,
      usedClaude: false,
    });

    await orchestrate(args);

    // Verify retry flow reached the progress display
    expect(mockProgressDisplay.markFailed).toHaveBeenCalledWith(1, 'Timeout');
    expect(mockProgressDisplay.markRetrying).toHaveBeenCalledWith(1, 1, 3);
    expect(mockProgressDisplay.markRunning).toHaveBeenCalled(); // onRetrySuccess calls markRunning
    expect(mockProgressDisplay.markRoundComplete).toHaveBeenCalledWith(1, 5000);
    expect(mockProgressDisplay.markCompleted).toHaveBeenCalledWith(1);
  });

  it('onProgressUpdate callback flows through to display.updateProgress', async () => {
    const args = makeArgs({ instances: 1 });

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-orch-test'),
      instanceDirs: [join(resolve('.uxreview-temp-orch-test'), 'instance-1')],
      outputDir: OUTPUT_DIR,
    });

    mockDistributePlan.mockResolvedValue({
      chunks: ['## Navigation\n- Review nav bar'],
      usedClaude: false,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      // Simulate progress update via callback
      config.progress?.onProgressUpdate?.(1, 2, 1, 4, 3);
      config.progress?.onCompleted?.(1);
      return makeSuccessResult(1, 1);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 1,
      usedClaude: false,
    });

    await orchestrate(args);

    // Verify onProgressUpdate reached the progress display
    expect(mockProgressDisplay.updateProgress).toHaveBeenCalledWith(1, 2, 1, 4, 3);
  });

  it('ProgressDisplay is constructed with correct instance numbers and rounds', async () => {
    const args = makeArgs({ instances: 3, rounds: 2 });

    mockDistributePlan.mockResolvedValue({
      chunks: ['## A', '## B', '## C'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateReports.mockResolvedValue({
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    });
    mockReassignAndRemap.mockReturnValue({
      findings: [],
      idMapping: new Map(),
      screenshotOps: [],
    });
    mockOrganizeHierarchically.mockResolvedValue([]);
    mockFormatConsolidatedReport.mockReturnValue('');
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 3,
      usedClaude: false,
    });

    await orchestrate(args);

    expect(ProgressDisplay).toHaveBeenCalledWith([1, 2, 3], 2);
  });

  describe('--keep-temp flag', () => {
    function setupSimpleMocks() {
      mockDistributePlan.mockResolvedValue({
        chunks: ['## A'],
        usedClaude: false,
      });
      mockInitWorkspace.mockReturnValue({
        tempDir: resolve('.uxreview-temp-orch-test'),
        instanceDirs: [join(resolve('.uxreview-temp-orch-test'), 'instance-1')],
        outputDir: OUTPUT_DIR,
      });
      mockRunInstanceRounds.mockImplementation(async (config) => {
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(config.instanceNumber, 1);
      });
      mockConsolidateReports.mockResolvedValue({
        findings: [],
        duplicateGroups: [],
        usedClaude: false,
      });
      mockReassignAndRemap.mockReturnValue({
        findings: [],
        idMapping: new Map(),
        screenshotOps: [],
      });
      mockOrganizeHierarchically.mockResolvedValue([]);
      mockFormatConsolidatedReport.mockReturnValue('');
      mockConsolidateDiscoveryDocs.mockResolvedValue({
        content: '',
        instanceCount: 1,
        usedClaude: false,
      });
    }

    it('cleans up temp directory by default (keepTemp: false)', async () => {
      const args = makeArgs({ instances: 1, keepTemp: false });
      setupSimpleMocks();

      await orchestrate(args);

      expect(mockCleanupTempDir).toHaveBeenCalledTimes(1);
    });

    it('preserves temp directory when keepTemp is true', async () => {
      const args = makeArgs({ instances: 1, keepTemp: true });
      setupSimpleMocks();

      await orchestrate(args);

      expect(mockCleanupTempDir).not.toHaveBeenCalled();
    });

    it('cleans up temp directory even when consolidation fails (keepTemp: false)', async () => {
      const args = makeArgs({ instances: 1, keepTemp: false });
      setupSimpleMocks();
      mockConsolidateReports.mockRejectedValue(new Error('Consolidation failed'));

      await expect(orchestrate(args)).rejects.toThrow('Consolidation failed');

      expect(mockCleanupTempDir).toHaveBeenCalledTimes(1);
    });
  });

  it('cleans up workspace when distributePlan throws', async () => {
    const args = makeArgs({ instances: 1, keepTemp: false });

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-orch-test'),
      instanceDirs: [join(resolve('.uxreview-temp-orch-test'), 'instance-1')],
      outputDir: OUTPUT_DIR,
    });

    mockDistributePlan.mockRejectedValue(new Error('Claude CLI not found'));

    await expect(orchestrate(args)).rejects.toThrow('Claude CLI not found');

    // The finally block should have run, cleaning up the workspace
    expect(mockCleanupTempDir).toHaveBeenCalledTimes(1);
    expect(mockProgressDisplay.stop).toHaveBeenCalledTimes(1);

    // No instances should have been spawned
    expect(mockRunInstanceRounds).not.toHaveBeenCalled();
  });

  describe('--verbose flag', () => {
    function setupSimpleMocksForVerbose() {
      mockDistributePlan.mockResolvedValue({
        chunks: ['## A'],
        usedClaude: false,
      });
      mockInitWorkspace.mockReturnValue({
        tempDir: resolve('.uxreview-temp-orch-test'),
        instanceDirs: [join(resolve('.uxreview-temp-orch-test'), 'instance-1')],
        outputDir: OUTPUT_DIR,
      });
      mockRunInstanceRounds.mockImplementation(async (config) => {
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(config.instanceNumber, 1);
      });
      mockConsolidateReports.mockResolvedValue({
        findings: [],
        duplicateGroups: [],
        usedClaude: false,
      });
      mockReassignAndRemap.mockReturnValue({
        findings: [],
        idMapping: new Map(),
        screenshotOps: [],
      });
      mockOrganizeHierarchically.mockResolvedValue([]);
      mockFormatConsolidatedReport.mockReturnValue('');
      mockConsolidateDiscoveryDocs.mockResolvedValue({
        content: '',
        instanceCount: 1,
        usedClaude: false,
      });
    }

    it('calls setVerbose(true) when verbose is enabled', async () => {
      const args = makeArgs({ instances: 1, verbose: true });
      setupSimpleMocksForVerbose();

      await orchestrate(args);

      expect(mockSetVerbose).toHaveBeenCalledWith(true);
    });

    it('calls setVerbose(false) when verbose is disabled', async () => {
      const args = makeArgs({ instances: 1, verbose: false });
      setupSimpleMocksForVerbose();

      await orchestrate(args);

      expect(mockSetVerbose).toHaveBeenCalledWith(false);
    });

    it('produces debug output for phase timing when verbose is enabled', async () => {
      const args = makeArgs({ instances: 1, verbose: true });
      setupSimpleMocksForVerbose();

      await orchestrate(args);

      // debug() should have been called with phase timing messages
      const debugMessages = mockDebug.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(debugMessages.some((m: string) => m.includes('Distribution phase completed'))).toBe(true);
      expect(debugMessages.some((m: string) => m.includes('Instance execution phase completed'))).toBe(true);
      expect(debugMessages.some((m: string) => m.includes('Consolidation phase completed'))).toBe(true);
    });
  });

  describe('signal handling', () => {
    let processExitSpy: ReturnType<typeof vi.spyOn>;
    let processOnSpy: ReturnType<typeof vi.spyOn>;
    let processRemoveListenerSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Spy on process.exit to prevent actually exiting
      processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
      processOnSpy = vi.spyOn(process, 'on');
      processRemoveListenerSpy = vi.spyOn(process, 'removeListener');
    });

    afterEach(() => {
      processExitSpy.mockRestore();
      processOnSpy.mockRestore();
      processRemoveListenerSpy.mockRestore();
    });

    function setupDefaultMocks() {
      mockDistributePlan.mockResolvedValue({
        chunks: ['## A'],
        usedClaude: false,
      });
      mockInitWorkspace.mockReturnValue({
        tempDir: resolve('.uxreview-temp-orch-test'),
        instanceDirs: [join(resolve('.uxreview-temp-orch-test'), 'instance-1')],
        outputDir: OUTPUT_DIR,
      });
      mockConsolidateReports.mockResolvedValue({
        findings: [],
        duplicateGroups: [],
        usedClaude: false,
      });
      mockReassignAndRemap.mockReturnValue({
        findings: [],
        idMapping: new Map(),
        screenshotOps: [],
      });
      mockOrganizeHierarchically.mockResolvedValue([]);
      mockFormatConsolidatedReport.mockReturnValue('');
      mockConsolidateDiscoveryDocs.mockResolvedValue({
        content: '',
        instanceCount: 1,
        usedClaude: false,
      });
    }

    it('registers SIGINT and SIGTERM handlers before instances are spawned', async () => {
      const args = makeArgs({ instances: 1 });
      setupDefaultMocks();

      let handlersRegisteredBeforeSpawn = false;
      mockRunInstanceRounds.mockImplementation(async (config) => {
        // At this point, handlers should already be registered
        const sigintCalls = processOnSpy.mock.calls.filter(
          (call) => call[0] === 'SIGINT',
        );
        const sigtermCalls = processOnSpy.mock.calls.filter(
          (call) => call[0] === 'SIGTERM',
        );
        handlersRegisteredBeforeSpawn =
          sigintCalls.length > 0 && sigtermCalls.length > 0;
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(config.instanceNumber, 1);
      });

      await orchestrate(args);

      expect(handlersRegisteredBeforeSpawn).toBe(true);
    });

    it('removes signal handlers in the finally block after successful completion', async () => {
      const args = makeArgs({ instances: 1 });
      setupDefaultMocks();

      mockRunInstanceRounds.mockImplementation(async (config) => {
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(config.instanceNumber, 1);
      });

      await orchestrate(args);

      // Verify removeListener was called for both signals
      const removeSigint = processRemoveListenerSpy.mock.calls.filter(
        (call) => call[0] === 'SIGINT',
      );
      const removeSigterm = processRemoveListenerSpy.mock.calls.filter(
        (call) => call[0] === 'SIGTERM',
      );
      expect(removeSigint.length).toBeGreaterThanOrEqual(1);
      expect(removeSigterm.length).toBeGreaterThanOrEqual(1);
    });

    it('removes signal handlers in the finally block even after an error', async () => {
      const args = makeArgs({ instances: 1 });
      setupDefaultMocks();

      mockRunInstanceRounds.mockImplementation(async (config) => {
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(config.instanceNumber, 1);
      });

      mockConsolidateReports.mockRejectedValue(new Error('Consolidation failed'));

      await expect(orchestrate(args)).rejects.toThrow('Consolidation failed');

      // Handlers should still be removed even though consolidation threw
      const removeSigint = processRemoveListenerSpy.mock.calls.filter(
        (call) => call[0] === 'SIGINT',
      );
      const removeSigterm = processRemoveListenerSpy.mock.calls.filter(
        (call) => call[0] === 'SIGTERM',
      );
      expect(removeSigint.length).toBeGreaterThanOrEqual(1);
      expect(removeSigterm.length).toBeGreaterThanOrEqual(1);
    });

    it('SIGINT handler kills child processes, stops display, and exits with code 130', async () => {
      const args = makeArgs({ instances: 1 });
      setupDefaultMocks();

      let capturedSigintHandler: ((signal: NodeJS.Signals) => void) | undefined;
      processOnSpy.mockImplementation(function (this: NodeJS.Process, event: string, handler: (...args: unknown[]) => void) {
        if (event === 'SIGINT') {
          capturedSigintHandler = handler as (signal: NodeJS.Signals) => void;
        }
        return this;
      });

      mockRunInstanceRounds.mockImplementation(async (config) => {
        // Simulate SIGINT arriving during instance execution
        if (capturedSigintHandler) {
          capturedSigintHandler('SIGINT');
        }
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(config.instanceNumber, 1);
      });

      await orchestrate(args);

      expect(mockKillAllChildProcesses).toHaveBeenCalled();
      expect(mockProgressDisplay.stop).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(130);
    });

    it('SIGTERM handler kills child processes, stops display, and exits with code 143', async () => {
      const args = makeArgs({ instances: 1 });
      setupDefaultMocks();

      let capturedSigtermHandler: ((signal: NodeJS.Signals) => void) | undefined;
      processOnSpy.mockImplementation(function (this: NodeJS.Process, event: string, handler: (...args: unknown[]) => void) {
        if (event === 'SIGTERM') {
          capturedSigtermHandler = handler as (signal: NodeJS.Signals) => void;
        }
        return this;
      });

      mockRunInstanceRounds.mockImplementation(async (config) => {
        // Simulate SIGTERM arriving during instance execution
        if (capturedSigtermHandler) {
          capturedSigtermHandler('SIGTERM');
        }
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(config.instanceNumber, 1);
      });

      await orchestrate(args);

      expect(mockKillAllChildProcesses).toHaveBeenCalled();
      expect(mockProgressDisplay.stop).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(143);
    });
  });

  describe('consolidation checkpointing', () => {
    function setupConsolidationMocks() {
      mockDistributePlan.mockResolvedValue({
        chunks: ['## A'],
        usedClaude: false,
      });
      mockInitWorkspace.mockReturnValue({
        tempDir: resolve('.uxreview-temp-orch-test'),
        instanceDirs: [join(resolve('.uxreview-temp-orch-test'), 'instance-1')],
        outputDir: OUTPUT_DIR,
      });
      mockRunInstanceRounds.mockImplementation(async (config) => {
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(config.instanceNumber, 1);
      });
      mockConsolidateReports.mockResolvedValue({
        findings: [{ id: 'I1-UXR-001', title: 'Test', uiArea: 'Nav', severity: 'minor', description: 'desc', suggestion: 'fix', screenshot: '' }],
        duplicateGroups: [],
        usedClaude: false,
      });
      mockReassignAndRemap.mockReturnValue({
        findings: [{ id: 'UXR-001', title: 'Test', uiArea: 'Nav', severity: 'minor', description: 'desc', suggestion: 'fix', screenshot: '' }],
        idMapping: new Map([['I1-UXR-001', 'UXR-001']]),
        screenshotOps: [],
      });
      mockOrganizeHierarchically.mockResolvedValue([{
        area: 'Nav',
        findings: [{ finding: { id: 'UXR-001', title: 'Test', uiArea: 'Nav', severity: 'minor', description: 'desc', suggestion: 'fix', screenshot: '' }, children: [] }],
      }]);
      mockFormatConsolidatedReport.mockReturnValue('# UX Analysis Report\n');
      mockConsolidateDiscoveryDocs.mockResolvedValue({
        content: '# Discovery\n',
        instanceCount: 1,
        usedClaude: true,
      });
    }

    it('writes checkpoint after each consolidation step in a fresh run', async () => {
      const args = makeArgs({ instances: 1 });
      setupConsolidationMocks();

      // Capture checkpoint snapshots since the object is mutated in place
      const snapshots: Array<{ completedSteps: string[]; dedupOutput: string | null; reassignOutput: string | null; hierarchyOutput: string | null; formatReportOutput: string | null; discoveryMergeOutput: string | null }> = [];
      mockWriteConsolidationCheckpoint.mockImplementation((cp) => {
        snapshots.push({
          completedSteps: [...cp.completedSteps],
          dedupOutput: cp.dedupOutput,
          reassignOutput: cp.reassignOutput,
          hierarchyOutput: cp.hierarchyOutput,
          formatReportOutput: cp.formatReportOutput,
          discoveryMergeOutput: cp.discoveryMergeOutput,
        });
      });

      await orchestrate(args);

      // writeConsolidationCheckpoint should be called 6 times (once per step)
      expect(snapshots).toHaveLength(6);

      // Verify the progression of completed steps
      expect(snapshots[0].completedSteps).toEqual(['dedup']);
      expect(snapshots[0].dedupOutput).toBeTruthy();

      expect(snapshots[1].completedSteps).toEqual(['dedup', 'reassign']);
      expect(snapshots[1].reassignOutput).toBeTruthy();

      expect(snapshots[2].completedSteps).toEqual(['dedup', 'reassign', 'hierarchy']);
      expect(snapshots[2].hierarchyOutput).toBeTruthy();

      expect(snapshots[3].completedSteps).toEqual(['dedup', 'reassign', 'hierarchy', 'format-report']);
      expect(snapshots[3].formatReportOutput).toBeTruthy();

      expect(snapshots[4].completedSteps).toEqual(['dedup', 'reassign', 'hierarchy', 'format-report', 'discovery-merge']);
      expect(snapshots[4].discoveryMergeOutput).toBeTruthy();

      expect(snapshots[5].completedSteps).toEqual(['dedup', 'reassign', 'hierarchy', 'format-report', 'discovery-merge', 'write-discovery']);
    });

    it('resumes after dedup — skips dedup, runs remaining steps', async () => {
      const args = makeArgs({ instances: 1 });
      setupConsolidationMocks();

      const dedupResult = {
        findings: [{ id: 'I1-UXR-001', title: 'Cached', uiArea: 'Nav', severity: 'minor', description: 'cached desc', suggestion: 'cached fix', screenshot: '' }],
        duplicateGroups: [],
        usedClaude: false,
      };

      // Return a checkpoint with dedup already completed
      const existingCheckpoint: ConsolidationCheckpoint = {
        completedSteps: ['dedup'],
        dedupOutput: JSON.stringify(dedupResult),
        reassignOutput: null,
        hierarchyOutput: null,
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: new Date().toISOString(),
      };
      mockReadConsolidationCheckpoint.mockReturnValue(existingCheckpoint);
      mockIsStepCompleted.mockImplementation(
        (cp: ConsolidationCheckpoint, step: string) => cp.completedSteps.includes(step as any),
      );

      await orchestrate(args);

      // Dedup was skipped — consolidateReports should NOT have been called
      expect(mockConsolidateReports).not.toHaveBeenCalled();

      // But reassign was called with the cached dedup result (startId=1 for non-append mode)
      expect(mockReassignAndRemap).toHaveBeenCalledWith(dedupResult, OUTPUT_DIR, 1, false);

      // Remaining steps ran
      expect(mockOrganizeHierarchically).toHaveBeenCalled();
      expect(mockFormatConsolidatedReport).toHaveBeenCalled();
      expect(mockConsolidateDiscoveryDocs).toHaveBeenCalled();
      expect(mockWriteConsolidatedDiscovery).toHaveBeenCalled();
    });

    it('resumes after hierarchy — skips dedup, reassign, and hierarchy', async () => {
      const args = makeArgs({ instances: 1 });
      setupConsolidationMocks();

      const cachedFindings = [{ id: 'UXR-001', title: 'Test', uiArea: 'Nav', severity: 'minor', description: 'desc', suggestion: 'fix', screenshot: '' }];
      const cachedGroups = [{
        area: 'Nav',
        findings: [{ finding: cachedFindings[0], children: [] }],
      }];

      const existingCheckpoint: ConsolidationCheckpoint = {
        completedSteps: ['dedup', 'reassign', 'hierarchy'],
        dedupOutput: JSON.stringify({ findings: [], duplicateGroups: [], usedClaude: false }),
        reassignOutput: JSON.stringify(cachedFindings),
        hierarchyOutput: JSON.stringify(cachedGroups),
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: new Date().toISOString(),
      };
      mockReadConsolidationCheckpoint.mockReturnValue(existingCheckpoint);
      mockIsStepCompleted.mockImplementation(
        (cp: ConsolidationCheckpoint, step: string) => cp.completedSteps.includes(step as any),
      );

      await orchestrate(args);

      // First three steps were skipped
      expect(mockConsolidateReports).not.toHaveBeenCalled();
      expect(mockReassignAndRemap).not.toHaveBeenCalled();
      expect(mockOrganizeHierarchically).not.toHaveBeenCalled();

      // Format report was called with the cached groups
      expect(mockFormatConsolidatedReport).toHaveBeenCalledWith(cachedGroups);

      // Discovery steps still ran
      expect(mockConsolidateDiscoveryDocs).toHaveBeenCalled();
      expect(mockWriteConsolidatedDiscovery).toHaveBeenCalled();
    });

    it('resumes after discovery-merge — only runs write-discovery', async () => {
      const args = makeArgs({ instances: 1 });
      setupConsolidationMocks();

      const existingCheckpoint: ConsolidationCheckpoint = {
        completedSteps: ['dedup', 'reassign', 'hierarchy', 'format-report', 'discovery-merge'],
        dedupOutput: JSON.stringify({ findings: [], duplicateGroups: [], usedClaude: false }),
        reassignOutput: JSON.stringify([]),
        hierarchyOutput: JSON.stringify([]),
        formatReportOutput: '# Report',
        discoveryMergeOutput: '# Discovery Content',
        timestamp: new Date().toISOString(),
      };
      mockReadConsolidationCheckpoint.mockReturnValue(existingCheckpoint);
      mockIsStepCompleted.mockImplementation(
        (cp: ConsolidationCheckpoint, step: string) => cp.completedSteps.includes(step as any),
      );

      await orchestrate(args);

      // All steps except write-discovery were skipped
      expect(mockConsolidateReports).not.toHaveBeenCalled();
      expect(mockReassignAndRemap).not.toHaveBeenCalled();
      expect(mockOrganizeHierarchically).not.toHaveBeenCalled();
      expect(mockFormatConsolidatedReport).not.toHaveBeenCalled();
      expect(mockConsolidateDiscoveryDocs).not.toHaveBeenCalled();

      // Write discovery was called with the cached content
      expect(mockWriteConsolidatedDiscovery).toHaveBeenCalledWith(OUTPUT_DIR, '# Discovery Content');
    });

    it('corrupted checkpoint triggers full reconsolidation', async () => {
      const args = makeArgs({ instances: 1 });
      setupConsolidationMocks();

      // readConsolidationCheckpoint returns null for corrupted checkpoint
      mockReadConsolidationCheckpoint.mockReturnValue(null);

      await orchestrate(args);

      // All steps should have been executed
      expect(mockConsolidateReports).toHaveBeenCalled();
      expect(mockReassignAndRemap).toHaveBeenCalled();
      expect(mockOrganizeHierarchically).toHaveBeenCalled();
      expect(mockFormatConsolidatedReport).toHaveBeenCalled();
      expect(mockConsolidateDiscoveryDocs).toHaveBeenCalled();
      expect(mockWriteConsolidatedDiscovery).toHaveBeenCalled();

      // All 6 checkpoint writes should have occurred
      expect(mockWriteConsolidationCheckpoint).toHaveBeenCalledTimes(6);
    });

    it('missing checkpoint triggers full consolidation', async () => {
      const args = makeArgs({ instances: 1 });
      setupConsolidationMocks();

      // No checkpoint exists (default behavior)
      mockReadConsolidationCheckpoint.mockReturnValue(null);

      await orchestrate(args);

      // All steps should have been executed
      expect(mockConsolidateReports).toHaveBeenCalledTimes(1);
      expect(mockReassignAndRemap).toHaveBeenCalledTimes(1);
      expect(mockOrganizeHierarchically).toHaveBeenCalledTimes(1);
      expect(mockFormatConsolidatedReport).toHaveBeenCalledTimes(1);
      expect(mockConsolidateDiscoveryDocs).toHaveBeenCalledTimes(1);
      expect(mockWriteConsolidatedDiscovery).toHaveBeenCalledTimes(1);
    });
  });

  describe('--format flag', () => {
    function setupSimpleMocksForFormat() {
      mockDistributePlan.mockResolvedValue({
        chunks: ['## A'],
        usedClaude: false,
      });
      mockInitWorkspace.mockReturnValue({
        tempDir: resolve('.uxreview-temp-orch-test'),
        instanceDirs: [join(resolve('.uxreview-temp-orch-test'), 'instance-1')],
        outputDir: OUTPUT_DIR,
      });
      mockRunInstanceRounds.mockImplementation(async (config) => {
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(config.instanceNumber, 1);
      });
      mockConsolidateReports.mockResolvedValue({
        findings: [],
        duplicateGroups: [],
        usedClaude: false,
      });
      mockReassignAndRemap.mockReturnValue({
        findings: [],
        idMapping: new Map(),
        screenshotOps: [],
      });
      mockOrganizeHierarchically.mockResolvedValue([]);
      mockFormatConsolidatedReport.mockReturnValue('# UX Analysis Report\n');
      mockFormatHtmlReport.mockReturnValue('<!DOCTYPE html><html><body>Report</body></html>');
      mockConsolidateDiscoveryDocs.mockResolvedValue({
        content: '',
        instanceCount: 1,
        usedClaude: false,
      });
    }

    it('writes report.md when format is markdown (default)', async () => {
      const args = makeArgs({ instances: 1, format: 'markdown' });
      setupSimpleMocksForFormat();

      await orchestrate(args);

      expect(mockFormatConsolidatedReport).toHaveBeenCalled();
      expect(mockFormatHtmlReport).not.toHaveBeenCalled();

      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      expect(readFileSync(reportPath, 'utf-8')).toBe('# UX Analysis Report\n');

      // report.html should not exist
      expect(existsSync(join(OUTPUT_DIR, 'report.html'))).toBe(false);
    });

    it('writes report.html when format is html', async () => {
      const args = makeArgs({ instances: 1, format: 'html' });
      setupSimpleMocksForFormat();

      await orchestrate(args);

      expect(mockFormatHtmlReport).toHaveBeenCalled();
      expect(mockFormatConsolidatedReport).not.toHaveBeenCalled();

      const reportPath = join(OUTPUT_DIR, 'report.html');
      expect(existsSync(reportPath)).toBe(true);
      expect(readFileSync(reportPath, 'utf-8')).toBe('<!DOCTYPE html><html><body>Report</body></html>');

      // report.md should not exist
      expect(existsSync(join(OUTPUT_DIR, 'report.md'))).toBe(false);
    });

    it('passes correct metadata and screenshots dir to formatHtmlReport', async () => {
      const args = makeArgs({ instances: 2, rounds: 3, format: 'html' });
      setupSimpleMocksForFormat();
      mockInitWorkspace.mockReturnValue({
        tempDir: resolve('.uxreview-temp-orch-test'),
        instanceDirs: [
          join(resolve('.uxreview-temp-orch-test'), 'instance-1'),
          join(resolve('.uxreview-temp-orch-test'), 'instance-2'),
        ],
        outputDir: OUTPUT_DIR,
      });

      await orchestrate(args);

      expect(mockFormatHtmlReport).toHaveBeenCalledTimes(1);
      const [groups, metadata, screenshotsDir] = mockFormatHtmlReport.mock.calls[0];
      expect(groups).toEqual([]);
      expect(metadata.url).toBe('https://example.com/app');
      expect(metadata.instanceCount).toBe(2);
      expect(metadata.roundCount).toBe(3);
      expect(metadata.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(screenshotsDir).toBe(join(OUTPUT_DIR, 'screenshots'));
    });

    it('completeConsolidation receives report.html path for html format', async () => {
      const args = makeArgs({ instances: 1, format: 'html' });
      setupSimpleMocksForFormat();

      await orchestrate(args);

      const completeCall = mockProgressDisplay.completeConsolidation.mock.calls[0];
      expect(completeCall[0]).toContain('report.html');
    });
  });
});
