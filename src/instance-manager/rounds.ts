import { extractDiscoveryItems } from '../discovery.js';
import { readReportContent, countFindings } from '../report.js';
import { readCheckpoint, writeCheckpoint, createInitialCheckpoint, Checkpoint } from '../checkpoint.js';
import { isRateLimitError, withRateLimitRetry, RateLimitRetryState, sleep } from '../rate-limit.js';
import { INSTANCE_TIMEOUT_MS, MAX_RETRIES, MAX_RATE_LIMIT_RETRIES } from '../config.js';
import { debug } from '../logger.js';
import type { InstanceConfig, InstanceState, RetryInfo, ProgressCallback, RoundExecutionConfig, RoundExecutionResult } from './types.js';
import { spawnInstance, spawnInstanceWithResume } from './spawning.js';

/**
 * Handle rate-limit retries for a failed instance spawn.
 *
 * Delegates to the shared `withRateLimitRetry` utility from rate-limit.ts,
 * adapting between the InstanceState used by the instance manager and the
 * ClaudeCliResult expected by the shared utility.
 *
 * Rate-limit retries are counted globally via `retryState.globalAttempts`,
 * so the budget is shared across the initial spawn and any normal retries.
 */
async function handleRateLimitRetries(
  state: InstanceState,
  retryState: RateLimitRetryState,
  respawn: () => Promise<InstanceState>,
  callbacks?: {
    onRateLimited?: (backoffMs: number) => void;
    onRateLimitResolved?: () => void;
  },
  maxRateLimitRetries: number = MAX_RATE_LIMIT_RETRIES,
): Promise<InstanceState> {
  // Short-circuit: if not a rate-limit failure, nothing to retry
  if (state.status !== 'failed' || !state.result || !isRateLimitError(state.result)) {
    return state;
  }

  let latestState = state;
  let firstCall = true;

  await withRateLimitRetry(
    async () => {
      // First call returns the already-known rate-limit result so the
      // shared utility can enter its retry loop without an extra spawn.
      if (firstCall) {
        firstCall = false;
        return state.result!;
      }
      latestState = await respawn();
      // If respawn threw and was caught internally, result may be undefined.
      // Return a synthetic failure so the retry loop can evaluate it.
      return latestState.result ?? {
        stdout: '',
        stderr: latestState.error ?? 'Unknown error',
        exitCode: 1,
        success: false,
      };
    },
    {
      maxRetries: maxRateLimitRetries,
      retryState,
      onRateLimited: callbacks?.onRateLimited,
      onRateLimitResolved: callbacks?.onRateLimitResolved,
      sleepFn: sleep,
    },
  );

  return latestState;
}

/**
 * Push item-level progress data through the callback.
 * Derives area progress from the checkpoint and reads findings count from the report file.
 */
function emitProgressUpdate(
  instanceNumber: number,
  checkpoint: Checkpoint | null,
  cb?: ProgressCallback,
): void {
  if (!cb?.onProgressUpdate || !checkpoint) return;

  const completedItems = checkpoint.areas.filter(a => a.status === 'complete').length;
  const inProgressItems = checkpoint.areas.filter(a => a.status === 'in-progress').length;
  const totalItems = checkpoint.areas.length;

  let findingsCount = 0;
  const reportContent = readReportContent(instanceNumber);
  if (reportContent) {
    findingsCount = countFindings(reportContent);
  }

  cb.onProgressUpdate(instanceNumber, completedItems, inProgressItems, totalItems, findingsCount);
}

/**
 * Run multiple sequential rounds for a single instance.
 *
 * Round 1 uses the plan chunk and scope.
 * Round 2+ includes the accumulated discovery doc from previous rounds
 * so Claude can focus on gaps and go deeper.
 *
 * On failure, the orchestrator reads the checkpoint file and retries
 * with a resume prompt. If the checkpoint is missing or corrupted,
 * the round restarts from scratch. If the maximum retry count is
 * exceeded, the instance is marked as permanently failed.
 */
