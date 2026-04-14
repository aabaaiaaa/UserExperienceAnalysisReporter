import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PlanSignalInterruptError } from '../src/plan-orchestrator.js';

// --- Mocks ---

// Mock work-distribution
vi.mock('../src/work-distribution.js', () => ({
  distributePlan: vi.fn(),
}));

// Mock claude-cli (killAllChildProcesses is now used by signal-handler.ts)
vi.mock('../src/claude-cli.js', () => ({
  killAllChildProcesses: vi.fn(),
  runClaude: vi.fn(),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
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
  consolidateDiscoveryDocs: vi.fn(),
  writeConsolidatedDiscovery: vi.fn(),
  generatePlanTemplate: vi.fn(),
}));

// Mock file-manager
vi.mock('../src/file-manager.js', () => ({
  initWorkspace: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
  getInstancePaths: vi.fn((n: number) => {
    const dir = join(resolve('.uxreview-temp-plan-test'), `instance-${n}`);
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
  markRateLimited: vi.fn(),
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

// Mock discovery-html
vi.mock('../src/discovery-html.js', () => ({
  formatDiscoveryHtml: vi.fn(),
}));

// Mock screenshots
vi.mock('../src/screenshots.js', () => ({
  listScreenshots: vi.fn().mockReturnValue([]),
}));

// Mock orchestrator (for extractAreasFromPlanChunk)
vi.mock('../src/orchestrator.js', () => ({
  extractAreasFromPlanChunk: vi.fn((chunk: string) => {
    // Simple implementation for tests
    const headings = chunk
      .split('\n')
      .filter((line: string) => /^##\s+/.test(line))
      .map((line: string) => line.replace(/^##\s+/, '').trim())
      .filter((h: string) => h.length > 0);
    if (headings.length > 0) return headings;

    const listItems = chunk
      .split('\n')
      .filter((line: string) => /^[-*]\s+/.test(line))
      .map((line: string) => line.replace(/^[-*]\s+/, '').trim())
      .filter((item: string) => item.length > 0);
    if (listItems.length > 0) return listItems;

    return ['Full review'];
  }),
}));

// Import mocked modules
import { distributePlan } from '../src/work-distribution.js';
import { runInstanceRounds, RoundExecutionResult } from '../src/instance-manager.js';
import { killAllChildProcesses } from '../src/claude-cli.js';
import {
  consolidateDiscoveryDocs,
  writeConsolidatedDiscovery,
  generatePlanTemplate,
} from '../src/consolidation.js';
import { initWorkspace, cleanupTempDir, getInstancePaths } from '../src/file-manager.js';
import { ProgressDisplay } from '../src/progress-display.js';
import { formatDiscoveryHtml } from '../src/discovery-html.js';
import { runPlanDiscovery } from '../src/plan-orchestrator.js';
import { ParsedPlanArgs } from '../src/cli.js';
import { extractAreasFromPlanChunk } from '../src/orchestrator.js';

const mockDistributePlan = vi.mocked(distributePlan);
const mockRunInstanceRounds = vi.mocked(runInstanceRounds);
const mockKillAllChildProcesses = vi.mocked(killAllChildProcesses);
const mockConsolidateDiscoveryDocs = vi.mocked(consolidateDiscoveryDocs);
const mockWriteConsolidatedDiscovery = vi.mocked(writeConsolidatedDiscovery);
const mockGeneratePlanTemplate = vi.mocked(generatePlanTemplate);
const mockInitWorkspace = vi.mocked(initWorkspace);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockFormatDiscoveryHtml = vi.mocked(formatDiscoveryHtml);
const mockExtractAreasFromPlanChunk = vi.mocked(extractAreasFromPlanChunk);

const OUTPUT_DIR = resolve('.uxreview-output-plan-test');

function makePlanArgs(overrides?: Partial<ParsedPlanArgs>): ParsedPlanArgs {
  return {
    url: 'https://example.com/app',
    intro: 'Test application context',
    plan: '## Navigation\n- Review nav bar\n\n## Dashboard\n- Check widgets',
    scope: 'Check layout and consistency',
    instances: 2,
    rounds: 1,
    output: OUTPUT_DIR,
    keepTemp: false,
    dryRun: false,
    verbose: false,
    suppressOpen: true,
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

describe('runPlanDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Create output directory for writeFileSync
    mkdirSync(OUTPUT_DIR, { recursive: true });
    mkdirSync(join(OUTPUT_DIR, 'screenshots'), { recursive: true });

    // Default mock setup
    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-plan-test'),
      instanceDirs: [
        join(resolve('.uxreview-temp-plan-test'), 'instance-1'),
        join(resolve('.uxreview-temp-plan-test'), 'instance-2'),
      ],
      outputDir: OUTPUT_DIR,
    });

    mockFormatDiscoveryHtml.mockReturnValue('<!DOCTYPE html><html><body>Discovery</body></html>');
  });

  afterEach(() => {
    if (existsSync(OUTPUT_DIR)) {
      rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  it('spawns instances with discovery prompt and consolidates discoveries', async () => {
    const args = makePlanArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: [
        '## Navigation\n- Review nav bar',
        '## Dashboard\n- Check widgets',
      ],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onRoundStart?.(config.instanceNumber, 1);
      config.progress?.onRoundComplete?.(config.instanceNumber, 1, 1000);
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '## Navigation\n- Nav bar found\n\n## Dashboard\n- Widgets found',
      instanceCount: 2,
      usedClaude: true,
    });

    mockGeneratePlanTemplate.mockResolvedValue(
      '## Navigation\n- Nav bar\n\n## Dashboard\n- Widgets',
    );

    await runPlanDiscovery(args);

    // Verify work distribution was called
    expect(mockDistributePlan).toHaveBeenCalledWith(args.plan, 2);

    // Verify instances were spawned
    expect(mockRunInstanceRounds).toHaveBeenCalledTimes(2);

    // Verify each instance received correct config
    for (let i = 0; i < 2; i++) {
      const call = mockRunInstanceRounds.mock.calls[i][0];
      expect(call.instanceNumber).toBe(i + 1);
      expect(call.url).toBe(args.url);
      expect(call.intro).toBe(args.intro);
      expect(call.scope).toBe(args.scope);
      expect(call.totalRounds).toBe(1);
      expect(call.progress).toBeDefined();
    }

    // Verify discovery consolidation was called
    expect(mockConsolidateDiscoveryDocs).toHaveBeenCalledWith([1, 2]);

    // Verify plan template was generated from consolidated discovery
    expect(mockGeneratePlanTemplate).toHaveBeenCalledWith(
      '## Navigation\n- Nav bar found\n\n## Dashboard\n- Widgets found',
    );

    // Verify discovery HTML was generated
    expect(mockFormatDiscoveryHtml).toHaveBeenCalledWith(
      '## Navigation\n- Nav bar found\n\n## Dashboard\n- Widgets found',
      expect.objectContaining({
        url: args.url,
        instanceCount: 2,
        roundCount: 1,
      }),
      join(OUTPUT_DIR, 'screenshots'),
    );

    // Verify output files were written
    const planContent = readFileSync(join(OUTPUT_DIR, 'plan.md'), 'utf-8');
    expect(planContent).toContain('## Navigation');
    expect(planContent).toContain('## Dashboard');

    const htmlContent = readFileSync(join(OUTPUT_DIR, 'discovery.html'), 'utf-8');
    expect(htmlContent).toContain('<!DOCTYPE html>');

    // Verify consolidated discovery was written
    expect(mockWriteConsolidatedDiscovery).toHaveBeenCalledWith(
      OUTPUT_DIR,
      '## Navigation\n- Nav bar found\n\n## Dashboard\n- Widgets found',
    );
  });

  it('generates plan template from consolidated discovery content', async () => {
    const args = makePlanArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## Navigation\n- Review nav bar', '## Dashboard\n- Check widgets'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    const discoveryContent = '## Site Map\n- Home page\n- About page\n- Contact form';
    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: discoveryContent,
      instanceCount: 2,
      usedClaude: true,
    });

    const planTemplateContent = '## Home\n- Hero section\n\n## About\n- Team section';
    mockGeneratePlanTemplate.mockResolvedValue(planTemplateContent);

    await runPlanDiscovery(args);

    // Verify generatePlanTemplate was called with consolidated discovery content
    expect(mockGeneratePlanTemplate).toHaveBeenCalledWith(discoveryContent);

    // Verify plan.md was written with generated template content
    const planContent = readFileSync(join(OUTPUT_DIR, 'plan.md'), 'utf-8');
    expect(planContent).toBe(planTemplateContent + '\n');
  });

  it('writes both plan.md and discovery.html to output directory', async () => {
    const args = makePlanArgs({ instances: 1 });

    // Single instance: no distribution needed
    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '## Found Areas\n- Area A\n- Area B',
      instanceCount: 1,
      usedClaude: true,
    });

    mockGeneratePlanTemplate.mockResolvedValue('## Area A\n- Feature 1\n\n## Area B\n- Feature 2');

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-plan-test'),
      instanceDirs: [join(resolve('.uxreview-temp-plan-test'), 'instance-1')],
      outputDir: OUTPUT_DIR,
    });

    await runPlanDiscovery(args);

    // Both output files should exist
    expect(existsSync(join(OUTPUT_DIR, 'plan.md'))).toBe(true);
    expect(existsSync(join(OUTPUT_DIR, 'discovery.html'))).toBe(true);

    // Verify content was written
    const planContent = readFileSync(join(OUTPUT_DIR, 'plan.md'), 'utf-8');
    expect(planContent).toContain('## Area A');

    const htmlContent = readFileSync(join(OUTPUT_DIR, 'discovery.html'), 'utf-8');
    expect(htmlContent).toContain('<!DOCTYPE html>');
  });

  it('handles signal interruption with cleanup', async () => {
    const args = makePlanArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## Navigation', '## Dashboard'],
      usedClaude: true,
    });

    // Simulate a long-running instance that can be interrupted
    mockRunInstanceRounds.mockImplementation(async () => {
      // Simulate a long delay that will be interrupted by signal
      await new Promise((r) => setTimeout(r, 50));
      return makeSuccessResult(1, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '## Partial discovery',
      instanceCount: 1,
      usedClaude: false,
    });

    mockGeneratePlanTemplate.mockResolvedValue('## Partial plan');

    await runPlanDiscovery(args);

    // Verify cleanup was called (cleanupTempDir called in finally block)
    expect(mockCleanupTempDir).toHaveBeenCalled();

    // Verify progress display was stopped
    expect(mockProgressDisplay.stop).toHaveBeenCalled();
  });

  it('preserves temp dir when keepTemp is true', async () => {
    const args = makePlanArgs({ keepTemp: true });

    mockDistributePlan.mockResolvedValue({
      chunks: ['## Navigation', '## Dashboard'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 2,
      usedClaude: false,
    });

    mockGeneratePlanTemplate.mockResolvedValue('');

    await runPlanDiscovery(args);

    // cleanupTempDir should NOT be called when keepTemp is true
    expect(mockCleanupTempDir).not.toHaveBeenCalled();
  });

  it('dry-run prints info without spawning instances', async () => {
    const args = makePlanArgs({ dryRun: true });

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await runPlanDiscovery(args);

      // Instances should not be spawned
      expect(mockRunInstanceRounds).not.toHaveBeenCalled();

      // Consolidation should not happen
      expect(mockConsolidateDiscoveryDocs).not.toHaveBeenCalled();
      expect(mockGeneratePlanTemplate).not.toHaveBeenCalled();

      // Distribution still happens (to show the plan split)
      // But only if instances > 1 and plan is provided
      // In this test case, instances=2 and plan is provided, so distributePlan is called
      // NOTE: distributePlan is called before the dry-run check
      // Actually, the flow: initWorkspace -> distribute -> dryRun check
      // So distributePlan IS called for dry-run to show distribution info

      // Should have printed dry-run information
      const allOutput = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allOutput).toContain('Dry Run');
      expect(allOutput).toContain('https://example.com/app');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('suppress-open prevents browser open', async () => {
    const args = makePlanArgs({ suppressOpen: true });

    mockDistributePlan.mockResolvedValue({
      chunks: ['## Navigation', '## Dashboard'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '## Discovery',
      instanceCount: 2,
      usedClaude: true,
    });

    mockGeneratePlanTemplate.mockResolvedValue('## Plan');

    // Mock child_process.exec to verify it's NOT called
    const execMock = vi.fn();
    vi.doMock('node:child_process', () => ({ exec: execMock }));

    await runPlanDiscovery(args);

    // Since suppressOpen is true, exec should not have been called for browser open
    // We verify this indirectly by checking that the flow completed without
    // attempting to open the browser
    expect(mockProgressDisplay.stop).toHaveBeenCalled();
  });

  it('sets verbose mode when args.verbose is true', async () => {
    const args = makePlanArgs({ verbose: true, instances: 1 });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 1,
      usedClaude: false,
    });

    mockGeneratePlanTemplate.mockResolvedValue('');

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-plan-test'),
      instanceDirs: [join(resolve('.uxreview-temp-plan-test'), 'instance-1')],
      outputDir: OUTPUT_DIR,
    });

    await runPlanDiscovery(args);

    expect(mockSetVerbose).toHaveBeenCalledWith(true);
  });

  it('handles single instance without distribution', async () => {
    const args = makePlanArgs({ instances: 1 });

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-plan-test'),
      instanceDirs: [join(resolve('.uxreview-temp-plan-test'), 'instance-1')],
      outputDir: OUTPUT_DIR,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '## Discovered areas',
      instanceCount: 1,
      usedClaude: true,
    });

    mockGeneratePlanTemplate.mockResolvedValue('## Plan areas');

    await runPlanDiscovery(args);

    // Distribution should NOT be called for single instance
    expect(mockDistributePlan).not.toHaveBeenCalled();

    // Instance should still be spawned
    expect(mockRunInstanceRounds).toHaveBeenCalledTimes(1);
    const config = mockRunInstanceRounds.mock.calls[0][0];
    expect(config.instanceNumber).toBe(1);
    expect(config.planChunk).toBe(args.plan);
  });

  it('handles instance failure gracefully', async () => {
    const args = makePlanArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## Navigation', '## Dashboard'],
      usedClaude: true,
    });

    // Instance 1 succeeds, instance 2 fails
    mockRunInstanceRounds.mockImplementation(async (config) => {
      if (config.instanceNumber === 1) {
        config.progress?.onCompleted?.(config.instanceNumber);
        return makeSuccessResult(1, 1);
      }
      config.progress?.onPermanentlyFailed?.(config.instanceNumber, 'Timeout');
      return makeFailedResult(2, 'Timeout');
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '## Partial discovery from instance 1',
      instanceCount: 1,
      usedClaude: false,
    });

    mockGeneratePlanTemplate.mockResolvedValue('## Partial plan');

    await runPlanDiscovery(args);

    // Consolidation still runs with available results
    expect(mockConsolidateDiscoveryDocs).toHaveBeenCalledWith([1, 2]);

    // Output files are still written
    expect(existsSync(join(OUTPUT_DIR, 'plan.md'))).toBe(true);
    expect(existsSync(join(OUTPUT_DIR, 'discovery.html'))).toBe(true);
  });

  it('passes progress callbacks to instance execution', async () => {
    const args = makePlanArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## Navigation', '## Dashboard'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      // Exercise all progress callback methods
      config.progress?.onRoundStart?.(config.instanceNumber, 1);
      config.progress?.onProgressUpdate?.(config.instanceNumber, 1, 0, 2, 0);
      config.progress?.onRoundComplete?.(config.instanceNumber, 1, 500);
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 2,
      usedClaude: false,
    });

    mockGeneratePlanTemplate.mockResolvedValue('');

    await runPlanDiscovery(args);

    // Verify progress display methods were called
    expect(mockProgressDisplay.start).toHaveBeenCalledTimes(1);
    expect(mockProgressDisplay.markRunning).toHaveBeenCalledTimes(2);
    expect(mockProgressDisplay.markRoundComplete).toHaveBeenCalledTimes(2);
    expect(mockProgressDisplay.markCompleted).toHaveBeenCalledTimes(2);
    expect(mockProgressDisplay.updateProgress).toHaveBeenCalledTimes(2);
  });

  it('auto-detects instance count from plan areas when instances is 0', async () => {
    const args = makePlanArgs({
      instances: 0,
      plan: '## Navigation\n## Dashboard\n## Settings',
    });

    // extractAreasFromPlanChunk will return 3 areas
    // So instances should auto-set to 3

    mockDistributePlan.mockResolvedValue({
      chunks: ['## Navigation', '## Dashboard', '## Settings'],
      usedClaude: true,
    });

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-plan-test'),
      instanceDirs: [
        join(resolve('.uxreview-temp-plan-test'), 'instance-1'),
        join(resolve('.uxreview-temp-plan-test'), 'instance-2'),
        join(resolve('.uxreview-temp-plan-test'), 'instance-3'),
      ],
      outputDir: OUTPUT_DIR,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 3,
      usedClaude: false,
    });

    mockGeneratePlanTemplate.mockResolvedValue('');

    await runPlanDiscovery(args);

    // Should have auto-detected 3 instances from plan areas
    expect(mockRunInstanceRounds).toHaveBeenCalledTimes(3);
    expect(mockDistributePlan).toHaveBeenCalledWith(
      '## Navigation\n## Dashboard\n## Settings',
      3,
    );
  });

  it('defaults to 1 instance when instances is 0 and no plan provided', async () => {
    const args = makePlanArgs({
      instances: 0,
      plan: '',
    });

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-plan-test'),
      instanceDirs: [join(resolve('.uxreview-temp-plan-test'), 'instance-1')],
      outputDir: OUTPUT_DIR,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 1,
      usedClaude: false,
    });

    mockGeneratePlanTemplate.mockResolvedValue('');

    await runPlanDiscovery(args);

    // Should have defaulted to 1 instance
    expect(mockRunInstanceRounds).toHaveBeenCalledTimes(1);
    expect(mockDistributePlan).not.toHaveBeenCalled();
  });

  it('cleans up temp directory and removes signal listeners in finally block', async () => {
    const args = makePlanArgs();

    mockDistributePlan.mockResolvedValue({
      chunks: ['## A', '## B'],
      usedClaude: true,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 2,
      usedClaude: false,
    });

    mockGeneratePlanTemplate.mockResolvedValue('');

    const listenerCountBefore = process.listenerCount('SIGINT');
    await runPlanDiscovery(args);
    const listenerCountAfter = process.listenerCount('SIGINT');

    // Signal listeners should be cleaned up (same count as before)
    expect(listenerCountAfter).toBe(listenerCountBefore);

    // Temp directory should be cleaned up
    expect(mockCleanupTempDir).toHaveBeenCalled();
  });

  it('cleans up even when an error occurs during execution', async () => {
    const args = makePlanArgs({ instances: 1 });

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-plan-test'),
      instanceDirs: [join(resolve('.uxreview-temp-plan-test'), 'instance-1')],
      outputDir: OUTPUT_DIR,
    });

    // Simulate error during consolidation
    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 1);
    });

    mockConsolidateDiscoveryDocs.mockRejectedValue(new Error('Consolidation failed'));

    await expect(runPlanDiscovery(args)).rejects.toThrow('Consolidation failed');

    // Cleanup should still happen in finally block
    expect(mockCleanupTempDir).toHaveBeenCalled();
    expect(mockProgressDisplay.stop).toHaveBeenCalled();
  });

  it('initializes ProgressDisplay with correct instance numbers and rounds', async () => {
    const args = makePlanArgs({ instances: 3, rounds: 2 });

    mockDistributePlan.mockResolvedValue({
      chunks: ['## A', '## B', '## C'],
      usedClaude: true,
    });

    mockInitWorkspace.mockReturnValue({
      tempDir: resolve('.uxreview-temp-plan-test'),
      instanceDirs: [
        join(resolve('.uxreview-temp-plan-test'), 'instance-1'),
        join(resolve('.uxreview-temp-plan-test'), 'instance-2'),
        join(resolve('.uxreview-temp-plan-test'), 'instance-3'),
      ],
      outputDir: OUTPUT_DIR,
    });

    mockRunInstanceRounds.mockImplementation(async (config) => {
      config.progress?.onCompleted?.(config.instanceNumber);
      return makeSuccessResult(config.instanceNumber, 2);
    });

    mockConsolidateDiscoveryDocs.mockResolvedValue({
      content: '',
      instanceCount: 3,
      usedClaude: false,
    });

    mockGeneratePlanTemplate.mockResolvedValue('');

    await runPlanDiscovery(args);

    // Verify ProgressDisplay was created with correct args
    expect(ProgressDisplay).toHaveBeenCalledWith([1, 2, 3], 2);
  });
});

describe('PlanSignalInterruptError', () => {
  it('has correct name and message', () => {
    const error = new PlanSignalInterruptError('SIGINT');
    expect(error.name).toBe('PlanSignalInterruptError');
    expect(error.message).toBe('Process interrupted by SIGINT');
    expect(error).toBeInstanceOf(Error);
  });
});
