import { runClaude, ClaudeCliResult, killAllChildProcesses, getActiveProcessCount } from './claude-cli.js';
export { killAllChildProcesses, getActiveProcessCount };
import { getInstancePaths } from './file-manager.js';
import { buildDiscoveryInstructions, buildDiscoveryContextPrompt, readDiscoveryContent, extractDiscoveryItems } from './discovery.js';
import { buildReportInstructions, readReportContent, countFindings } from './report.js';
import { buildScreenshotInstructions } from './screenshots.js';
import { readCheckpoint, writeCheckpoint, createInitialCheckpoint, buildResumePrompt, Checkpoint } from './checkpoint.js';
import { isRateLimitError, withRateLimitRetry, RateLimitRetryState, sleep } from './rate-limit.js';
import { INSTANCE_TIMEOUT_MS, MAX_RETRIES, MAX_RATE_LIMIT_RETRIES } from './config.js';
import { debug } from './logger.js';

export type { InstanceStatus, InstanceConfig, InstanceState, RetryInfo, ProgressCallback, RoundExecutionConfig, RoundExecutionResult } from './instance-manager/types.js';
export { DEFAULT_MAX_RETRIES } from './instance-manager/types.js';
import type { InstanceStatus, InstanceConfig, InstanceState, RetryInfo, ProgressCallback, RoundExecutionConfig, RoundExecutionResult } from './instance-manager/types.js';

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
**CRITICAL: Update this checkpoint file FREQUENTLY.** Write to it after EVERY page navigation, EVERY screenshot taken, and EVERY finding recorded. Do NOT wait until an area is complete — update the checkpoint as you go, after each individual action. This file is how the user tracks your progress in real time, so frequent updates are essential for the user experience.

Write a JSON checkpoint with this EXACT structure:
\`\`\`json
{
  "instanceId": ${config.instanceNumber},
  "assignedAreas": ["area1", "area2"],
  "currentRound": ${roundNumber},
  "areas": [
    { "name": "area1", "status": "complete" },
    { "name": "area2", "status": "in-progress" },
    { "name": "area3", "status": "not-started" }
  ],
  "lastAction": "description of last completed step",
  "timestamp": "ISO timestamp"
}
\`\`\`
Each area's status must be exactly one of: "complete", "in-progress", or "not-started".

${buildReportInstructions(config.instanceNumber, paths.report)}

${buildScreenshotInstructions(config.instanceNumber, paths.screenshots)}

## Process

1. Start by reading any existing checkpoint file to see if you need to resume from a previous point.
2. Navigate to the target URL and follow the application context instructions.
3. Work through each of your assigned review areas systematically.
4. For each area, evaluate against every criterion in the evaluation scope.
5. Document findings immediately as you discover them.
6. Update the checkpoint after every navigation, screenshot, and finding — not just at area boundaries.
7. When all assigned areas are reviewed, ensure all files are fully written.

Begin your review now.`;
}

/**
 * Build the prompt sent to a Claude Code instance for discovery/exploration.
 *
 * Similar to buildInstancePrompt but removes report/findings instructions
 * and reframes the task as exploration and documentation rather than evaluation.
 */
export function buildDiscoveryPrompt(config: InstanceConfig): string {
  const paths = getInstancePaths(config.instanceNumber);
  const roundNumber = config.round ?? 1;

  const hasPlanChunk = config.planChunk.trim().length > 0;

  const areasSection = hasPlanChunk
    ? `## Areas to Explore

${config.planChunk}`
    : `## Exploration Scope

No specific areas have been assigned. Explore the entire site freely starting from the target URL. Systematically discover and document all pages, features, and UI elements you can find.`;

  const scopeSection = config.scope.trim().length > 0
    ? `## Exploration Guidance

The following topics describe things to look for during exploration. As you navigate, note what is relevant but do not produce findings or severity ratings — just document what you observe.

${config.scope}`
    : '';

  return `You are a UX explorer documenting a web application. Your job is to navigate the app, map out its structure, and document everything you find.

## Target Application

URL: ${config.url}

## Application Context

${config.intro}

${areasSection}
${scopeSection ? '\n' + scopeSection + '\n' : ''}
## Output Instructions

You must continuously write to two files as you work. Do NOT wait until the end — update these files after each significant action.

Current round: ${roundNumber}

${buildDiscoveryInstructions(config.instanceNumber, paths.discovery)}

### 2. Checkpoint File: ${paths.checkpoint}
**CRITICAL: Update this checkpoint file FREQUENTLY.** Write to it after EVERY page navigation, EVERY screenshot taken, and EVERY area explored. Do NOT wait until an area is complete — update the checkpoint as you go, after each individual action. This file is how the user tracks your progress in real time, so frequent updates are essential for the user experience.

Write a JSON checkpoint with this EXACT structure:
\`\`\`json
{
  "instanceId": ${config.instanceNumber},
  "assignedAreas": ["area1", "area2"],
  "currentRound": ${roundNumber},
  "areas": [
    { "name": "area1", "status": "complete" },
    { "name": "area2", "status": "in-progress" },
    { "name": "area3", "status": "not-started" }
  ],
  "lastAction": "description of last completed step",
  "timestamp": "ISO timestamp"
}
\`\`\`
Each area's status must be exactly one of: "complete", "in-progress", or "not-started".

${buildScreenshotInstructions(config.instanceNumber, paths.screenshots)}

## Process

1. Start by reading any existing checkpoint file to see if you need to resume from a previous point.
2. Navigate to the target URL and follow the application context instructions.
3. Systematically explore ${hasPlanChunk ? 'your assigned areas' : 'the entire site'}.
4. For each area: take screenshots, document navigation paths, list all UI elements and features you find.
5. Go deep — explore sub-pages, modals, dropdowns, tabs, settings panels, and any interactive elements.
6. Document everything in the discovery file.
7. Update the checkpoint after every navigation and screenshot.

Begin your exploration now.`;
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

  const prompt = config.promptBuilder?.(config) ?? buildInstancePrompt(config);
  const paths = getInstancePaths(config.instanceNumber);

  try {
    const result = await runClaude({
      prompt,
      cwd: paths.dir,
      timeout: config.timeoutMs ?? INSTANCE_TIMEOUT_MS,
      extraArgs: ['--allowedTools', 'Bash,Read,Write,Edit,mcp__playwright'],
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

  const basePrompt = config.promptBuilder?.(config) ?? buildInstancePrompt(config);
  const resumePrompt = buildResumePrompt(checkpoint);
  const fullPrompt = basePrompt + '\n\n' + resumePrompt;

  const paths = getInstancePaths(config.instanceNumber);

  try {
    const result = await runClaude({
      prompt: fullPrompt,
      cwd: paths.dir,
      timeout: config.timeoutMs ?? INSTANCE_TIMEOUT_MS,
      extraArgs: ['--allowedTools', 'Bash,Read,Write,Edit,mcp__playwright'],
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
