import { statSync } from 'node:fs';
import { readCheckpoint, type Checkpoint } from './checkpoint.js';
import { RENDER_INTERVAL_MS } from './config.js';
import { getInstancePaths } from './file-manager.js';
import { debug } from './logger.js';
import { readReportContent, countFindings } from './report.js';
import { listScreenshots } from './screenshots.js';

export interface InstanceProgress {
  instanceNumber: number;
  currentRound: number;
  totalRounds: number;
  totalItems: number;
  completedItems: number;
  inProgressItems: number;
  findingsCount: number;
  screenshotCount: number;
  startTime: number;
  roundStartTime: number;
  status: 'running' | 'completed' | 'failed' | 'retrying' | 'rate-limited';
  error?: string;
  retryAttempt?: number;
  maxRetries?: number;
  permanentlyFailed?: boolean;
  rateLimitBackoffMs?: number;
  completedTime?: number;
  priorRoundDurations: number[];
  latestMtime?: number;
}

export type ConsolidationStatus = 'idle' | 'running' | 'completed';

export interface ConsolidationState {
  status: ConsolidationStatus;
  reportPath?: string;
  discoveryPath?: string;
  spinnerFrame: number;
}

// ANSI color codes for terminal output
export const ANSI_RESET = '\x1B[0m';
export const ANSI_RED = '\x1B[31m';
export const ANSI_GREEN = '\x1B[32m';
export const ANSI_YELLOW = '\x1B[33m';

const SPINNER_FRAMES = ['|', '/', '-', '\\'];

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

  // Rate-limited: yellow with backoff duration
  if (progress.status === 'rate-limited') {
    const backoffSec = progress.rateLimitBackoffMs
      ? Math.ceil(progress.rateLimitBackoffMs / 1000)
      : 0;
    return `${ANSI_YELLOW}${prefix} | Rate limited — pausing ${backoffSec}s before retry...${ANSI_RESET}`;
  }

  // Completed: green with stats and frozen elapsed time
  if (progress.status === 'completed') {
    const totalElapsed = (progress.completedTime ?? currentTime) - progress.startTime;
    const totalElapsedStr = formatDuration(totalElapsed);
    let statsStr = `${progress.completedItems}/${progress.totalItems} areas, ${progress.findingsCount} findings`;
    if (progress.screenshotCount > 0) {
      statsStr += `, ${progress.screenshotCount} screenshots`;
    }
    return `${ANSI_GREEN}${prefix} | ${statsStr} | ${totalElapsedStr}${ANSI_RESET}`;
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

  let statsStr = `${progress.completedItems}/${progress.totalItems} areas, ${progress.findingsCount} findings`;
  if (progress.screenshotCount > 0) {
    statsStr += `, ${progress.screenshotCount} screenshots`;
  }
  if (progress.latestMtime != null) {
    const agoSec = Math.max(0, Math.round((currentTime - progress.latestMtime) / 1000));
    statsStr += ` \u00B7 active ${agoSec}s ago`;
  }
  return `${prefix} | ${statsStr} | ${elapsedStr}${etaStr}`;
}

export function formatConsolidationLine(state: ConsolidationState): string | null {
  if (state.status === 'idle') return null;

  if (state.status === 'running') {
    const frame = SPINNER_FRAMES[state.spinnerFrame % SPINNER_FRAMES.length];
    return `${frame} Consolidating reports...`;
  }

  // Completed
  const lines: string[] = [];
  lines.push(`${ANSI_GREEN}✓ Consolidation complete${ANSI_RESET}`);
  if (state.reportPath) {
    lines.push(`  Report:    ${state.reportPath}`);
  }
  if (state.discoveryPath) {
    lines.push(`  Discovery: ${state.discoveryPath}`);
  }
  return lines.join('\n');
}

