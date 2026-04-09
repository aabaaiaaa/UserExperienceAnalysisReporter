import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import {
  isRateLimitError,
  getBackoffDelay,
} from '../src/rate-limit.js';
import {
  DEFAULT_BASE_DELAY_MS,
  MAX_BACKOFF_DELAY_MS,
  MAX_RATE_LIMIT_RETRIES,
} from '../src/config.js';
import { ClaudeCliResult } from '../src/claude-cli.js';
import { formatProgressLine, InstanceProgress, ANSI_YELLOW, ANSI_RESET } from '../src/progress-display.js';
import {
  runInstanceRounds,
  RoundExecutionConfig,
  ProgressCallback,
} from '../src/instance-manager.js';

// ─── Rate limit detection ─────────────────────────────────────────

describe('isRateLimitError', () => {
  it('returns false for successful results', () => {
    const result: ClaudeCliResult = {
      stdout: 'rate limit exceeded',
      stderr: '',
      exitCode: 0,
      success: true,
    };
    expect(isRateLimitError(result)).toBe(false);
  });

  it('detects "rate limit" in stderr', () => {
    const result: ClaudeCliResult = {
      stdout: '',
      stderr: 'Error: rate limit exceeded, please retry later',
      exitCode: 1,
      success: false,
    };
    expect(isRateLimitError(result)).toBe(true);
  });

  it('detects "429" in stderr', () => {
    const result: ClaudeCliResult = {
      stdout: '',
      stderr: 'HTTP 429 Too Many Requests',
      exitCode: 1,
      success: false,
    };
    expect(isRateLimitError(result)).toBe(true);
  });

  it('detects "too many requests" in stdout', () => {
    const result: ClaudeCliResult = {
      stdout: 'Error: Too Many Requests',
      stderr: '',
      exitCode: 1,
      success: false,
    };
    expect(isRateLimitError(result)).toBe(true);
  });

  it('detects "throttled" in stderr', () => {
    const result: ClaudeCliResult = {
      stdout: '',
      stderr: 'Request throttled by API gateway',
      exitCode: 1,
      success: false,
    };
    expect(isRateLimitError(result)).toBe(true);
  });

  it('detects "overloaded" in stderr', () => {
    const result: ClaudeCliResult = {
      stdout: '',
      stderr: 'API is overloaded, please try again',
      exitCode: 1,
      success: false,
    };
    expect(isRateLimitError(result)).toBe(true);
  });

  it('detects "retry-after" in stderr', () => {
    const result: ClaudeCliResult = {
      stdout: '',
      stderr: 'Retry-After: 30',
      exitCode: 1,
      success: false,
    };
    expect(isRateLimitError(result)).toBe(true);
  });

  it('detects "capacity" in stderr', () => {
    const result: ClaudeCliResult = {
      stdout: '',
      stderr: 'At capacity, please wait',
      exitCode: 1,
      success: false,
    };
    expect(isRateLimitError(result)).toBe(true);
  });

  it('returns false for non-rate-limit errors', () => {
    const result: ClaudeCliResult = {
      stdout: '',
      stderr: 'MCP connection failed: timeout',
      exitCode: 1,
      success: false,
    };
    expect(isRateLimitError(result)).toBe(false);
  });

  it('is case-insensitive', () => {
    const result: ClaudeCliResult = {
      stdout: '',
      stderr: 'RATE LIMIT HIT',
      exitCode: 1,
      success: false,
    };
    expect(isRateLimitError(result)).toBe(true);
  });
});

// ─── Backoff calculation ──────────────────────────────────────────

