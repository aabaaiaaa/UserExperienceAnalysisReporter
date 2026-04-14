import { describe, it, expect, vi } from 'vitest';
import { ProgressDisplay } from '../src/progress-display.js';
import { buildProgressCallback } from '../src/progress-callbacks.js';

describe('buildProgressCallback', () => {
  function createMockDisplay() {
    return {
      markRunning: vi.fn(),
      markRoundComplete: vi.fn(),
      markFailed: vi.fn(),
      markRetrying: vi.fn(),
      markRateLimited: vi.fn(),
      markCompleted: vi.fn(),
      markPermanentlyFailed: vi.fn(),
      updateProgress: vi.fn(),
    } as unknown as ProgressDisplay;
  }

  it('onRoundStart calls display.markRunning', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onRoundStart(1, 2);

    expect(display.markRunning).toHaveBeenCalledWith(1);
  });

  it('onRoundComplete calls display.markRoundComplete with duration', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onRoundComplete(1, 2, 5000);

    expect(display.markRoundComplete).toHaveBeenCalledWith(1, 5000);
  });

  it('onFailure calls display.markFailed with error', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onFailure(1, 2, 'error msg');

    expect(display.markFailed).toHaveBeenCalledWith(1, 'error msg');
  });

  it('onRetry calls display.markRetrying with attempt and maxRetries', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onRetry(1, 2, 3, 5);

    expect(display.markRetrying).toHaveBeenCalledWith(1, 3, 5);
  });

  it('onRetrySuccess calls display.markRunning', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onRetrySuccess(1, 2);

    expect(display.markRunning).toHaveBeenCalledWith(1);
  });

  it('onRateLimited calls display.markRateLimited with backoff', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onRateLimited(1, 2, 30000);

    expect(display.markRateLimited).toHaveBeenCalledWith(1, 30000);
  });

  it('onRateLimitResolved calls display.markRunning', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onRateLimitResolved(1, 2);

    expect(display.markRunning).toHaveBeenCalledWith(1);
  });

  it('onCompleted calls display.markCompleted', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onCompleted(1);

    expect(display.markCompleted).toHaveBeenCalledWith(1);
  });

  it('onPermanentlyFailed calls display.markPermanentlyFailed with error', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onPermanentlyFailed(1, 'fatal error');

    expect(display.markPermanentlyFailed).toHaveBeenCalledWith(1, 'fatal error');
  });

  it('onProgressUpdate calls display.updateProgress with all args', () => {
    const display = createMockDisplay();
    const cb = buildProgressCallback(display);

    cb.onProgressUpdate(1, 3, 1, 5, 2);

    expect(display.updateProgress).toHaveBeenCalledWith(1, 3, 1, 5, 2);
  });
});
