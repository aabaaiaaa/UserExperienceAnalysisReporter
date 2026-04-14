import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import {
  buildInstancePrompt,
  buildDiscoveryPrompt,
  spawnInstance,
  spawnInstances,
  runInstanceRounds,
  InstanceConfig,
  RoundExecutionConfig,
  ProgressCallback,
} from '../src/instance-manager.js';

// Mock the claude-cli module
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

const TEST_TEMP_DIR = resolve('.uxreview-temp-instance-test');

// Mock file-manager to return deterministic paths
vi.mock('../src/file-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/file-manager.js')>();
  return {
    ...original,
    getInstancePaths: (n: number) => {
      const dir = join(TEST_TEMP_DIR, `instance-${n}`);
      return {
        dir,
        discovery: join(dir, 'discovery.md'),
        checkpoint: join(dir, 'checkpoint.json'),
        report: join(dir, 'report.md'),
        screenshots: join(dir, 'screenshots'),
      };
    },
  };
});

// Mock sleep to avoid waiting in tests
vi.mock('../src/rate-limit.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/rate-limit.js')>();
  return {
    ...original,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

import { runClaude } from '../src/claude-cli.js';
const mockRunClaude = vi.mocked(runClaude);

const BASE_CONFIG: InstanceConfig = {
  instanceNumber: 1,
  url: 'https://example.com/app',
  intro: 'This is a test app for reviewing UX.',
  planChunk: '## Navigation\n- Review main nav bar\n- Check breadcrumb trail',
  scope: '## Layout\n- Check spacing consistency',
};

describe('buildInstancePrompt', () => {
  it('includes the target URL', () => {
    const prompt = buildInstancePrompt(BASE_CONFIG);
    expect(prompt).toContain('https://example.com/app');
  });

  it('includes the intro document', () => {
    const prompt = buildInstancePrompt(BASE_CONFIG);
    expect(prompt).toContain('This is a test app for reviewing UX.');
  });

  it('includes the plan chunk', () => {
    const prompt = buildInstancePrompt(BASE_CONFIG);
    expect(prompt).toContain('## Navigation');
    expect(prompt).toContain('Review main nav bar');
    expect(prompt).toContain('Check breadcrumb trail');
  });

  it('includes the evaluation scope', () => {
    const prompt = buildInstancePrompt(BASE_CONFIG);
    expect(prompt).toContain('## Layout');
    expect(prompt).toContain('Check spacing consistency');
  });

  it('includes file paths for discovery, checkpoint, and report', () => {
    const prompt = buildInstancePrompt(BASE_CONFIG);
    expect(prompt).toContain('discovery.md');
    expect(prompt).toContain('checkpoint.json');
    expect(prompt).toContain('report.md');
  });

  it('includes screenshot directory path', () => {
    const prompt = buildInstancePrompt(BASE_CONFIG);
    expect(prompt).toContain('screenshots');
  });

  it('uses instance-scoped finding ID prefix', () => {
    const prompt = buildInstancePrompt(BASE_CONFIG);
    expect(prompt).toContain('I1-UXR-');

    const prompt2 = buildInstancePrompt({ ...BASE_CONFIG, instanceNumber: 3 });
    expect(prompt2).toContain('I3-UXR-');
  });

  it('includes checkpoint JSON schema with correct instance ID', () => {
    const prompt = buildInstancePrompt({ ...BASE_CONFIG, instanceNumber: 2 });
    expect(prompt).toContain('"instanceId": 2');
  });

  it('includes instructions to resume from checkpoint', () => {
    const prompt = buildInstancePrompt(BASE_CONFIG);
    expect(prompt).toContain('checkpoint');
    expect(prompt).toContain('resume');
  });

  it('uses strong checkpoint language demanding frequent updates', () => {
    const prompt = buildInstancePrompt(BASE_CONFIG);
    // Must NOT contain the old vague phrasing
    expect(prompt).not.toContain('significant step');
    // Must contain emphatic language about frequent checkpoint updates
    expect(prompt).toContain('EVERY page navigation');
    expect(prompt).toContain('EVERY screenshot');
    expect(prompt).toContain('EVERY finding');
    expect(prompt).toContain('real time');
  });
});

describe('spawnInstance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls runClaude with the built prompt', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'Analysis complete',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await spawnInstance(BASE_CONFIG);

    expect(mockRunClaude).toHaveBeenCalledOnce();
    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.prompt).toContain('https://example.com/app');
    expect(callArgs.prompt).toContain('This is a test app');
    expect(callArgs.prompt).toContain('## Navigation');
    expect(callArgs.prompt).toContain('Check spacing consistency');
  });

  it('sets the working directory to the instance directory', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await spawnInstance(BASE_CONFIG);

    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.cwd).toContain('instance-1');
  });

  it('uses a 30 minute timeout', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await spawnInstance(BASE_CONFIG);

    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.timeout).toBe(30 * 60 * 1000);
  });

  it('passes allowed tools as extra args', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await spawnInstance(BASE_CONFIG);

    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.extraArgs).toContain('--allowedTools');
  });

  it('returns completed state on successful execution', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'Analysis complete',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const state = await spawnInstance(BASE_CONFIG);

    expect(state.instanceNumber).toBe(1);
    expect(state.status).toBe('completed');
    expect(state.result?.success).toBe(true);
    expect(state.result?.stdout).toBe('Analysis complete');
    expect(state.error).toBeUndefined();
  });

  it('returns failed state on non-zero exit code', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'partial output',
      stderr: 'Error: MCP connection failed',
      exitCode: 1,
      success: false,
    });

    const state = await spawnInstance(BASE_CONFIG);

    expect(state.instanceNumber).toBe(1);
    expect(state.status).toBe('failed');
    expect(state.result?.success).toBe(false);
    expect(state.error).toBe('Error: MCP connection failed');
  });

  it('returns failed state with exit code message when stderr is empty', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 2,
      success: false,
    });

    const state = await spawnInstance(BASE_CONFIG);

    expect(state.status).toBe('failed');
    expect(state.error).toBe('Instance exited with code 2');
  });

  it('returns failed state when runClaude throws', async () => {
    mockRunClaude.mockRejectedValue(new Error('Failed to spawn Claude Code CLI: ENOENT'));

    const state = await spawnInstance(BASE_CONFIG);

    expect(state.status).toBe('failed');
    expect(state.error).toBe('Failed to spawn Claude Code CLI: ENOENT');
    expect(state.result).toBeUndefined();
  });

  it('handles non-Error throw from runClaude', async () => {
    mockRunClaude.mockRejectedValue('unexpected string error');

    const state = await spawnInstance(BASE_CONFIG);

    expect(state.status).toBe('failed');
    expect(state.error).toBe('unexpected string error');
  });

  it('uses correct instance number for different instances', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const state = await spawnInstance({ ...BASE_CONFIG, instanceNumber: 3 });

    expect(state.instanceNumber).toBe(3);
    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.cwd).toContain('instance-3');
    expect(callArgs.prompt).toContain('I3-UXR-');
  });

  it('uses custom promptBuilder when provided', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const customPromptBuilder = vi.fn().mockReturnValue('Custom discovery prompt');
    const config: InstanceConfig = {
      ...BASE_CONFIG,
      promptBuilder: customPromptBuilder,
    };

    await spawnInstance(config);

    expect(customPromptBuilder).toHaveBeenCalledOnce();
    expect(customPromptBuilder).toHaveBeenCalledWith(config);
    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.prompt).toBe('Custom discovery prompt');
  });
});

