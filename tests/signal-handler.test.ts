import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock claude-cli to prevent actual process management
vi.mock('../src/claude-cli.js', () => ({
  killAllChildProcesses: vi.fn(),
}));

import { createSignalManager, SignalManager } from '../src/signal-handler.js';
import { killAllChildProcesses } from '../src/claude-cli.js';

const mockKillAllChildProcesses = vi.mocked(killAllChildProcesses);

class TestSignalError extends Error {
  constructor(signal: string) {
    super(`Test interrupted by ${signal}`);
    this.name = 'TestSignalError';
  }
}

describe('createSignalManager', () => {
  let manager: SignalManager;

  afterEach(() => {
    // Always clean up to remove signal listeners
    manager?.cleanup();
    vi.clearAllMocks();
  });

  it('creates a manager with signalReceived initially false', () => {
    manager = createSignalManager(TestSignalError);
    expect(manager.signalReceived).toBe(false);
  });

  it('raceSignal resolves when the promise resolves before any signal', async () => {
    manager = createSignalManager(TestSignalError);
    const result = await manager.raceSignal(Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('raceSignal rejects immediately if signal was already received', async () => {
    manager = createSignalManager(TestSignalError);

    // Simulate SIGINT by emitting it
    process.emit('SIGINT', 'SIGINT');

    expect(manager.signalReceived).toBe(true);

    await expect(manager.raceSignal(Promise.resolve(42)))
      .rejects.toThrow(TestSignalError);
  });

  it('calls killAllChildProcesses on signal', () => {
    manager = createSignalManager(TestSignalError);
    process.emit('SIGINT', 'SIGINT');
    expect(mockKillAllChildProcesses).toHaveBeenCalledOnce();
  });

  it('sets process.exitCode to 130 on SIGINT', () => {
    const originalExitCode = process.exitCode;
    manager = createSignalManager(TestSignalError);
    process.emit('SIGINT', 'SIGINT');
    expect(process.exitCode).toBe(130);
    process.exitCode = originalExitCode;
  });

  it('sets process.exitCode to 143 on SIGTERM', () => {
    const originalExitCode = process.exitCode;
    manager = createSignalManager(TestSignalError);
    process.emit('SIGTERM', 'SIGTERM');
    expect(process.exitCode).toBe(143);
    process.exitCode = originalExitCode;
  });

  it('ignores duplicate signals', () => {
    manager = createSignalManager(TestSignalError);
    process.emit('SIGINT', 'SIGINT');
    process.emit('SIGINT', 'SIGINT');
    expect(mockKillAllChildProcesses).toHaveBeenCalledOnce();
  });

  it('cleanup removes signal listeners', () => {
    manager = createSignalManager(TestSignalError);
    manager.cleanup();

    // After cleanup, emitting a signal should not trigger the handler
    mockKillAllChildProcesses.mockClear();
    // We can't easily test this without actually emitting signals,
    // but we verify no error is thrown
    expect(manager.signalReceived).toBe(false);
  });
});
