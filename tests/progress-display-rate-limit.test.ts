import { describe, it, expect } from 'vitest';
import { ProgressDisplay } from '../src/progress-display.js';

describe('ProgressDisplay.markRateLimited', () => {
  it('sets rate-limited status and backoff duration', () => {
    const display = new ProgressDisplay([1, 2], 2);

    display.markRateLimited(1, 15000);
    const progress = display.getProgress(1);

    expect(progress?.status).toBe('rate-limited');
    expect(progress?.rateLimitBackoffMs).toBe(15000);
  });

  it('no-ops for unknown instance numbers', () => {
    const display = new ProgressDisplay([1], 1);

    // Should not throw
    display.markRateLimited(999, 5000);
    expect(display.getProgress(999)).toBeUndefined();
  });
});