export class ProgressDisplay {
  private instances: Map<number, InstanceProgress> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private renderedLineCount = 0;
  private consolidation: ConsolidationState = { status: 'idle', spinnerFrame: 0 };

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
        screenshotCount: 0,
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
    // Only advance to next round if more rounds remain;
    // on the final round, preserve the current round number and item counts
    // so the completed line renders correctly.
    if (progress.currentRound < progress.totalRounds) {
      progress.currentRound++;
      progress.roundStartTime = Date.now();
      progress.completedItems = 0;
      progress.inProgressItems = 0;
    }
  }

  markCompleted(instanceNumber: number): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.status = 'completed';
    progress.completedTime = Date.now();
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

  markRateLimited(instanceNumber: number, backoffMs: number): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.status = 'rate-limited';
    progress.rateLimitBackoffMs = backoffMs;
  }

  markRunning(instanceNumber: number): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.status = 'running';
    progress.error = undefined;
    progress.retryAttempt = undefined;
    progress.maxRetries = undefined;
    progress.rateLimitBackoffMs = undefined;
  }

  markPermanentlyFailed(instanceNumber: number, error: string): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.status = 'failed';
    progress.error = error;
    progress.permanentlyFailed = true;
  }

  updateProgress(
    instanceNumber: number,
    completedItems: number,
    inProgressItems: number,
    totalItems: number,
    findingsCount: number,
  ): void {
    const progress = this.instances.get(instanceNumber);
    if (!progress) return;
    progress.completedItems = completedItems;
    progress.inProgressItems = inProgressItems;
    progress.totalItems = totalItems;
    progress.findingsCount = findingsCount;
  }

  startConsolidation(): void {
    this.consolidation = { status: 'running', spinnerFrame: 0 };
  }

  completeConsolidation(reportPath: string, discoveryPath: string): void {
    this.consolidation = { status: 'completed', reportPath, discoveryPath, spinnerFrame: 0 };
  }

  getConsolidationState(): ConsolidationState {
    return this.consolidation;
  }

  renderLines(now?: number): string[] {
    const lines: string[] = [];
    for (const num of this.instanceNumbers) {
      const progress = this.instances.get(num);
      if (progress) {
        lines.push(formatProgressLine(progress, now));
      }
    }

    const consolidationLine = formatConsolidationLine(this.consolidation);
    if (consolidationLine) {
      // Consolidation line may contain newlines (for completed state with paths)
      lines.push(...consolidationLine.split('\n'));
    }

    return lines;
  }

  renderToTerminal(): void {
    if (this.renderedLineCount > 0) {
      process.stderr.write(`\x1B[${this.renderedLineCount}A`);
    }

    // Advance spinner frame for consolidation animation
    if (this.consolidation.status === 'running') {
      this.consolidation.spinnerFrame++;
    }

    const lines = this.renderLines();
    for (const line of lines) {
      process.stderr.write(`\x1B[2K${line}\n`);
    }
    this.renderedLineCount = lines.length;
  }

  /**
   * Safely stat a file and return its mtime in milliseconds.
   * Returns null if the file doesn't exist or the stat fails.
   */
  private safeStatMtimeMs(filePath: string): number | null {
    try {
      return statSync(filePath).mtimeMs;
    } catch {
      return null;
    }
  }

  /**
   * Poll checkpoint and report files for all running instances and
   * update their progress. Called once per render tick so the display
   * reflects live subprocess progress.
   */
  pollCheckpoints(): void {
    for (const [instanceNumber, progress] of this.instances) {
      if (progress.status !== 'running') continue;

      // Always try to read findings from the report file — this works even
      // when the checkpoint hasn't been updated yet by the subprocess.
      let findingsCount = progress.findingsCount;
      const reportContent = readReportContent(instanceNumber);
      if (reportContent) {
        findingsCount = countFindings(reportContent);
      }

      // Count screenshots for this instance
      const screenshots = listScreenshots(instanceNumber);
      progress.screenshotCount = screenshots.length;

      // Check file modification times for liveness signal
      const paths = getInstancePaths(instanceNumber);
      const mtimes = [
        this.safeStatMtimeMs(paths.discovery),
        this.safeStatMtimeMs(paths.report),
        this.safeStatMtimeMs(paths.checkpoint),
        this.safeStatMtimeMs(paths.screenshots),
      ];
      let latestMtime: number | null = null;
      for (const mt of mtimes) {
        if (mt != null && (latestMtime == null || mt > latestMtime)) {
          latestMtime = mt;
        }
      }
      progress.latestMtime = latestMtime ?? undefined;

      const checkpoint = readCheckpoint(instanceNumber);
      if (checkpoint) {
        const { completed, inProgress, total } = getProgressFromCheckpoint(checkpoint);
        this.updateProgress(instanceNumber, completed, inProgress, total, findingsCount);
      } else if (findingsCount !== progress.findingsCount) {
        // Checkpoint unreadable but findings changed — update just findings
        progress.findingsCount = findingsCount;
      }
    }
  }

  start(intervalMs = RENDER_INTERVAL_MS): void {
    this.pollCheckpoints();
    this.renderToTerminal();
    this.pollTimer = setInterval(() => {
      this.pollCheckpoints();
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
