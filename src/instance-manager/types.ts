import { ClaudeCliResult } from '../claude-cli.js';
import { MAX_RETRIES } from '../config.js';

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
  /** Timeout in milliseconds (default: INSTANCE_TIMEOUT_MS from config) */
  timeoutMs?: number;
  /** Custom prompt builder function. Defaults to buildInstancePrompt. */
  promptBuilder?: (config: InstanceConfig) => string;
}

export interface InstanceState {
  instanceNumber: number;
  status: InstanceStatus;
  /** The CLI result when the instance finishes (success or failure) */
  result?: ClaudeCliResult;
  /** Error message if the instance failed */
  error?: string;
}

/** @deprecated Use MAX_RETRIES from config.ts instead */
export const DEFAULT_MAX_RETRIES = MAX_RETRIES;

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
  onProgressUpdate?: (
    instanceNumber: number,
    completedItems: number,
    inProgressItems: number,
    totalItems: number,
    findingsCount: number,
  ) => void;
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
  /** Maximum retry attempts per round on failure (default: MAX_RETRIES from config) */
  maxRetries?: number;
  /** Timeout per instance in milliseconds (default: INSTANCE_TIMEOUT_MS from config) */
  instanceTimeoutMs?: number;
  /** Maximum rate-limit retry attempts globally (default: MAX_RATE_LIMIT_RETRIES from config) */
  rateLimitRetries?: number;
  /** Optional callbacks for progress reporting to the orchestrator */
  progress?: ProgressCallback;
  /** Custom prompt builder function. Defaults to buildInstancePrompt. */
  promptBuilder?: (config: InstanceConfig) => string;
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
