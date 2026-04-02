import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import {
  spawnInstanceWithResume,
  runInstanceRounds,
  RoundExecutionConfig,
  InstanceConfig,
  DEFAULT_MAX_RETRIES,
} from '../src/instance-manager.js';
import { Checkpoint, createInitialCheckpoint } from '../src/checkpoint.js';

const TEST_TEMP_DIR = resolve('.uxreview-temp-retry-test');

// Mock the claude-cli module
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

// Mock file-manager to return deterministic paths within our test temp dir
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

import { runClaude } from '../src/claude-cli.js';
const mockRunClaude = vi.mocked(runClaude);

const BASE_CONFIG: InstanceConfig = {
  instanceNumber: 1,
  url: 'https://example.com/app',
  intro: 'Test app context.',
  planChunk: '## Navigation\n- Review main nav bar\n## Dashboard\n- Check card layout',
  scope: '## Layout\n- Check spacing consistency',
  round: 1,
};

const BASE_ROUND_CONFIG: RoundExecutionConfig = {
  instanceNumber: 1,
  url: 'https://example.com/app',
  intro: 'Test app context.',
  planChunk: '## Navigation\n- Review main nav bar\n## Dashboard\n- Check card layout',
  scope: '## Layout\n- Check spacing consistency',
  totalRounds: 1,
  assignedAreas: ['Navigation', 'Dashboard'],
};

function getCheckpointPath(instanceNumber: number): string {
  return join(TEST_TEMP_DIR, `instance-${instanceNumber}`, 'checkpoint.json');
}

describe('DEFAULT_MAX_RETRIES', () => {
  it('is 3', () => {
    expect(DEFAULT_MAX_RETRIES).toBe(3);
  });
});

describe('spawnInstanceWithResume', () => {
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

  it('appends resume prompt from checkpoint to the base prompt', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const checkpoint: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Navigation', 'Dashboard'],
      currentRound: 1,
      areas: [
        { name: 'Navigation', status: 'complete' },
        { name: 'Dashboard', status: 'in-progress' },
      ],
      lastAction: 'Checked card grid spacing',
      timestamp: '2026-04-02T10:00:00.000Z',
    };

    await spawnInstanceWithResume(BASE_CONFIG, checkpoint);

    expect(mockRunClaude).toHaveBeenCalledOnce();
    const callArgs = mockRunClaude.mock.calls[0][0];

    // Should include the base prompt content
    expect(callArgs.prompt).toContain('https://example.com/app');
    expect(callArgs.prompt).toContain('Test app context.');
    expect(callArgs.prompt).toContain('## Navigation');

    // Should include resume instructions from the checkpoint
    expect(callArgs.prompt).toContain('Resume Instructions');
    expect(callArgs.prompt).toContain('Completed Areas (skip these)');
    expect(callArgs.prompt).toContain('Navigation');
    expect(callArgs.prompt).toContain('In-Progress Areas (resume here)');
    expect(callArgs.prompt).toContain('Dashboard');
    expect(callArgs.prompt).toContain('Checked card grid spacing');
  });

  it('returns completed state on success', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'Resumed and completed',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const checkpoint: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Navigation'],
      currentRound: 1,
      areas: [{ name: 'Navigation', status: 'in-progress' }],
      lastAction: 'Started review',
      timestamp: '2026-04-02T10:00:00.000Z',
    };

    const state = await spawnInstanceWithResume(BASE_CONFIG, checkpoint);

    expect(state.status).toBe('completed');
    expect(state.instanceNumber).toBe(1);
    expect(state.result?.success).toBe(true);
  });

  it('returns failed state on failure', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'Resume failed: MCP error',
      exitCode: 1,
      success: false,
    });

    const checkpoint: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Navigation'],
      currentRound: 1,
      areas: [{ name: 'Navigation', status: 'in-progress' }],
      lastAction: 'Started review',
      timestamp: '2026-04-02T10:00:00.000Z',
    };

    const state = await spawnInstanceWithResume(BASE_CONFIG, checkpoint);

    expect(state.status).toBe('failed');
    expect(state.error).toBe('Resume failed: MCP error');
  });

  it('handles thrown errors gracefully', async () => {
    mockRunClaude.mockRejectedValue(new Error('Spawn failed'));

    const checkpoint: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Navigation'],
      currentRound: 1,
      areas: [{ name: 'Navigation', status: 'in-progress' }],
      lastAction: 'Started review',
      timestamp: '2026-04-02T10:00:00.000Z',
    };

    const state = await spawnInstanceWithResume(BASE_CONFIG, checkpoint);

    expect(state.status).toBe('failed');
    expect(state.error).toBe('Spawn failed');
  });
});