describe('spawnInstances', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns all instances in parallel', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const configs: InstanceConfig[] = [
      { ...BASE_CONFIG, instanceNumber: 1, planChunk: 'Chunk 1' },
      { ...BASE_CONFIG, instanceNumber: 2, planChunk: 'Chunk 2' },
      { ...BASE_CONFIG, instanceNumber: 3, planChunk: 'Chunk 3' },
    ];

    const states = await spawnInstances(configs);

    expect(states).toHaveLength(3);
    expect(mockRunClaude).toHaveBeenCalledTimes(3);
    states.forEach((state, i) => {
      expect(state.instanceNumber).toBe(i + 1);
      expect(state.status).toBe('completed');
    });
  });

  it('isolates failures — one failing instance does not affect others', async () => {
    mockRunClaude
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0, success: true })
      .mockResolvedValueOnce({ stdout: '', stderr: 'crash', exitCode: 1, success: false })
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0, success: true });

    const configs: InstanceConfig[] = [
      { ...BASE_CONFIG, instanceNumber: 1 },
      { ...BASE_CONFIG, instanceNumber: 2 },
      { ...BASE_CONFIG, instanceNumber: 3 },
    ];

    const states = await spawnInstances(configs);

    expect(states[0].status).toBe('completed');
    expect(states[1].status).toBe('failed');
    expect(states[1].error).toBe('crash');
    expect(states[2].status).toBe('completed');
  });

  it('handles spawn rejection for one instance gracefully', async () => {
    mockRunClaude
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0, success: true })
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0, success: true });

    const configs: InstanceConfig[] = [
      { ...BASE_CONFIG, instanceNumber: 1 },
      { ...BASE_CONFIG, instanceNumber: 2 },
      { ...BASE_CONFIG, instanceNumber: 3 },
    ];

    const states = await spawnInstances(configs);

    expect(states[0].status).toBe('completed');
    // Instance 2 failed in spawnInstance but was caught, so allSettled still fulfills
    expect(states[1].status).toBe('failed');
    expect(states[1].error).toBe('ENOENT');
    expect(states[2].status).toBe('completed');
  });

  it('returns empty array for empty config', async () => {
    const states = await spawnInstances([]);
    expect(states).toHaveLength(0);
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it('handles Promise.allSettled rejection when promptBuilder throws an Error', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const configs: InstanceConfig[] = [
      { ...BASE_CONFIG, instanceNumber: 1 },
      {
        ...BASE_CONFIG,
        instanceNumber: 2,
        promptBuilder: () => { throw new Error('prompt builder crashed'); },
      },
    ];

    const states = await spawnInstances(configs);

    expect(states).toHaveLength(2);
    expect(states[0].status).toBe('completed');
    expect(states[0].instanceNumber).toBe(1);
    expect(states[1].instanceNumber).toBe(2);
    expect(states[1].status).toBe('failed');
    expect(states[1].error).toBe('prompt builder crashed');
  });

  it('handles Promise.allSettled rejection with non-Error throw via String(result.reason)', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const configs: InstanceConfig[] = [
      { ...BASE_CONFIG, instanceNumber: 1 },
      {
        ...BASE_CONFIG,
        instanceNumber: 2,
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        promptBuilder: () => { throw 'string rejection reason'; },
      },
    ];

    const states = await spawnInstances(configs);

    expect(states).toHaveLength(2);
    expect(states[0].status).toBe('completed');
    expect(states[0].instanceNumber).toBe(1);
    expect(states[1].instanceNumber).toBe(2);
    expect(states[1].status).toBe('failed');
    expect(states[1].error).toBe('string rejection reason');
  });
});

