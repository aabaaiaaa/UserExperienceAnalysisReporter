import { runClaude, ClaudeCliResult } from './claude-cli.js';
import { getInstancePaths } from './file-manager.js';
import { buildDiscoveryInstructions, buildDiscoveryContextPrompt, readDiscoveryContent, extractDiscoveryItems } from './discovery.js';
import { buildReportInstructions } from './report.js';
import { buildScreenshotInstructions } from './screenshots.js';
import { readCheckpoint, writeCheckpoint, createInitialCheckpoint, buildResumePrompt, Checkpoint } from './checkpoint.js';
import { isRateLimitError, getBackoffDelay, sleep, MAX_RATE_LIMIT_RETRIES } from './rate-limit.js';

export type InstanceStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface InstanceConfig {
  /** Instance number (1-based) */
  instanceNumber: number;
  /** The target URL of the web app to review */
  url: string;
  /** Full introduction/context document */
  intro: string;
  /** This instance's assigned chunk of the review plan */
  planChunk: string;
  /** UX evaluation scope (default or custom) */
  scope: string;
  /** Current round number (1-based, default: 1) */
  round?: number;
}

export interface InstanceState {
  instanceNumber: number;
  status: InstanceStatus;
  /** The CLI result when the instance finishes (success or failure) */
  result?: ClaudeCliResult;
  /** Error message if the instance failed */
  error?: string;
}

/** Default timeout for analysis instances: 30 minutes */
const INSTANCE_TIMEOUT_MS = 30 * 60 * 1000;

/** Default maximum retry attempts per instance on failure */
export const DEFAULT_MAX_RETRIES = 3;

export interface RetryInfo {
  /** Round number where failure occurred */
  round: number;
  /** Number of retry attempts made */
  attempts: number;
  /** Whether a retry eventually succeeded */
  succeeded: boolean;
  /** Error messages from the initial failure and each retry attempt */
  errors: string[];
}

/**
 * Build the prompt sent to a Claude Code instance for UX analysis.
 *
 * Includes the intro doc, plan chunk, evaluation scope, and instructions
 * for writing to the instance's discovery doc, checkpoint file, and report doc.
 */
export function buildInstancePrompt(config: InstanceConfig): string {
  const paths = getInstancePaths(config.instanceNumber);
  const roundNumber = config.round ?? 1;

  // Build discovery context for round 2+
  let discoveryContext = '';
  if (roundNumber > 1) {
    const existingDiscovery = readDiscoveryContent(config.instanceNumber);
    if (existingDiscovery) {
      discoveryContext = '\n' + buildDiscoveryContextPrompt(existingDiscovery) + '\n';
    }
  }

  return `You are a UX analyst reviewing a web application. Your job is to navigate the app, evaluate the user experience, and document your findings.

## Target Application

URL: ${config.url}

## Application Context

${config.intro}

## Your Assigned Review Areas

${config.planChunk}

## Evaluation Scope

Evaluate the application against the following criteria:

${config.scope}
${discoveryContext}
## Output Instructions

You must continuously write to three files as you work. Do NOT wait until the end — update these files after each significant action.

Current round: ${roundNumber}

${buildDiscoveryInstructions(config.instanceNumber, paths.discovery)}

### 2. Checkpoint File: ${paths.checkpoint}
After each significant step, write a JSON checkpoint with this structure:
\`\`\`json
{
  "instanceId": ${config.instanceNumber},
  "assignedAreas": ["area1", "area2"],
  "currentArea": "area being reviewed",
  "areasComplete": ["completed areas"],
  "areasInProgress": ["current area"],
  "areasNotStarted": ["remaining areas"],
  "lastAction": "description of last completed step",
  "timestamp": "ISO timestamp"
}
\`\`\`

${buildReportInstructions(config.instanceNumber, paths.report)}

${buildScreenshotInstructions(config.instanceNumber, paths.screenshots)}

## Process

1. Start by reading any existing checkpoint file to see if you need to resume from a previous point.
2. Navigate to the target URL and follow the application context instructions.
3. Work through each of your assigned review areas systematically.
4. For each area, evaluate against every criterion in the evaluation scope.
5. Document findings immediately as you discover them.
6. Update the checkpoint after completing each area.
7. When all assigned areas are reviewed, ensure all files are fully written.

Begin your review now.`;
}

/**
 * Spawn a single Claude Code instance for UX analysis.
 *
 * Starts the subprocess, monitors it to completion or failure,
 * and returns the final state.
 */
export async function spawnInstance(config: InstanceConfig): Promise<InstanceState> {
  const state: InstanceState = {
    instanceNumber: config.instanceNumber,
    status: 'running',
  };

  const prompt = buildInstancePrompt(config);
  const paths = getInstancePaths(config.instanceNumber);

  try {
    const result = await runClaude({
      prompt,
      cwd: paths.dir,
      timeout: INSTANCE_TIMEOUT_MS,
      extraArgs: ['--allowedTools', 'mcp__playwright,computer,bash,edit,write'],
    });

    state.result = result;

    if (result.success) {
      state.status = 'completed';
    } else {
      state.status = 'failed';
      state.error = result.stderr || `Instance exited with code ${result.exitCode}`;
    }
  } catch (err) {
    state.status = 'failed';
    state.error = err instanceof Error ? err.message : String(err);
  }

  return state;
}

/**
 * Spawn multiple Claude Code instances in parallel.
 *
 * Returns an array of InstanceState results, one per instance.
 * All instances run concurrently via Promise.allSettled — a failure
 * in one instance does not affect the others.
 */
