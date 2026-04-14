import { killAllChildProcesses, getActiveProcessCount } from '../claude-cli.js';
export { killAllChildProcesses, getActiveProcessCount };

export type { InstanceStatus, InstanceConfig, InstanceState, RetryInfo, ProgressCallback, RoundExecutionConfig, RoundExecutionResult } from './types.js';
export { DEFAULT_MAX_RETRIES } from './types.js';
export { buildInstancePrompt, buildDiscoveryPrompt } from './prompts.js';
export { spawnInstance, spawnInstances, spawnInstanceWithResume } from './spawning.js';
export { runInstanceRounds } from './rounds.js';
