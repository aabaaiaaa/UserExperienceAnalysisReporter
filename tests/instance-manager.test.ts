import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import {
  buildInstancePrompt,
  spawnInstance,
  spawnInstances,
  InstanceConfig,
} from '../src/instance-manager.js';

// Mock the claude-cli module
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

// Mock file-manager to return deterministic paths
vi.mock('../src/file-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/file-manager.js')>();
  return {
    ...original,
    getInstancePaths: (n: number) => {
      const dir = resolve(`.uxreview-temp-instance-test/instance-${n}`);
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
});