describe('Failure detection, retry, and resume', () => {
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

  it('detects failure from non-zero exit code and retries', async () => {
    // First call fails, second succeeds (retry)
    mockRunClaude
      .mockResolvedValueOnce({ stdout: '', stderr: 'Crash', exitCode: 1, success: false })
      .mockResolvedValueOnce({ stdout: 'Resumed ok', stderr: '', exitCode: 0, success: true });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 1 });

    expect(result.status).toBe('completed');
    expect(result.completedRounds).toBe(1);
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].round).toBe(1);
    expect(result.retries[0].attempts).toBe(1);
    expect(result.retries[0].succeeded).toBe(true);
    expect(result.retries[0].errors).toEqual(['Crash']);
    expect(result.permanentlyFailed).toBeUndefined();
    // Initial call + 1 retry = 2
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });

  it('detects failure from timeout and retries', async () => {
    // First call times out, second succeeds
    mockRunClaude
      .mockResolvedValueOnce({ stdout: '', stderr: 'Process timed out after 1800000ms', exitCode: 1, success: false })
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0, success: true });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 1 });

    expect(result.status).toBe('completed');
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].errors[0]).toContain('timed out');
    expect(result.retries[0].succeeded).toBe(true);
  });

  it('reads checkpoint on failure and retries with resume prompt', async () => {
    let callCount = 0;
    const checkpointPath = getCheckpointPath(1);

    mockRunClaude.mockImplementation(async (opts) => {
      callCount++;
      if (callCount === 1) {
        // First call: simulate Claude updating the checkpoint mid-work, then crashing
        const updatedCheckpoint: Checkpoint = {
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
        writeFileSync(checkpointPath, JSON.stringify(updatedCheckpoint, null, 2), 'utf-8');
        return { stdout: '', stderr: 'Crash mid-review', exitCode: 1, success: false };
      }
      // Second call (retry): should contain resume prompt
      return { stdout: 'Resumed and completed', stderr: '', exitCode: 0, success: true };
    });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 1 });

    expect(result.status).toBe('completed');
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].succeeded).toBe(true);

    // Verify the retry prompt included resume instructions
    const retryCall = mockRunClaude.mock.calls[1][0];
    expect(retryCall.prompt).toContain('Resume Instructions');
    expect(retryCall.prompt).toContain('Completed Areas (skip these)');
    expect(retryCall.prompt).toContain('Navigation');
    expect(retryCall.prompt).toContain('In-Progress Areas (resume here)');
    expect(retryCall.prompt).toContain('Dashboard');
    expect(retryCall.prompt).toContain('Checked card grid spacing');
  });

  it('retried instance resumes from the correct checkpoint point', async () => {
    let callCount = 0;
    const checkpointPath = getCheckpointPath(1);

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Simulate progress: Navigation complete, Dashboard in-progress
        const checkpoint: Checkpoint = {
          instanceId: 1,
          assignedAreas: ['Navigation', 'Dashboard'],
          currentRound: 1,
          areas: [
            { name: 'Navigation', status: 'complete' },
            { name: 'Dashboard', status: 'in-progress' },
          ],
          lastAction: 'Reviewing loading states on dashboard',
          timestamp: '2026-04-02T10:10:00.000Z',
        };
        writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
        return { stdout: '', stderr: 'Connection lost', exitCode: 1, success: false };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 1 });

    expect(result.status).toBe('completed');

    // Check that the retry prompt tells Claude to skip Navigation and resume Dashboard
    const retryPrompt = mockRunClaude.mock.calls[1][0].prompt;
    expect(retryPrompt).toContain('Completed Areas (skip these)');
    expect(retryPrompt).toContain('Navigation');
    expect(retryPrompt).toContain('In-Progress Areas (resume here)');
    expect(retryPrompt).toContain('Dashboard');
    expect(retryPrompt).toContain('Reviewing loading states on dashboard');
    // Should NOT list Navigation as not-started or in-progress
    expect(retryPrompt).not.toContain('Not Started Areas');
  });

  it('restarts round from scratch when checkpoint is missing', async () => {
    let callCount = 0;
    const checkpointPath = getCheckpointPath(1);

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call crashes WITHOUT updating the checkpoint
        // Delete the initial checkpoint to simulate missing file
        if (existsSync(checkpointPath)) {
          rmSync(checkpointPath);
        }
        return { stdout: '', stderr: 'Early crash', exitCode: 1, success: false };
      }
      // Second call (retry from scratch): should NOT contain resume instructions
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 1 });

    expect(result.status).toBe('completed');
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].succeeded).toBe(true);

    // The retry should be a fresh start, not a resume
    const retryCall = mockRunClaude.mock.calls[1][0];
    expect(retryCall.prompt).not.toContain('Resume Instructions');
    expect(retryCall.prompt).not.toContain('Completed Areas (skip these)');

    // A fresh checkpoint should have been written before the retry
    const checkpointRaw = readFileSync(checkpointPath, 'utf-8');
    const checkpoint = JSON.parse(checkpointRaw);
    expect(checkpoint.instanceId).toBe(1);
    expect(checkpoint.currentRound).toBe(1);
    expect(checkpoint.areas.every((a: { status: string }) => a.status === 'not-started')).toBe(true);
  });

  it('restarts round from scratch when checkpoint is corrupted', async () => {
    let callCount = 0;
    const checkpointPath = getCheckpointPath(1);

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Simulate a corrupted checkpoint file
        writeFileSync(checkpointPath, '{ invalid json content!!!', 'utf-8');
        return { stdout: '', stderr: 'Crash', exitCode: 1, success: false };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 1 });

    expect(result.status).toBe('completed');
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].succeeded).toBe(true);

    // The retry should be a fresh start since checkpoint was corrupted
    const retryCall = mockRunClaude.mock.calls[1][0];
    expect(retryCall.prompt).not.toContain('Resume Instructions');
  });

  it('restarts round from scratch when checkpoint has invalid structure', async () => {
    let callCount = 0;
    const checkpointPath = getCheckpointPath(1);

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Write a checkpoint with missing required fields
        writeFileSync(checkpointPath, JSON.stringify({ instanceId: 1 }), 'utf-8');
        return { stdout: '', stderr: 'Crash', exitCode: 1, success: false };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 1 });

    expect(result.status).toBe('completed');

    // Fresh start since checkpoint validation failed
    const retryCall = mockRunClaude.mock.calls[1][0];
    expect(retryCall.prompt).not.toContain('Resume Instructions');
  });

  it('marks instance as permanently failed when retry limit is exceeded', async () => {
    // All calls fail
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'Persistent failure',
      exitCode: 1,
      success: false,
    });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 3 });

    expect(result.status).toBe('failed');
    expect(result.permanentlyFailed).toBe(true);
    expect(result.completedRounds).toBe(0);
    expect(result.error).toBe('Persistent failure');

    // Retry info
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].round).toBe(1);
    expect(result.retries[0].attempts).toBe(3);
    expect(result.retries[0].succeeded).toBe(false);
    // Initial error + 3 retry errors = 4 errors total
    expect(result.retries[0].errors).toHaveLength(4);
    expect(result.retries[0].errors.every((e) => e === 'Persistent failure')).toBe(true);

    // 1 initial + 3 retries = 4 calls
    expect(mockRunClaude).toHaveBeenCalledTimes(4);
  });

  it('uses DEFAULT_MAX_RETRIES when maxRetries is not specified', async () => {
    // All calls fail
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'Failure',
      exitCode: 1,
      success: false,
    });

    const result = await runInstanceRounds(BASE_ROUND_CONFIG);

    expect(result.permanentlyFailed).toBe(true);
    expect(result.retries[0].attempts).toBe(DEFAULT_MAX_RETRIES);
    // 1 initial + DEFAULT_MAX_RETRIES retries
    expect(mockRunClaude).toHaveBeenCalledTimes(1 + DEFAULT_MAX_RETRIES);
  });

  it('collects error messages from all retry attempts', async () => {
    let callCount = 0;

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      const errors = ['MCP crash', 'Timeout', 'Network error', 'OOM killed'];
      return {
        stdout: '',
        stderr: errors[callCount - 1] || 'Unknown',
        exitCode: 1,
        success: false,
      };
    });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 3 });

    expect(result.permanentlyFailed).toBe(true);
    expect(result.retries[0].errors).toEqual([
      'MCP crash',      // initial attempt
      'Timeout',        // retry 1
      'Network error',  // retry 2
      'OOM killed',     // retry 3
    ]);
  });

  it('succeeds on last retry attempt', async () => {
    let callCount = 0;

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount <= 3) {
        return { stdout: '', stderr: `Failure ${callCount}`, exitCode: 1, success: false };
      }
      return { stdout: 'Finally succeeded', stderr: '', exitCode: 0, success: true };
    });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 3 });

    expect(result.status).toBe('completed');
    expect(result.completedRounds).toBe(1);
    expect(result.permanentlyFailed).toBeUndefined();
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].attempts).toBe(3);
    expect(result.retries[0].succeeded).toBe(true);
    expect(result.retries[0].errors).toEqual(['Failure 1', 'Failure 2', 'Failure 3']);
    expect(mockRunClaude).toHaveBeenCalledTimes(4);
  });

  it('handles failure in round 2 with retry and resume', async () => {
    let callCount = 0;
    const checkpointPath = getCheckpointPath(1);

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Round 1 succeeds
        return { stdout: 'Round 1 ok', stderr: '', exitCode: 0, success: true };
      }
      if (callCount === 2) {
        // Round 2 fails with partial progress
        const checkpoint: Checkpoint = {
          instanceId: 1,
          assignedAreas: ['Navigation', 'Dashboard'],
          currentRound: 2,
          areas: [
            { name: 'Navigation', status: 'complete' },
            { name: 'Dashboard', status: 'not-started' },
          ],
          lastAction: 'Deep-checked Navigation hover states',
          timestamp: '2026-04-02T11:00:00.000Z',
        };
        writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
        return { stdout: '', stderr: 'Round 2 crash', exitCode: 1, success: false };
      }
      // callCount === 3: Round 2 retry succeeds
      return { stdout: 'Round 2 resumed ok', stderr: '', exitCode: 0, success: true };
    });

    const config: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      totalRounds: 2,
      maxRetries: 1,
    };

    const result = await runInstanceRounds(config);

    expect(result.status).toBe('completed');
    expect(result.completedRounds).toBe(2);
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].round).toBe(2);
    expect(result.retries[0].succeeded).toBe(true);

    // Verify the round 2 retry has resume instructions
    const round2RetryCall = mockRunClaude.mock.calls[2][0];
    expect(round2RetryCall.prompt).toContain('Resume Instructions');
    expect(round2RetryCall.prompt).toContain('Deep-checked Navigation hover states');
  });

  it('continues with remaining rounds after successful retry', async () => {
    let callCount = 0;

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Round 1 fails
        return { stdout: '', stderr: 'R1 fail', exitCode: 1, success: false };
      }
      // All subsequent calls succeed (retry of round 1, then round 2)
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const config: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      totalRounds: 2,
      maxRetries: 1,
    };

    const result = await runInstanceRounds(config);

    expect(result.status).toBe('completed');
    expect(result.completedRounds).toBe(2);
    expect(result.roundResults).toHaveLength(2);
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].round).toBe(1);
    // 1 initial fail + 1 retry + 1 round 2 = 3 calls
    expect(mockRunClaude).toHaveBeenCalledTimes(3);
  });

  it('permanently fails mid-execution and does not attempt remaining rounds', async () => {
    let callCount = 0;

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        // Round 1 succeeds, round 2 initial fails
        if (callCount === 1) {
          return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: 'R2 crash', exitCode: 1, success: false };
      }
      // All retries fail too
      return { stdout: '', stderr: 'Still failing', exitCode: 1, success: false };
    });

    const config: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      totalRounds: 3,
      maxRetries: 2,
    };

    const result = await runInstanceRounds(config);

    expect(result.status).toBe('failed');
    expect(result.permanentlyFailed).toBe(true);
    expect(result.completedRounds).toBe(1);
    // Round 1 completed, round 2 failed permanently, round 3 never attempted
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].round).toBe(2);
    expect(result.retries[0].attempts).toBe(2);
    expect(result.retries[0].succeeded).toBe(false);
    // 1 (round 1) + 1 (round 2 initial) + 2 (retries) = 4
    expect(mockRunClaude).toHaveBeenCalledTimes(4);
  });

  it('handles multiple rounds each needing retries', async () => {
    let callCount = 0;

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      // Pattern: fail, succeed, fail, succeed (rounds 1 and 2 each fail once then succeed)
      if (callCount % 2 === 1 && callCount <= 3) {
        return { stdout: '', stderr: `Fail ${callCount}`, exitCode: 1, success: false };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const config: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      totalRounds: 2,
      maxRetries: 1,
    };

    const result = await runInstanceRounds(config);

    expect(result.status).toBe('completed');
    expect(result.completedRounds).toBe(2);
    expect(result.retries).toHaveLength(2);
    expect(result.retries[0].round).toBe(1);
    expect(result.retries[0].succeeded).toBe(true);
    expect(result.retries[1].round).toBe(2);
    expect(result.retries[1].succeeded).toBe(true);
  });

  it('no retries recorded when all rounds succeed', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const config: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      totalRounds: 2,
    };

    const result = await runInstanceRounds(config);

    expect(result.status).toBe('completed');
    expect(result.retries).toHaveLength(0);
    expect(result.permanentlyFailed).toBeUndefined();
  });

  it('handles exception thrown by runClaude during retry', async () => {
    let callCount = 0;

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { stdout: '', stderr: 'Initial crash', exitCode: 1, success: false };
      }
      throw new Error('Spawn error during retry');
    });

    const result = await runInstanceRounds({ ...BASE_ROUND_CONFIG, maxRetries: 1 });

    expect(result.status).toBe('failed');
    expect(result.permanentlyFailed).toBe(true);
    expect(result.retries[0].errors).toContain('Initial crash');
    expect(result.retries[0].errors).toContain('Spawn error during retry');
  });
});