describe('spawnInstance with custom timeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses custom timeoutMs when provided', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await spawnInstance({ ...BASE_CONFIG, timeoutMs: 10 * 60 * 1000 });

    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.timeout).toBe(10 * 60 * 1000);
  });

  it('uses default INSTANCE_TIMEOUT_MS when timeoutMs is not provided', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await spawnInstance(BASE_CONFIG);

    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.timeout).toBe(30 * 60 * 1000);
  });
});

describe('runInstanceRounds with custom config values', () => {
  const BASE_ROUND_CONFIG: RoundExecutionConfig = {
    instanceNumber: 1,
    url: 'https://example.com/app',
    intro: 'Test app context.',
    planChunk: '## Navigation\n- Review main nav bar',
    scope: '## Layout\n- Check spacing consistency',
    totalRounds: 1,
    assignedAreas: ['Navigation'],
  };

  beforeEach(() => {
    mkdirSync(join(TEST_TEMP_DIR, 'instance-1'), { recursive: true });
    mkdirSync(join(TEST_TEMP_DIR, 'instance-1', 'screenshots'), { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  it('threads custom instanceTimeoutMs to runClaude', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      instanceTimeoutMs: 15 * 60 * 1000, // 15 minutes
    });

    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.timeout).toBe(15 * 60 * 1000);
  });

  it('uses default INSTANCE_TIMEOUT_MS when instanceTimeoutMs not provided', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await runInstanceRounds(BASE_ROUND_CONFIG);

    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.timeout).toBe(30 * 60 * 1000);
  });

  it('uses custom maxRetries to limit retry attempts', async () => {
    // All calls fail with non-rate-limit error
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'MCP crash',
      exitCode: 1,
      success: false,
    });

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      maxRetries: 2,
    });

    expect(result.status).toBe('failed');
    expect(result.permanentlyFailed).toBe(true);
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].attempts).toBe(2);
    // 1 initial + 2 retries = 3 total calls
    expect(mockRunClaude).toHaveBeenCalledTimes(3);
  });

  it('round fails, retries exhaust, and permanentlyFailed callbacks fire with error accumulation', async () => {
    // All calls fail with a non-rate-limit error
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'MCP connection lost',
      exitCode: 1,
      success: false,
    });

    const callbacks: ProgressCallback = {
      onFailure: vi.fn(),
      onRetry: vi.fn(),
      onPermanentlyFailed: vi.fn(),
      onRoundStart: vi.fn(),
      onProgressUpdate: vi.fn(),
    };

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      maxRetries: 1,
      progress: callbacks,
    });

    // The instance should be permanently failed
    expect(result.status).toBe('failed');
    expect(result.permanentlyFailed).toBe(true);
    expect(result.completedRounds).toBe(0);
    expect(result.error).toBe('MCP connection lost');

    // onFailure should have been called once (on initial failure, before entering retry loop)
    expect(callbacks.onFailure).toHaveBeenCalledOnce();
    expect(callbacks.onFailure).toHaveBeenCalledWith(1, 1, 'MCP connection lost');

    // onRetry should have been called once (maxRetries: 1 means one retry attempt)
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
    expect(callbacks.onRetry).toHaveBeenCalledWith(1, 1, 1, 1); // instance, round, attempt, maxRetries

    // onPermanentlyFailed should have been called when retries were exhausted
    expect(callbacks.onPermanentlyFailed).toHaveBeenCalledOnce();
    expect(callbacks.onPermanentlyFailed).toHaveBeenCalledWith(1, 'MCP connection lost');

    // retries array should have one entry for round 1
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].round).toBe(1);
    expect(result.retries[0].attempts).toBe(1);
    expect(result.retries[0].succeeded).toBe(false);

    // errors array: initial error + 1 retry error = 2 entries
    expect(result.retries[0].errors).toHaveLength(2);
    expect(result.retries[0].errors[0]).toBe('MCP connection lost');
    expect(result.retries[0].errors[1]).toBe('MCP connection lost');

    // 1 initial + 1 retry = 2 total calls
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });

  it('uses custom rateLimitRetries to limit rate-limit retry attempts', async () => {
    // All calls return rate-limit errors
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'Error: rate limit exceeded',
      exitCode: 1,
      success: false,
    });

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      rateLimitRetries: 3,
      maxRetries: 0,
    });

    expect(result.status).toBe('failed');
    expect(result.permanentlyFailed).toBe(true);
    // 1 initial + 3 rate-limit retries = 4 total calls
    expect(mockRunClaude).toHaveBeenCalledTimes(4);
  });

  it('defaults to config values when custom values not provided', async () => {
    // Fail with non-rate-limit error to test maxRetries default (3)
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'MCP crash',
      exitCode: 1,
      success: false,
    });

    const result = await runInstanceRounds(BASE_ROUND_CONFIG);

    expect(result.status).toBe('failed');
    expect(result.permanentlyFailed).toBe(true);
    expect(result.retries[0].attempts).toBe(3); // default MAX_RETRIES
    // 1 initial + 3 retries = 4 total calls
    expect(mockRunClaude).toHaveBeenCalledTimes(4);
  });

  it('creates synthetic failure when rate-limit retry respawn throws (result undefined)', async () => {
    // Call 1: rate-limit error from initial spawn
    mockRunClaude.mockResolvedValueOnce({
      stdout: '',
      stderr: 'Error: rate limit exceeded',
      exitCode: 1,
      success: false,
    });
    // Call 2: respawn during rate-limit retry throws — spawnInstanceWithResume catches it,
    // setting state.error but leaving state.result undefined → synthetic failure path
    mockRunClaude.mockRejectedValueOnce(new Error('ECONNRESET'));
    // Call 3: normal retry succeeds
    mockRunClaude.mockResolvedValueOnce({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      rateLimitRetries: 3,
      maxRetries: 1,
    });

    expect(result.status).toBe('completed');
    expect(mockRunClaude).toHaveBeenCalledTimes(3);
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].succeeded).toBe(true);
  });
});

