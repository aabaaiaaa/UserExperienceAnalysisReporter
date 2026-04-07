import { ClaudeCliResult } from './claude-cli.js';
import {
  DEFAULT_BASE_DELAY_MS,
  MAX_BACKOFF_DELAY_MS,
  MAX_RATE_LIMIT_RETRIES,
} from './config.js';
import { debug } from './logger.js';

/**
 * Patterns that indicate a rate limit error from the Claude Code CLI.
 * Checked against both stdout and stderr.
 */
const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429/,
  /throttl/i,
  /overloaded/i,
  /capacity/i,
  /retry.after/i,
];

/**
 * Detect whether a Claude CLI result indicates a rate limit error.
 *
 * Checks both stdout and stderr for common rate limit patterns.
 * Only applies to failed results (success === false).
 */
export function isRateLimitError(result: ClaudeCliResult): boolean {
  if (result.success) return false;

  const combined = `${result.stdout}\n${result.stderr}`;
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(combined));
}

/**
 * Calculate exponential backoff delay with jitter.
 *
 * Formula: min(baseDelay * 2^attempt + jitter, maxDelay)
 *
 * Jitter is random between 0 and baseDelay to spread out retries
 * across concurrent instances (avoids thundering herd).
 */
export function getBackoffDelay(
  attempt: number,
  baseDelay: number = DEFAULT_BASE_DELAY_MS,
  maxDelay: number = MAX_BACKOFF_DELAY_MS,
): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelay;
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Sleep for the specified duration.
 * Returns the actual delay used (for display purposes).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mutable state object that tracks rate-limit retry attempts.
 * Pass the same instance across multiple `withRateLimitRetry` calls
 * to share a single global retry budget.
 */
export interface RateLimitRetryState {
  globalAttempts: number;
}

/**
 * Options for `withRateLimitRetry`.
 */
export interface RateLimitRetryOptions {
  /** Maximum rate-limit retries (default: MAX_RATE_LIMIT_RETRIES from config). */
  maxRetries?: number;
  /** Mutable state for shared budget tracking across multiple calls. */
  retryState?: RateLimitRetryState;
  /** Called before each backoff wait with the backoff duration in ms. */
  onRateLimited?: (backoffMs: number) => void;
  /** Called after each backoff wait completes, before retrying. */
  onRateLimitResolved?: () => void;
}

/**
 * Execute an async function that returns a ClaudeCliResult, retrying on
 * rate-limit errors with exponential backoff and jitter.
 *
 * The function is called once initially. If the result is a rate-limit error
 * and the retry budget has not been exhausted, it backs off and calls `fn`
 * again, repeating until success, a non-rate-limit result, or the budget
 * is exhausted.
 *
 * When a `retryState` is provided, retry attempts are counted against
 * the shared global budget, allowing multiple call sites to share
 * a single retry limit.
 */
export async function withRateLimitRetry(
  fn: () => Promise<ClaudeCliResult>,
  options?: RateLimitRetryOptions,
): Promise<ClaudeCliResult> {
  const maxRetries = options?.maxRetries ?? MAX_RATE_LIMIT_RETRIES;
  const retryState = options?.retryState ?? { globalAttempts: 0 };

  let result = await fn();

  while (isRateLimitError(result) && retryState.globalAttempts < maxRetries) {
    retryState.globalAttempts++;
    const backoffMs = getBackoffDelay(retryState.globalAttempts - 1);
    debug(`Rate limit hit, attempt ${retryState.globalAttempts}/${maxRetries}, backing off ${backoffMs}ms`);
    options?.onRateLimited?.(backoffMs);
    await sleep(backoffMs);
    options?.onRateLimitResolved?.();
    result = await fn();
  }

  return result;
}
