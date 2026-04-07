/**
 * Centralized configuration constants.
 *
 * All magic numbers that were previously scattered across the codebase live
 * here so they are easy to discover, audit, and (in a future iteration)
 * override from the CLI.
 */

// ─── Timeouts ────────────────────────────────────────────────────────

/** Timeout for each analysis instance subprocess (30 minutes). */
export const INSTANCE_TIMEOUT_MS = 30 * 60 * 1000;

/** Default timeout for one-shot Claude CLI calls (5 minutes). */
export const DEFAULT_CLI_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Retries ─────────────────────────────────────────────────────────

/** Maximum normal (non-rate-limit) retries per instance. */
export const MAX_RETRIES = 3;

/** Maximum rate-limit retries before giving up (global budget). */
export const MAX_RATE_LIMIT_RETRIES = 10;

// ─── Rate-limit backoff ──────────────────────────────────────────────

/** Base delay for exponential backoff (10 seconds). */
export const DEFAULT_BASE_DELAY_MS = 10_000;

/** Maximum backoff delay cap (5 minutes). */
export const MAX_BACKOFF_DELAY_MS = 5 * 60 * 1000;

// ─── Progress display ────────────────────────────────────────────────

/** @deprecated Use RENDER_INTERVAL_MS instead. Kept for backward compatibility. */
export const POLL_INTERVAL_MS = 1000;

/** Interval between progress display render cycles (1 second). */
export const RENDER_INTERVAL_MS = 1000;

/** Interval between spinner frame advances (ms). Same as render interval. */
export const SPINNER_INTERVAL_MS = RENDER_INTERVAL_MS;