describe('onProgressUpdate callback', () => {
  const BASE_ROUND_CONFIG: RoundExecutionConfig = {
    instanceNumber: 1,
    url: 'https://example.com/app',
    intro: 'Test app context.',
    planChunk: '## Navigation\n- Review main nav bar',
    scope: '## Layout\n- Check spacing consistency',
    totalRounds: 1,
    assignedAreas: ['Navigation', 'Forms'],
  };

  beforeEach(() => {
    mkdirSync(join(TEST_TEMP_DIR, 'instance-1'), { recursive: true });
    mkdirSync(join(TEST_TEMP_DIR, 'instance-1', 'screenshots'), { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  it('fires onProgressUpdate with initial checkpoint data at round start', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const onProgressUpdate = vi.fn();
    const progress: ProgressCallback = { onProgressUpdate };

    await runInstanceRounds({ ...BASE_ROUND_CONFIG, progress });

    // First call should be from the initial checkpoint write (all not-started)
    expect(onProgressUpdate).toHaveBeenCalled();
    const firstCall = onProgressUpdate.mock.calls[0];
    expect(firstCall[0]).toBe(1);  // instanceNumber
    expect(firstCall[1]).toBe(0);  // completedItems
    expect(firstCall[2]).toBe(0);  // inProgressItems
    expect(firstCall[3]).toBe(2);  // totalItems (Navigation, Forms)
    expect(firstCall[4]).toBe(0);  // findingsCount (no report yet)
  });

  it('fires onProgressUpdate after spawn completes with updated checkpoint', async () => {
    // Mock runClaude to write an updated checkpoint as a side effect
    mockRunClaude.mockImplementation(async () => {
      const cpPath = join(TEST_TEMP_DIR, 'instance-1', 'checkpoint.json');
      const checkpoint = {
        instanceId: 1,
        assignedAreas: ['Navigation', 'Forms'],
        currentRound: 1,
        areas: [
          { name: 'Navigation', status: 'complete' },
          { name: 'Forms', status: 'in-progress' },
        ],
        lastAction: 'Reviewed navigation',
        timestamp: new Date().toISOString(),
      };
      writeFileSync(cpPath, JSON.stringify(checkpoint), 'utf-8');
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const onProgressUpdate = vi.fn();
    const progress: ProgressCallback = { onProgressUpdate };

    await runInstanceRounds({ ...BASE_ROUND_CONFIG, progress });

    // Should be called at least twice: initial checkpoint + after spawn
    expect(onProgressUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);

    // The post-spawn call should reflect the updated checkpoint
    const postSpawnCall = onProgressUpdate.mock.calls[1];
    expect(postSpawnCall[0]).toBe(1);  // instanceNumber
    expect(postSpawnCall[1]).toBe(1);  // completedItems (Navigation)
    expect(postSpawnCall[2]).toBe(1);  // inProgressItems (Forms)
    expect(postSpawnCall[3]).toBe(2);  // totalItems
    expect(postSpawnCall[4]).toBe(0);  // findingsCount (no report file)
  });

  it('includes findings count from report file', async () => {
    // Mock runClaude to write checkpoint and report as side effects
    mockRunClaude.mockImplementation(async () => {
      const cpPath = join(TEST_TEMP_DIR, 'instance-1', 'checkpoint.json');
      const checkpoint = {
        instanceId: 1,
        assignedAreas: ['Navigation', 'Forms'],
        currentRound: 1,
        areas: [
          { name: 'Navigation', status: 'complete' },
          { name: 'Forms', status: 'complete' },
        ],
        lastAction: 'Completed review',
        timestamp: new Date().toISOString(),
      };
      writeFileSync(cpPath, JSON.stringify(checkpoint), 'utf-8');

      const reportPath = join(TEST_TEMP_DIR, 'instance-1', 'report.md');
      const reportContent = [
        '# Instance 1 Report',
        '',
        '## I1-UXR-001: Missing breadcrumb',
        'Details here',
        '',
        '## I1-UXR-002: Form validation unclear',
        'Details here',
      ].join('\n');
      writeFileSync(reportPath, reportContent, 'utf-8');

      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const onProgressUpdate = vi.fn();
    const progress: ProgressCallback = { onProgressUpdate };

    await runInstanceRounds({ ...BASE_ROUND_CONFIG, progress });

    // The post-spawn call should include findings count
    const postSpawnCall = onProgressUpdate.mock.calls[1];
    expect(postSpawnCall[0]).toBe(1);  // instanceNumber
    expect(postSpawnCall[1]).toBe(2);  // completedItems
    expect(postSpawnCall[2]).toBe(0);  // inProgressItems
    expect(postSpawnCall[3]).toBe(2);  // totalItems
    expect(postSpawnCall[4]).toBe(2);  // findingsCount (2 findings in report)
  });

  it('fires onProgressUpdate during retry with fresh checkpoint', async () => {
    let callCount = 0;
    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call fails — don't write a valid checkpoint
        return { stdout: '', stderr: 'crash', exitCode: 1, success: false };
      }
      // Retry succeeds
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const onProgressUpdate = vi.fn();
    const progress: ProgressCallback = { onProgressUpdate };

    await runInstanceRounds({ ...BASE_ROUND_CONFIG, progress });

    // Should have multiple calls:
    // 1. Initial checkpoint write
    // 2. After failed spawn (reads checkpoint from file)
    // 3. Fresh checkpoint write on retry (since initial spawn didn't write a valid checkpoint)
    // 4. After retry spawn
    expect(onProgressUpdate.mock.calls.length).toBeGreaterThanOrEqual(3);

    // All calls should have the correct instanceNumber and totalItems
    for (const call of onProgressUpdate.mock.calls) {
      expect(call[0]).toBe(1);  // instanceNumber
      expect(call[3]).toBe(2);  // totalItems (Navigation, Forms)
    }
  });

  it('is not called when onProgressUpdate is not provided', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    // No onProgressUpdate in callbacks — should not throw
    const progress: ProgressCallback = {
      onRoundStart: vi.fn(),
    };

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, progress });
    expect(result.status).toBe('completed');
  });
});

describe('buildDiscoveryPrompt', () => {
  it('includes the target URL', () => {
    const prompt = buildDiscoveryPrompt(BASE_CONFIG);
    expect(prompt).toContain('https://example.com/app');
  });

  it('includes the intro text', () => {
    const prompt = buildDiscoveryPrompt(BASE_CONFIG);
    expect(prompt).toContain('This is a test app for reviewing UX.');
  });

  it('includes discovery instructions', () => {
    const prompt = buildDiscoveryPrompt(BASE_CONFIG);
    // buildDiscoveryInstructions outputs the "Discovery Document:" header
    expect(prompt).toContain('Discovery Document:');
    // It also includes the discovery entry format
    expect(prompt).toContain('Track what you explore');
  });

  it('includes screenshot instructions', () => {
    const prompt = buildDiscoveryPrompt(BASE_CONFIG);
    // buildScreenshotInstructions outputs the "Screenshots Directory:" header
    expect(prompt).toContain('Screenshots Directory:');
    expect(prompt).toContain('Capture screenshots');
  });

  it('does NOT include report instructions', () => {
    const prompt = buildDiscoveryPrompt(BASE_CONFIG);
    // buildReportInstructions outputs "Report Document:" and severity-related text
    expect(prompt).not.toContain('report.md');
    expect(prompt).not.toContain('### 2. Report');
    expect(prompt).not.toContain('Severity');
    expect(prompt).not.toContain('critical | major | minor | suggestion');
  });

  it('includes "Areas to Explore" and plan chunk content when planChunk is provided', () => {
    const prompt = buildDiscoveryPrompt(BASE_CONFIG);
    expect(prompt).toContain('Areas to Explore');
    expect(prompt).toContain('Review main nav bar');
    expect(prompt).toContain('Check breadcrumb trail');
  });

  it('includes free exploration instructions when planChunk is empty', () => {
    const emptyPlanConfig: InstanceConfig = {
      ...BASE_CONFIG,
      planChunk: '',
    };
    const prompt = buildDiscoveryPrompt(emptyPlanConfig);
    expect(prompt).toContain('Explore the entire site freely');
    expect(prompt).not.toContain('Areas to Explore');
  });

  it('includes free exploration instructions when planChunk is whitespace only', () => {
    const whitespacePlanConfig: InstanceConfig = {
      ...BASE_CONFIG,
      planChunk: '   \n  ',
    };
    const prompt = buildDiscoveryPrompt(whitespacePlanConfig);
    expect(prompt).toContain('Explore the entire site freely');
    expect(prompt).not.toContain('Areas to Explore');
  });

  it('includes checkpoint instructions with frequent-update language', () => {
    const prompt = buildDiscoveryPrompt(BASE_CONFIG);
    expect(prompt).toContain('checkpoint');
    expect(prompt).toContain('EVERY page navigation');
    expect(prompt).toContain('EVERY screenshot');
    expect(prompt).toContain('real time');
  });

  it('frames scope as exploration guidance, not evaluation criteria', () => {
    const prompt = buildDiscoveryPrompt(BASE_CONFIG);
    expect(prompt).not.toContain('Evaluate the application against');
    expect(prompt).toContain('Exploration Guidance');
    expect(prompt).toContain('things to look for during exploration');
  });

  it('includes checkpoint JSON schema with correct instance ID', () => {
    const prompt = buildDiscoveryPrompt({ ...BASE_CONFIG, instanceNumber: 2 });
    expect(prompt).toContain('"instanceId": 2');
  });

  it('uses instance-scoped screenshot naming', () => {
    const prompt = buildDiscoveryPrompt(BASE_CONFIG);
    expect(prompt).toContain('I1-UXR-');

    const prompt2 = buildDiscoveryPrompt({ ...BASE_CONFIG, instanceNumber: 3 });
    expect(prompt2).toContain('I3-UXR-');
  });

  it('omits exploration guidance section when scope is empty', () => {
    const emptyScopeConfig: InstanceConfig = {
      ...BASE_CONFIG,
      scope: '',
    };
    const prompt = buildDiscoveryPrompt(emptyScopeConfig);
    expect(prompt).not.toContain('Exploration Guidance');
    expect(prompt).not.toContain('things to look for during exploration');
  });

  it('omits exploration guidance section when scope is whitespace only', () => {
    const whitespaceScopeConfig: InstanceConfig = {
      ...BASE_CONFIG,
      scope: '   \n  ',
    };
    const prompt = buildDiscoveryPrompt(whitespaceScopeConfig);
    expect(prompt).not.toContain('Exploration Guidance');
    expect(prompt).not.toContain('things to look for during exploration');
  });
});