describe('getBackoffDelay', () => {
  it('first attempt uses roughly the base delay', () => {
    // attempt=0 => baseDelay * 2^0 + jitter = baseDelay + [0, baseDelay)
    const delay = getBackoffDelay(0, 1000, 300_000);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThan(2000);
  });

  it('increases exponentially', () => {
    // Use fixed jitter by setting a known seed pattern
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      // Get many samples and take the minimum to approximate the base
      const samples = Array.from({ length: 50 }, () => getBackoffDelay(i, 1000, 1_000_000));
      delays.push(Math.min(...samples));
    }
    // Each delay's base should roughly double
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it('caps at the maximum delay', () => {
    const delay = getBackoffDelay(20, 10_000, 60_000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  it('uses defaults when not specified', () => {
    const delay = getBackoffDelay(0);
    expect(delay).toBeGreaterThanOrEqual(DEFAULT_BASE_DELAY_MS);
    expect(delay).toBeLessThanOrEqual(MAX_BACKOFF_DELAY_MS);
  });

  it('MAX_RATE_LIMIT_RETRIES is 10', () => {
    expect(MAX_RATE_LIMIT_RETRIES).toBe(10);
  });
});

// ─── Progress display for rate-limited state ──────────────────────

describe('formatProgressLine - rate-limited state', () => {
  it('renders yellow with backoff duration', () => {
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 2,
      totalItems: 5,
      completedItems: 2,
      inProgressItems: 1,
      findingsCount: 3,
      screenshotCount: 0,
      startTime: 1000,
      roundStartTime: 1000,
      status: 'rate-limited',
      rateLimitBackoffMs: 15000,
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, 2000);
    expect(line).toContain(ANSI_YELLOW);
    expect(line).toContain('Rate limited');
    expect(line).toContain('pausing 15s');
    expect(line).toContain(ANSI_RESET);
  });

  it('rounds up backoff seconds', () => {
    const progress: InstanceProgress = {
      instanceNumber: 2,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 3,
      completedItems: 0,
      inProgressItems: 0,
      findingsCount: 0,
      screenshotCount: 0,
      startTime: 1000,
      roundStartTime: 1000,
      status: 'rate-limited',
      rateLimitBackoffMs: 10500,
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, 2000);
    expect(line).toContain('pausing 11s');
  });

  it('shows 0s pause when rateLimitBackoffMs is not set', () => {
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 3,
      completedItems: 0,
      inProgressItems: 0,
      findingsCount: 0,
      screenshotCount: 0,
      startTime: 1000,
      roundStartTime: 1000,
      status: 'rate-limited',
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, 2000);
    expect(line).toContain(ANSI_YELLOW);
    expect(line).toContain('Rate limited');
    expect(line).toContain('pausing 0s');
  });
});

// ─── Integration: rate limit handling in runInstanceRounds ─────────

const TEST_TEMP_DIR = resolve('.uxreview-temp-ratelimit-test');

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

// Mock sleep to avoid waiting in tests
vi.mock('../src/rate-limit.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/rate-limit.js')>();
  return {
    ...original,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

import { runClaude } from '../src/claude-cli.js';
import { sleep } from '../src/rate-limit.js';
const mockRunClaude = vi.mocked(runClaude);
const mockSleep = vi.mocked(sleep);

const BASE_ROUND_CONFIG: RoundExecutionConfig = {
  instanceNumber: 1,
  url: 'https://example.com/app',
  intro: 'Test app context.',
  planChunk: '## Navigation\n- Review main nav bar\n## Dashboard\n- Check card layout',
  scope: '## Layout\n- Check spacing consistency',
  totalRounds: 1,
  assignedAreas: ['Navigation', 'Dashboard'],
};

function makeRateLimitResult(): ClaudeCliResult {
  return {
    stdout: '',
    stderr: 'Error: rate limit exceeded, please retry after 30s',
    exitCode: 1,
    success: false,
  };
}

function makeFailResult(msg = 'MCP crash'): ClaudeCliResult {
  return { stdout: '', stderr: msg, exitCode: 1, success: false };
}

function makeSuccessResult(): ClaudeCliResult {
  return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
}

describe('Rate limit handling in runInstanceRounds', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_TEMP_DIR, 'instance-1'), { recursive: true });
    mkdirSync(join(TEST_TEMP_DIR, 'instance-1', 'screenshots'), { recursive: true });
    mkdirSync(join(TEST_TEMP_DIR, 'instance-2'), { recursive: true });
    mkdirSync(join(TEST_TEMP_DIR, 'instance-2', 'screenshots'), { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  it('detects rate limit error, backs off, and retries successfully', async () => {
    mockRunClaude
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeSuccessResult());

    const result = await runInstanceRounds(BASE_ROUND_CONFIG);

    expect(result.status).toBe('completed');
    expect(result.completedRounds).toBe(1);
    // Rate limit retries should NOT count against normal retries
    expect(result.retries).toHaveLength(0);
    // sleep should have been called once for backoff
    expect(mockSleep).toHaveBeenCalledOnce();
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });

  it('handles multiple consecutive rate limits before success', async () => {
    mockRunClaude
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeSuccessResult());

    const result = await runInstanceRounds(BASE_ROUND_CONFIG);

    expect(result.status).toBe('completed');
    expect(result.retries).toHaveLength(0);
    expect(mockSleep).toHaveBeenCalledTimes(3);
    expect(mockRunClaude).toHaveBeenCalledTimes(4);
  });

  it('calls onRateLimited and onRateLimitResolved callbacks', async () => {
    mockRunClaude
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeSuccessResult());

    const callbacks: ProgressCallback = {
      onRoundStart: vi.fn(),
      onRateLimited: vi.fn(),
      onRateLimitResolved: vi.fn(),
      onRoundComplete: vi.fn(),
      onCompleted: vi.fn(),
    };

    await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      progress: callbacks,
    });

    expect(callbacks.onRateLimited).toHaveBeenCalledOnce();
    expect(callbacks.onRateLimited).toHaveBeenCalledWith(1, 1, expect.any(Number));
    // Backoff delay should be positive
    const backoffMs = (callbacks.onRateLimited as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(backoffMs).toBeGreaterThan(0);

    expect(callbacks.onRateLimitResolved).toHaveBeenCalledOnce();
    expect(callbacks.onRateLimitResolved).toHaveBeenCalledWith(1, 1);
    expect(callbacks.onCompleted).toHaveBeenCalledOnce();
  });

  it('does not count rate limit retries against the normal retry limit', async () => {
    // 5 rate limit errors, then a non-rate-limit failure, then success on retry
    mockRunClaude
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeFailResult('MCP crash'))
      .mockResolvedValueOnce(makeSuccessResult());

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      maxRetries: 1,
    });

    expect(result.status).toBe('completed');
    // 5 rate limit sleeps
    expect(mockSleep).toHaveBeenCalledTimes(5);
    // 1 retry (the non-rate-limit failure)
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].attempts).toBe(1);
    expect(result.retries[0].succeeded).toBe(true);
  });

  it('rate limit followed by non-rate-limit failure still enters normal retry', async () => {
    mockRunClaude
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeFailResult('Crash'))
      .mockResolvedValueOnce(makeSuccessResult());

    const callbacks: ProgressCallback = {
      onRateLimited: vi.fn(),
      onRateLimitResolved: vi.fn(),
      onFailure: vi.fn(),
      onRetry: vi.fn(),
      onRetrySuccess: vi.fn(),
    };

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      maxRetries: 1,
      progress: callbacks,
    });

    expect(result.status).toBe('completed');
    expect(callbacks.onRateLimited).toHaveBeenCalledOnce();
    expect(callbacks.onFailure).toHaveBeenCalledOnce();
    expect(callbacks.onRetrySuccess).toHaveBeenCalledOnce();
    expect(result.retries).toHaveLength(1);
    expect(result.retries[0].succeeded).toBe(true);
  });

  it('progress bar reflects rate-limited pause state', async () => {
    mockRunClaude
      .mockResolvedValueOnce(makeRateLimitResult())
      .mockResolvedValueOnce(makeSuccessResult());

    const statusHistory: string[] = [];

    const callbacks: ProgressCallback = {
      onRoundStart: () => statusHistory.push('running'),
      onRateLimited: () => statusHistory.push('rate-limited'),
      onRateLimitResolved: () => statusHistory.push('running'),
      onRoundComplete: () => statusHistory.push('round-complete'),
      onCompleted: () => statusHistory.push('completed'),
    };

    await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      progress: callbacks,
    });

    expect(statusHistory).toEqual([
      'running',        // onRoundStart
      'rate-limited',   // onRateLimited (rate limit detected)
      'running',        // onRateLimitResolved (backoff done, retrying)
      'round-complete', // onRoundComplete
      'completed',      // onCompleted
    ]);
  });
});

