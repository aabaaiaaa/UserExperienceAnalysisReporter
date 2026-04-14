import { killAllChildProcesses, getActiveProcessCount } from './claude-cli.js';
export { killAllChildProcesses, getActiveProcessCount };

export type { InstanceStatus, InstanceConfig, InstanceState, RetryInfo, ProgressCallback, RoundExecutionConfig, RoundExecutionResult } from './instance-manager/types.js';
export { DEFAULT_MAX_RETRIES } from './instance-manager/types.js';
export { buildInstancePrompt, buildDiscoveryPrompt } from './instance-manager/prompts.js';
export { spawnInstance, spawnInstances, spawnInstanceWithResume } from './instance-manager/spawning.js';
export { runInstanceRounds } from './instance-manager/rounds.js';
