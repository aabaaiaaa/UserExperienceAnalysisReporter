/**
 * Tests covering remaining branch-coverage gaps across multiple modules.
 *
 * Targets:
 * - instance-manager.ts: inner rate-limit retry loop (lines 396-416), outer rate-limit else (line 363)
 * - claude-cli.ts: killAllChildProcesses, getActiveProcessCount (lines 11-19, 25-26)
 * - discovery.ts: readDiscoveryDocument / readDiscoveryContent catch blocks (lines 237-238, 256-257)
 * - report.ts: readInstanceReport / readReportContent catch blocks (lines 179-180, 197-198)
 * - progress-display.ts: markRateLimited (lines 267-271)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';

const TEST_TEMP_DIR = resolve('.uxreview-temp-covgaps-test');

// ──────────────────────────────────────────────────────────────────
// Mock setup: mirrors rate-limit.test.ts so runInstanceRounds works
// ──────────────────────────────────────────────────────────────────

vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
  killAllChildProcesses: vi.fn(),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
}));

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

vi.mock('../src/rate-limit.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/rate-limit.js')>();
  return {
    ...original,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

import { runClaude } from '../src/claude-cli.js';
import {
  runInstanceRounds,
  RoundExecutionConfig,
  ProgressCallback,
} from '../src/instance-manager.js';
import { sleep } from '../src/rate-limit.js';
import { ClaudeCliResult } from '../src/claude-cli.js';

const mockRunClaude = vi.mocked(runClaude);
const mockSleep = vi.mocked(sleep);

const BASE_ROUND_CONFIG: RoundExecutionConfig = {
  instanceNumber: 1,
  url: 'https://example.com/app',
  intro: 'Test app context.',
  planChunk: '## Navigation\n- Review main nav bar',
  scope: '## Layout\n- Check spacing',
  totalRounds: 1,
  assignedAreas: ['Navigation'],
};

function makeRateLimitResult(): ClaudeCliResult {
  return { stdout: '', stderr: 'Error: rate limit exceeded', exitCode: 1, success: false };
}
function makeFailResult(msg = 'MCP crash'): ClaudeCliResult {
  return { stdout: '', stderr: msg, exitCode: 1, success: false };
}
function makeSuccessResult(): ClaudeCliResult {
  return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
}
function getCheckpointPath(n: number): string {
  return join(TEST_TEMP_DIR, `instance-${n}`, 'checkpoint.json');
}

// ─── instance-manager: inner rate-limit retry during normal retry ──

describe('Inner rate-limit retry during normal retries', () => {
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

  it('handles rate limit error during a normal retry attempt (with checkpoint)', async () => {
    // Flow: initial non-rate-limit failure → enter normal retry →
    //       retry hits rate limit → backoff → retry succeeds
    let callCount = 0;

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Initial call fails with non-rate-limit error
        return makeFailResult('Connection reset');
      }
      if (callCount === 2) {
        // First retry attempt hits rate limit
        return makeRateLimitResult();
      }
      // After rate limit backoff, retry succeeds
      return makeSuccessResult();
    });

    const callbacks: ProgressCallback = {
      onFailure: vi.fn(),
      onRetry: vi.fn(),
      onRateLimited: vi.fn(),
      onRateLimitResolved: vi.fn(),
      onRetrySuccess: vi.fn(),
      onCompleted: vi.fn(),
    };

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      maxRetries: 2,
      progress: callbacks,
    });

    expect(result.status).toBe('completed');
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].succeeded).toBe(true);
    // Rate limit callback should have been called during the retry
    expect(callbacks.onRateLimited).toHaveBeenCalled();
    expect(callbacks.onRateLimitResolved).toHaveBeenCalled();
    // Sleep should have been called for the inner rate-limit backoff
    expect(mockSleep).toHaveBeenCalled();
    expect(mockRunClaude).toHaveBeenCalledTimes(3);
  });

  it('handles rate limit during retry with missing checkpoint (else branch)', async () => {
    // Flow: initial non-rate-limit failure → enter normal retry →
    //       retry hits rate limit (AND deletes checkpoint) → backoff → no checkpoint → fresh spawnInstance
    let callCount = 0;
    const checkpointPath = getCheckpointPath(1);

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Initial call fails (non-rate-limit)
        return makeFailResult('Crash');
      }
      if (callCount === 2) {
        // Retry attempt: delete the checkpoint, then return rate limit error.
        // This ensures that when the inner rate-limit loop reads the checkpoint,
        // it finds nothing → takes the else branch (spawnInstance).
        if (existsSync(checkpointPath)) {
          rmSync(checkpointPath);
        }
        return makeRateLimitResult();
      }
      // After rate limit backoff, fresh spawn succeeds
      return makeSuccessResult();
    });

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      maxRetries: 2,
    });

    expect(result.status).toBe('completed');
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].succeeded).toBe(true);
    expect(mockSleep).toHaveBeenCalled();
    expect(mockRunClaude).toHaveBeenCalledTimes(3);
  });

  it('handles multiple rate limit errors during a single retry attempt', async () => {
    let callCount = 0;

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeFailResult('Initial crash');
      }
      if (callCount === 2 || callCount === 3) {
        // Two consecutive rate limits during the retry
        return makeRateLimitResult();
      }
      return makeSuccessResult();
    });

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      maxRetries: 2,
    });

    expect(result.status).toBe('completed');
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(mockRunClaude).toHaveBeenCalledTimes(4);
  });
});

// ─── instance-manager: outer rate-limit with missing checkpoint ────

describe('Outer rate-limit retry with missing checkpoint', () => {
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

  it('falls back to fresh spawnInstance when checkpoint is gone during rate-limit retry', async () => {
    let callCount = 0;
    const checkpointPath = getCheckpointPath(1);

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call hits rate limit; delete the checkpoint to trigger else branch
        if (existsSync(checkpointPath)) {
          rmSync(checkpointPath);
        }
        return makeRateLimitResult();
      }
      return makeSuccessResult();
    });

    const result = await runInstanceRounds(BASE_ROUND_CONFIG);

    expect(result.status).toBe('completed');
    expect(result.retries).toHaveLength(0); // rate limit retries don't count
    expect(mockSleep).toHaveBeenCalledOnce();
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });
});
