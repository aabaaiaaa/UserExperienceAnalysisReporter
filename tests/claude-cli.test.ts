import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runClaude } from '../src/claude-cli.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// We mock child_process.spawn to avoid actually calling the claude CLI
vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn(),
  };
});

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

function createMockProcess(): ChildProcess & {
  _simulateOutput: (stdout: string, stderr: string, exitCode: number) => void;
  _simulateError: (err: Error) => void;
  _simulateTimeout: () => void;
} {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };

  proc._simulateOutput = (stdout: string, stderr: string, exitCode: number) => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode, null);
  };

  proc._simulateError = (err: Error) => {
    proc.emit('error', err);
  };

  proc._simulateTimeout = () => {
    proc.emit('close', null, 'SIGTERM');
  };

  return proc;
}

describe('runClaude', () => {
  let mockProc: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns claude CLI with correct default arguments', async () => {
    const promise = runClaude({ prompt: 'Hello' });
    mockProc._simulateOutput('response', '', 0);
    await promise;

    const expectedCommand = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    expect(mockSpawn).toHaveBeenCalledWith(
      expectedCommand,
      ['-p', '--output-format', 'text'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5 * 60 * 1000,
      }),
    );
    // shell: true must NOT be present (security: defense-in-depth)
    const spawnOptions = mockSpawn.mock.calls[0][2] as Record<string, unknown>;
    expect(spawnOptions).not.toHaveProperty('shell');
  });

  it('passes prompt via stdin', async () => {
    const prompt = 'Analyze this review plan and split it into 3 chunks';
    const promise = runClaude({ prompt });
    mockProc._simulateOutput('ok', '', 0);
    await promise;

    expect(mockProc.stdin.write).toHaveBeenCalledWith(prompt);
    expect(mockProc.stdin.end).toHaveBeenCalled();
  });

  it('captures stdout and returns success on exit code 0', async () => {
    const promise = runClaude({ prompt: 'test' });
    mockProc._simulateOutput('Claude response here', '', 0);
    const result = await promise;

    expect(result).toEqual({
      stdout: 'Claude response here',
      stderr: '',
      exitCode: 0,
      success: true,
    });
  });

  it('captures stderr and returns failure on non-zero exit code', async () => {
    const promise = runClaude({ prompt: 'test' });
    mockProc._simulateOutput('', 'Error: something went wrong', 1);
    const result = await promise;

    expect(result).toEqual({
      stdout: '',
      stderr: 'Error: something went wrong',
      exitCode: 1,
      success: false,
    });
  });

  it('handles both stdout and stderr together', async () => {
    const promise = runClaude({ prompt: 'test' });
    mockProc._simulateOutput('partial output', 'warning: something', 1);
    const result = await promise;

    expect(result.stdout).toBe('partial output');
    expect(result.stderr).toBe('warning: something');
    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(false);
  });

  it('rejects when the subprocess fails to spawn', async () => {
    const promise = runClaude({ prompt: 'test' });
    mockProc._simulateError(new Error('ENOENT: claude not found'));

    await expect(promise).rejects.toThrow('Failed to spawn Claude Code CLI: ENOENT: claude not found');
  });

  it('handles timeout (SIGTERM with null exit code)', async () => {
    const promise = runClaude({ prompt: 'test', timeout: 1000 });
    mockProc._simulateTimeout();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('timed out');
  });

  it('passes custom cwd to subprocess', async () => {
    const promise = runClaude({ prompt: 'test', cwd: '/some/dir' });
    mockProc._simulateOutput('ok', '', 0);
    await promise;

    const expectedCommand = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    expect(mockSpawn).toHaveBeenCalledWith(
      expectedCommand,
      expect.any(Array),
      expect.objectContaining({ cwd: '/some/dir' }),
    );
  });

  it('passes custom timeout to subprocess', async () => {
    const promise = runClaude({ prompt: 'test', timeout: 30000 });
    mockProc._simulateOutput('ok', '', 0);
    await promise;

    const expectedCommand = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    expect(mockSpawn).toHaveBeenCalledWith(
      expectedCommand,
      expect.any(Array),
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it('passes extra CLI args', async () => {
    const promise = runClaude({
      prompt: 'test',
      extraArgs: ['--allowedTools', 'mcp__playwright__*'],
    });
    mockProc._simulateOutput('ok', '', 0);
    await promise;

    const expectedCommand = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    expect(mockSpawn).toHaveBeenCalledWith(
      expectedCommand,
      ['-p', '--output-format', 'text', '--allowedTools', 'mcp__playwright__*'],
      expect.any(Object),
    );
  });

  it('handles multiple stdout chunks', async () => {
    const promise = runClaude({ prompt: 'test' });

    mockProc.stdout.emit('data', Buffer.from('chunk1'));
    mockProc.stdout.emit('data', Buffer.from('chunk2'));
    mockProc.stdout.emit('data', Buffer.from('chunk3'));
    mockProc.emit('close', 0, null);

    const result = await promise;
    expect(result.stdout).toBe('chunk1chunk2chunk3');
    expect(result.success).toBe(true);
  });

  it('returns exit code 1 when close provides null code without signal', async () => {
    const promise = runClaude({ prompt: 'test' });
    mockProc.emit('close', null, null);
    const result = await promise;

    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(false);
  });
});
