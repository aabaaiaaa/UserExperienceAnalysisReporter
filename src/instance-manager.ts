import { runClaude, ClaudeCliResult } from './claude-cli.js';
import { getInstancePaths } from './file-manager.js';
import { buildDiscoveryInstructions, buildDiscoveryContextPrompt, readDiscoveryContent } from './discovery.js';
import { buildReportInstructions } from './report.js';

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

${buildReportInstructions(config.instanceNumber, paths.report, paths.screenshots)}

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
