/**
 * Lightweight debug logging utility.
 *
 * When verbose mode is enabled via `setVerbose(true)`, `debug()` writes
 * timestamped messages to stderr so they don't interfere with stdout.
 * When verbose mode is off (the default), `debug()` is a no-op.
 */

let verbose = false;

/**
 * Enable or disable verbose debug logging.
 */
export function setVerbose(enabled: boolean): void {
  verbose = enabled;
}

/**
 * Returns the current verbose mode state.
 */
export function isVerbose(): boolean {
  return verbose;
}

/**
 * Write a debug message to stderr if verbose mode is enabled.
 *
 * Messages are prefixed with a timestamp for correlation with
 * subprocess and timing events.
 */
export function debug(message: string, ...args: unknown[]): void {
  if (!verbose) return;

  const timestamp = new Date().toISOString();
  const formatted =
    args.length > 0
      ? `[DEBUG ${timestamp}] ${message} ${args.map(String).join(' ')}`
      : `[DEBUG ${timestamp}] ${message}`;

  process.stderr.write(formatted + '\n');
}
