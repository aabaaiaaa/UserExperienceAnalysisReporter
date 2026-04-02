import { readCheckpoint, Checkpoint } from './checkpoint.js';
import { readReportContent } from './report.js';

export interface InstanceProgress {
  instanceNumber: number;
  currentRound: number;
  totalRounds: number;
  totalItems: number;
  completedItems: number;
  inProgressItems: number;
  findingsCount: number;
  startTime: number;
  roundStartTime: number;
  status: 'running' | 'completed' | 'failed' | 'retrying';
  error?: string;
  retryAttempt?: number;
  maxRetries?: number;
  permanentlyFailed?: boolean;
  priorRoundDurations: number[];
}

// ANSI color codes for terminal output
export const ANSI_RESET = '\x1B[0m';
export const ANSI_RED = '\x1B[31m';
export const ANSI_GREEN = '\x1B[32m';

const BAR_WIDTH = 20;
const BAR_FILLED = '#';
const BAR_EMPTY = '-';

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export function calculateEta(
  elapsedMs: number,
  completedItems: number,
  totalItems: number,
  currentRound: number,
  totalRounds: number,
  priorRoundDurations: number[],
): string | null {
  if (completedItems <= 0 || totalItems <= 0) return null;

  const remainingItems = totalItems - completedItems;
  const msPerItem = elapsedMs / completedItems;
  const currentRoundRemainingMs = remainingItems > 0 ? msPerItem * remainingItems : 0;

  // Estimate remaining rounds based on prior round durations or current round pace
  let futureRoundsMs = 0;
  const remainingRounds = totalRounds - currentRound;
  if (remainingRounds > 0) {
    if (priorRoundDurations.length > 0) {
      const avgRoundMs = priorRoundDurations.reduce((a, b) => a + b, 0) / priorRoundDurations.length;
      futureRoundsMs = avgRoundMs * remainingRounds;
    } else {
      // Estimate from current round pace
      const currentRoundEstimate = totalItems > 0 ? msPerItem * totalItems : 0;
      futureRoundsMs = currentRoundEstimate * remainingRounds;
    }
  }

  const totalRemainingMs = currentRoundRemainingMs + futureRoundsMs;
  if (totalRemainingMs <= 0) return null;

  return formatDuration(totalRemainingMs);
}

export function renderProgressBar(percentage: number): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return '[' + BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(empty) + ']';
}