export async function runInstanceRounds(config: RoundExecutionConfig): Promise<RoundExecutionResult> {
  const roundResults: InstanceState[] = [];
  const areas = config.assignedAreas ?? [];
  const maxRetries = config.maxRetries ?? MAX_RETRIES;
  const instanceTimeoutMs = config.instanceTimeoutMs ?? INSTANCE_TIMEOUT_MS;
  const rateLimitRetries = config.rateLimitRetries ?? MAX_RATE_LIMIT_RETRIES;
  const retries: RetryInfo[] = [];
  const cb = config.progress;
  // Global rate-limit retry counter shared across all rounds and normal retries
  const rateLimitRetryState: RateLimitRetryState = { globalAttempts: 0 };

  for (let round = 1; round <= config.totalRounds; round++) {
    // For round 2+, recalibrate the checkpoint areas to use the more granular
    // discovery doc items instead of the original plan areas. This gives the
    // progress bar a finer-grained scale based on what was actually discovered.
    let roundAreas = areas;
    if (round > 1) {
      const discoveryItems = extractDiscoveryItems(config.instanceNumber);
      if (discoveryItems && discoveryItems.length > 0) {
        roundAreas = discoveryItems;
      }
    }

    // Write checkpoint at the start of each round
    const initialCheckpoint = createInitialCheckpoint(config.instanceNumber, roundAreas, round);
    writeCheckpoint(config.instanceNumber, initialCheckpoint);
    emitProgressUpdate(config.instanceNumber, initialCheckpoint, cb);

    cb?.onRoundStart?.(config.instanceNumber, round);

    const roundStartTime = Date.now();

    // Spawn the instance for this round
    const instanceConfig: InstanceConfig = {
      instanceNumber: config.instanceNumber,
      url: config.url,
      intro: config.intro,
      planChunk: config.planChunk,
      scope: config.scope,
      round,
      timeoutMs: instanceTimeoutMs,
      promptBuilder: config.promptBuilder,
    };

    let state = await spawnInstance(instanceConfig);

    // Helper to respawn using checkpoint if available, otherwise fresh start
    const respawn = async (): Promise<InstanceState> => {
      const cp = readCheckpoint(config.instanceNumber);
      if (cp) {
        return spawnInstanceWithResume(instanceConfig, cp);
      }
      return spawnInstance(instanceConfig);
    };

    // Rate-limit retry callbacks bound to instance/round
    const rateLimitCallbacks = {
      onRateLimited: (backoffMs: number) => cb?.onRateLimited?.(config.instanceNumber, round, backoffMs),
      onRateLimitResolved: () => cb?.onRateLimitResolved?.(config.instanceNumber, round),
    };

    // If the round failed due to rate limiting, backoff and retry
    // without counting against the normal retry limit.
    // Uses the global rateLimitRetryState shared across all rounds and retries.
    state = await handleRateLimitRetries(state, rateLimitRetryState, respawn, rateLimitCallbacks, rateLimitRetries);

    // Push progress after initial spawn cycle completes
    emitProgressUpdate(config.instanceNumber, readCheckpoint(config.instanceNumber), cb);

    // If the round failed (non-rate-limit or rate limit retries exhausted),
    // enter the normal retry loop
    if (state.status === 'failed') {
      cb?.onFailure?.(config.instanceNumber, round, state.error || 'Unknown error');

      const retryInfo: RetryInfo = {
        round,
        attempts: 0,
        succeeded: false,
        errors: [state.error || 'Unknown error'],
      };

      while (retryInfo.attempts < maxRetries) {
        retryInfo.attempts++;
        debug(`Instance ${config.instanceNumber} round ${round}: retry attempt ${retryInfo.attempts}/${maxRetries}`);
        cb?.onRetry?.(config.instanceNumber, round, retryInfo.attempts, maxRetries);

        // Read the checkpoint to determine resume state
        const savedCheckpoint = readCheckpoint(config.instanceNumber);

        if (savedCheckpoint) {
          // Valid checkpoint exists: resume from where we left off
          state = await spawnInstanceWithResume(instanceConfig, savedCheckpoint);
        } else {
          // Checkpoint missing or corrupted: restart the round from scratch
          const freshCheckpoint = createInitialCheckpoint(config.instanceNumber, areas, round);
          writeCheckpoint(config.instanceNumber, freshCheckpoint);
          emitProgressUpdate(config.instanceNumber, freshCheckpoint, cb);
          state = await spawnInstance(instanceConfig);
        }

        // If the retry itself hits a rate limit, use the same shared helper
        // with the global retry budget
        state = await handleRateLimitRetries(state, rateLimitRetryState, respawn, rateLimitCallbacks, rateLimitRetries);

        // Push progress after retry spawn cycle completes
        emitProgressUpdate(config.instanceNumber, readCheckpoint(config.instanceNumber), cb);

        if (state.status === 'completed') {
          retryInfo.succeeded = true;
          cb?.onRetrySuccess?.(config.instanceNumber, round);
          break;
        }

        retryInfo.errors.push(state.error || 'Unknown error');
      }

      retries.push(retryInfo);

      if (!retryInfo.succeeded) {
        // Retry limit exceeded — permanently failed
        roundResults.push(state);
        cb?.onPermanentlyFailed?.(config.instanceNumber, state.error || 'Unknown error');
        return {
          instanceNumber: config.instanceNumber,
          status: 'failed',
          roundResults,
          completedRounds: round - 1,
          error: state.error,
          retries,
          permanentlyFailed: true,
        };
      }
    }

    const roundDurationMs = Date.now() - roundStartTime;
    cb?.onRoundComplete?.(config.instanceNumber, round, roundDurationMs);

    roundResults.push(state);
  }

  cb?.onCompleted?.(config.instanceNumber);

  return {
    instanceNumber: config.instanceNumber,
    status: 'completed',
    roundResults,
    completedRounds: config.totalRounds,
    retries,
  };
}
