import { runClaude } from '../claude-cli.js';
import { getInstancePaths } from '../file-manager.js';
import { buildResumePrompt, Checkpoint } from '../checkpoint.js';
import { INSTANCE_TIMEOUT_MS } from '../config.js';
import type { InstanceConfig, InstanceState, InstanceStatus } from './types.js';
import { buildInstancePrompt } from './prompts.js';

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
