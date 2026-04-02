import { ClaudeCliResult } from './claude-cli.js';

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

/** Default base delay for exponential backoff (10 seconds) */
export const DEFAULT_BASE_DELAY_MS = 10_000;

/** Maximum backoff delay cap (5 minutes) */
export const MAX_BACKOFF_DELAY_MS = 5 * 60 * 1000;

/** Maximum number of rate limit retries before giving up */
export const MAX_RATE_LIMIT_RETRIES = 10;

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
