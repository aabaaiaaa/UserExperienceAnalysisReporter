import { ProgressDisplay } from './progress-display.js';
import { ProgressCallback } from './instance-manager.js';

/**
 * Build a ProgressCallback that wires runInstanceRounds state transitions
 * into the ProgressDisplay.
 */
export function buildProgressCallback(display: ProgressDisplay): ProgressCallback {
  return {
    onRoundStart(instanceNumber: number, _round: number) {
      display.markRunning(instanceNumber);
    },
    onRoundComplete(instanceNumber: number, _round: number, durationMs: number) {
      display.markRoundComplete(instanceNumber, durationMs);
    },
    onFailure(instanceNumber: number, _round: number, error: string) {
      display.markFailed(instanceNumber, error);
    },
    onRetry(instanceNumber: number, _round: number, attempt: number, maxRetries: number) {
      display.markRetrying(instanceNumber, attempt, maxRetries);
    },
    onRetrySuccess(instanceNumber: number, _round: number) {
      display.markRunning(instanceNumber);
    },
    onRateLimited(instanceNumber: number, _round: number, backoffMs: number) {
      display.markRateLimited(instanceNumber, backoffMs);
    },
    onRateLimitResolved(instanceNumber: number, _round: number) {
      display.markRunning(instanceNumber);
    },
    onCompleted(instanceNumber: number) {
      display.markCompleted(instanceNumber);
    },
    onPermanentlyFailed(instanceNumber: number, error: string) {
      display.markPermanentlyFailed(instanceNumber, error);
    },
    onProgressUpdate(
      instanceNumber: number,
      completedItems: number,
      inProgressItems: number,
      totalItems: number,
      findingsCount: number,
    ) {
      display.updateProgress(instanceNumber, completedItems, inProgressItems, totalItems, findingsCount);
    },
  };
}