describe('Global rate-limit retry counting', () => {
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

  it('rate-limit retries are shared globally between initial spawn and normal retries', async () => {
    // Scenario: 8 rate-limit errors on initial spawn, then a non-rate-limit failure,
    // then on normal retry: 2 more rate-limit errors (hitting the global max of 10),
    // then a non-rate-limit failure again. The instance should be permanently failed
    // because the global budget (10) is exhausted.
    const responses = [
      // Initial spawn: 8 rate-limit errors
      ...Array(8).fill(null).map(() => makeRateLimitResult()),
      // 9th call: non-rate-limit failure (exits the rate-limit loop)
      makeFailResult('Network error'),
      // Normal retry #1: 2 more rate-limit errors (total global = 10, budget exhausted)
      ...Array(2).fill(null).map(() => makeRateLimitResult()),
      // After budget exhausted, still rate-limit error but loop exits.
      // This call shouldn't happen since budget is exhausted.
      makeSuccessResult(),
    ];

    let callIndex = 0;
    mockRunClaude.mockImplementation(async () => {
      return responses[callIndex++];
    });

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      maxRetries: 3,
    });

    // 8 initial rate-limit sleeps + 2 during retry = 10 total
    expect(mockSleep).toHaveBeenCalledTimes(10);
    // The retry's rate-limit loop should have exhausted the global budget,
    // leaving a rate-limit error as the final state for that retry attempt.
    // Since the retry itself resulted in a rate-limit error (not success),
    // the retry loop continues to the next attempt.
    expect(result.retries).toHaveLength(1);
  });

  it('rate-limit budget is not reset between rounds', async () => {
    // Round 1: 5 rate-limit errors then success
    // Round 2: 5 more rate-limit errors (hits global max of 10), then it would
    // need to give up because budget is exhausted.
    const responses = [
      // Round 1: 5 rate-limit + 1 success
      ...Array(5).fill(null).map(() => makeRateLimitResult()),
      makeSuccessResult(),
      // Round 2: 5 rate-limit (global total = 10, budget exhausted)
      ...Array(5).fill(null).map(() => makeRateLimitResult()),
      // After budget exhausted, the rate-limit error persists as a failure
      // This triggers normal retry. Normal retry also gets rate-limit but budget gone.
      makeRateLimitResult(),
      makeRateLimitResult(),
      makeRateLimitResult(),
    ];

    let callIndex = 0;
    mockRunClaude.mockImplementation(async () => {
      return responses[callIndex++];
    });

    const result = await runInstanceRounds({
      ...BASE_ROUND_CONFIG,
      totalRounds: 2,
      maxRetries: 3,
    });

    // Round 1 should succeed, round 2 should fail
    expect(result.completedRounds).toBe(1);
    // Exactly 10 rate-limit sleeps total (5 from round 1 + 5 from round 2)
    expect(mockSleep).toHaveBeenCalledTimes(10);
    expect(result.permanentlyFailed).toBe(true);
  });
});