export function countFindings(reportContent: string): number {
  const matches = reportContent.match(/^## I\d+-UXR-\d+:/gm);
  return matches ? matches.length : 0;
}

export function getProgressFromCheckpoint(checkpoint: Checkpoint): {
  completed: number;
  inProgress: number;
  total: number;
} {
  const completed = checkpoint.areas.filter((a) => a.status === 'complete').length;
  const inProgress = checkpoint.areas.filter((a) => a.status === 'in-progress').length;
  const total = checkpoint.areas.length;
  return { completed, inProgress, total };
}

export function formatProgressLine(progress: InstanceProgress, now?: number): string {
  const currentTime = now ?? Date.now();
  const pct =
    progress.totalItems > 0
      ? Math.round((progress.completedItems / progress.totalItems) * 100)
      : 0;

  const bar = renderProgressBar(pct);
  const elapsed = currentTime - progress.roundStartTime;
  const elapsedStr = formatDuration(elapsed);

  const roundStr = `R${progress.currentRound}/${progress.totalRounds}`;
  const prefix = `I${progress.instanceNumber} ${roundStr} ${bar} ${pct}%`;

  // Permanently failed: red with final error message
  if (progress.permanentlyFailed) {
    const errorMsg = progress.error || 'Unknown error';
    return `${ANSI_RED}${prefix} | FAILED: ${errorMsg} (retries exhausted)${ANSI_RESET}`;
  }

  // Failed (not permanently): red with error description
  if (progress.status === 'failed') {
    const errorMsg = progress.error || 'Unknown error';
    return `${ANSI_RED}${prefix} | ERROR: ${errorMsg}${ANSI_RESET}`;
  }

  // Retrying: red with retry attempt info
  if (progress.status === 'retrying') {
    const attempt = progress.retryAttempt ?? 1;
    const max = progress.maxRetries ?? 3;
    return `${ANSI_RED}${prefix} | Retrying (attempt ${attempt}/${max})...${ANSI_RESET}`;
  }

  // Completed: green with stats
  if (progress.status === 'completed') {
    const statsStr = `${progress.completedItems}/${progress.totalItems} areas, ${progress.findingsCount} findings`;
    return `${ANSI_GREEN}${prefix} | ${statsStr} | ${elapsedStr}${ANSI_RESET}`;
  }

  // Running: default color (white/no color) with stats and ETA
  let etaStr = '';
  const eta = calculateEta(
    elapsed,
    progress.completedItems,
    progress.totalItems,
    progress.currentRound,
    progress.totalRounds,
    progress.priorRoundDurations,
  );
  if (eta) {
    etaStr = ` | ETA ~${eta}`;
  }

  const statsStr = `${progress.completedItems}/${progress.totalItems} areas, ${progress.findingsCount} findings`;
  return `${prefix} | ${statsStr} | ${elapsedStr}${etaStr}`;
}

export class ProgressDisplay {
  private instances: Map<number, InstanceProgress> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private renderedLineCount = 0;

  constructor(
    private instanceNumbers: number[],
    private totalRounds: number,
  ) {
    const now = Date.now();
    for (const num of instanceNumbers) {
      this.instances.set(num, {
        instanceNumber: num,
        currentRound: 1,
        totalRounds,
        totalItems: 0,
        completedItems: 0,
        inProgressItems: 0,
        findingsCount: 0,
        startTime: now,
        roundStartTime: now,
        status: 'running',
        priorRoundDurations: [],
      });
    }
  }

  getProgress(instanceNumber: number): InstanceProgress | undefined {
    return this.instances.get(instanceNumber);
  }

  setProgress(instanceNumber: number, update: Partial<InstanceProgress>): void {
    const existing = this.instances.get(instanceNumber);
    if (existing) {
      Object.assign(existing, update);
    }
  }

  markRoundComplete(instanceNumber: number, roundDurationMs: number): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.priorRoundDurations.push(roundDurationMs);
    progress.currentRound++;
    progress.roundStartTime = Date.now();
    progress.completedItems = 0;
    progress.inProgressItems = 0;
  }

  markCompleted(instanceNumber: number): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.status = 'completed';
  }

  markFailed(instanceNumber: number, error: string): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.status = 'failed';
    progress.error = error;
  }

  markRetrying(instanceNumber: number, attempt: number, maxRetries: number): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.status = 'retrying';
    progress.retryAttempt = attempt;
    progress.maxRetries = maxRetries;
  }

  markRunning(instanceNumber: number): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.status = 'running';
    progress.error = undefined;
    progress.retryAttempt = undefined;
    progress.maxRetries = undefined;
  }

  markPermanentlyFailed(instanceNumber: number, error: string): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.status = 'failed';
    progress.error = error;
    progress.permanentlyFailed = true;
  }

  updateFromFiles(instanceNumber: number): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress || progress.status === 'completed' || progress.status === 'failed' || progress.status === 'retrying' || progress.permanentlyFailed) return;

    const checkpoint = readCheckpoint(instanceNumber);
    if (checkpoint) {
      const { completed, inProgress, total } = getProgressFromCheckpoint(checkpoint);
      progress.completedItems = completed;
      progress.inProgressItems = inProgress;
      progress.totalItems = total;
      progress.currentRound = checkpoint.currentRound;
    }

    const reportContent = readReportContent(instanceNumber);
    if (reportContent) {
      progress.findingsCount = countFindings(reportContent);
    }
  }

  updateAllFromFiles(): void {
    for (const num of this.instanceNumbers) {
      this.updateFromFiles(num);
    }
  }

  renderLines(now?: number): string[] {
    const lines: string[] = [];
    for (const num of this.instanceNumbers) {
      const progress = this.instances.get(num);
      if (progress) {
        lines.push(formatProgressLine(progress, now));
      }
    }
    return lines;
  }

  renderToTerminal(): void {
    if (this.renderedLineCount > 0) {
      process.stderr.write(`\x1B[${this.renderedLineCount}A`);
    }

    const lines = this.renderLines();
    for (const line of lines) {
      process.stderr.write(`\x1B[2K${line}\n`);
    }
    this.renderedLineCount = lines.length;
  }

  start(intervalMs = 1000): void {
    this.renderToTerminal();
    this.pollTimer = setInterval(() => {
      this.updateAllFromFiles();
      this.renderToTerminal();
    }, intervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.renderToTerminal();
  }
}