export async function spawnInstances(configs: InstanceConfig[]): Promise<InstanceState[]> {
  const promises = configs.map((config) => spawnInstance(config));
  const settled = await Promise.allSettled(promises);

  return settled.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      instanceNumber: configs[index].instanceNumber,
      status: 'failed' as InstanceStatus,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

/**
 * Spawn a Claude Code instance with a resume prompt derived from a checkpoint.
 *
 * The resume prompt is appended to the base instance prompt, instructing
 * Claude to skip completed areas and continue from where it left off.
 */
export async function spawnInstanceWithResume(
  config: InstanceConfig,
  checkpoint: Checkpoint,
): Promise<InstanceState> {
  const state: InstanceState = {
    instanceNumber: config.instanceNumber,
    status: 'running',
  };

  const basePrompt = buildInstancePrompt(config);
  const resumePrompt = buildResumePrompt(checkpoint);
  const fullPrompt = basePrompt + '\n\n' + resumePrompt;

  const paths = getInstancePaths(config.instanceNumber);

  try {
    const result = await runClaude({
      prompt: fullPrompt,
      cwd: paths.dir,
      timeout: INSTANCE_TIMEOUT_MS,
      extraArgs: ['--allowedTools', 'mcp__playwright,computer,bash,edit,write'],
    });

    state.result = result;

    if (result.success) {
      state.status = 'completed';
    } else {
      state.status = 'failed';
      state.error = result.stderr || `Instance exited with code ${result.exitCode}`;
    }
  } catch (err) {
    state.status = 'failed';
    state.error = err instanceof Error ? err.message : String(err);
  }

  return state;
}

/**
 * Callbacks for the orchestrator to receive progress updates from runInstanceRounds.
 * All callbacks are optional — only provided fields are called.
 */
export interface ProgressCallback {
  onRoundStart?: (instanceNumber: number, round: number) => void;
  onRoundComplete?: (instanceNumber: number, round: number, durationMs: number) => void;
  onFailure?: (instanceNumber: number, round: number, error: string) => void;
  onRetry?: (instanceNumber: number, round: number, attempt: number, maxRetries: number) => void;
  onRetrySuccess?: (instanceNumber: number, round: number) => void;
  onCompleted?: (instanceNumber: number) => void;
  onPermanentlyFailed?: (instanceNumber: number, error: string) => void;
  onRateLimited?: (instanceNumber: number, round: number, backoffMs: number) => void;
  onRateLimitResolved?: (instanceNumber: number, round: number) => void;
}

export interface RoundExecutionConfig {
  /** Instance number (1-based) */
  instanceNumber: number;
  /** The target URL of the web app to review */
  url: string;
  /** Full introduction/context document */
  intro: string;
  /** This instance's assigned chunk of the review plan */
  planChunk: string;
  /** UX evaluation scope (default or custom) */
  scope: string;
  /** Total number of rounds to execute */
  totalRounds: number;
  /** Assigned area names for checkpoint tracking */
  assignedAreas?: string[];
  /** Maximum retry attempts per round on failure (default: 3) */
  maxRetries?: number;
  /** Optional callbacks for progress reporting to the orchestrator */
  progress?: ProgressCallback;
}

export interface RoundExecutionResult {
  instanceNumber: number;
  /** Final status after all rounds */
  status: InstanceStatus;
  /** Per-round results */
  roundResults: InstanceState[];
  /** The round number that was last completed (0 if none) */
  completedRounds: number;
  /** Error message if a round failed */
  error?: string;
  /** Retry information for any rounds that required retries */
  retries: RetryInfo[];
  /** Whether the instance exceeded the retry limit and was permanently failed */
  permanentlyFailed?: boolean;
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
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retries: RetryInfo[] = [];
  const cb = config.progress;

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
    };

    let state = await spawnInstance(instanceConfig);

    // If the round failed due to rate limiting, backoff and retry
    // without counting against the normal retry limit
    let rateLimitAttempts = 0;
    while (
      state.status === 'failed' &&
      state.result &&
      isRateLimitError(state.result) &&
      rateLimitAttempts < MAX_RATE_LIMIT_RETRIES
    ) {
      rateLimitAttempts++;
      const backoffMs = getBackoffDelay(rateLimitAttempts - 1);
      cb?.onRateLimited?.(config.instanceNumber, round, backoffMs);
      await sleep(backoffMs);
      cb?.onRateLimitResolved?.(config.instanceNumber, round);

      // Re-attempt: use checkpoint if available, otherwise fresh start
      const savedCheckpoint = readCheckpoint(config.instanceNumber);
      if (savedCheckpoint) {
        state = await spawnInstanceWithResume(instanceConfig, savedCheckpoint);
      } else {
        state = await spawnInstance(instanceConfig);
      }
    }

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
          state = await spawnInstance(instanceConfig);
        }

        // If the retry itself hits a rate limit, backoff before continuing
        let retryRateLimitAttempts = 0;
        while (
          state.status === 'failed' &&
          state.result &&
          isRateLimitError(state.result) &&
          retryRateLimitAttempts < MAX_RATE_LIMIT_RETRIES
        ) {
          retryRateLimitAttempts++;
          const backoffMs = getBackoffDelay(retryRateLimitAttempts - 1);
          cb?.onRateLimited?.(config.instanceNumber, round, backoffMs);
          await sleep(backoffMs);
          cb?.onRateLimitResolved?.(config.instanceNumber, round);

          const cp = readCheckpoint(config.instanceNumber);
          if (cp) {
            state = await spawnInstanceWithResume(instanceConfig, cp);
          } else {
            state = await spawnInstance(instanceConfig);
          }
        }

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