describe('Concurrent instances rate limit simulation', () => {
  beforeEach(() => {
    for (let i = 1; i <= 2; i++) {
      mkdirSync(join(TEST_TEMP_DIR, `instance-${i}`), { recursive: true });
      mkdirSync(join(TEST_TEMP_DIR, `instance-${i}`, 'screenshots'), { recursive: true });
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  it('two concurrent instances both hit rate limits and recover', async () => {
    // Track calls per instance to provide different responses
    let callCount = 0;

    mockRunClaude.mockImplementation(async () => {
      callCount++;
      // First 2 calls (one from each instance) are rate limited
      if (callCount <= 2) {
        return makeRateLimitResult();
      }
      return makeSuccessResult();
    });

    const callbacks1: ProgressCallback = {
      onRateLimited: vi.fn(),
      onRateLimitResolved: vi.fn(),
      onCompleted: vi.fn(),
    };
    const callbacks2: ProgressCallback = {
      onRateLimited: vi.fn(),
      onRateLimitResolved: vi.fn(),
      onCompleted: vi.fn(),
    };

    const config1: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      instanceNumber: 1,
      progress: callbacks1,
    };
    const config2: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      instanceNumber: 2,
      progress: callbacks2,
    };

    // Run both instances concurrently (like the orchestrator does)
    const [result1, result2] = await Promise.allSettled([
      runInstanceRounds(config1),
      runInstanceRounds(config2),
    ]);

    expect(result1.status).toBe('fulfilled');
    expect(result2.status).toBe('fulfilled');

    if (result1.status === 'fulfilled') {
      expect(result1.value.status).toBe('completed');
      expect(result1.value.retries).toHaveLength(0);
    }
    if (result2.status === 'fulfilled') {
      expect(result2.value.status).toBe('completed');
      expect(result2.value.retries).toHaveLength(0);
    }

    // Both instances should have hit rate limits
    const totalRateLimited =
      (callbacks1.onRateLimited as ReturnType<typeof vi.fn>).mock.calls.length +
      (callbacks2.onRateLimited as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(totalRateLimited).toBe(2);

    // Both should have resolved
    const totalResolved =
      (callbacks1.onRateLimitResolved as ReturnType<typeof vi.fn>).mock.calls.length +
      (callbacks2.onRateLimitResolved as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(totalResolved).toBe(2);

    // Sleep called at least twice (once per instance)
    expect(mockSleep).toHaveBeenCalledTimes(2);

    // Neither crashed
    expect(callbacks1.onCompleted).toHaveBeenCalledOnce();
    expect(callbacks2.onCompleted).toHaveBeenCalledOnce();
  });
});
