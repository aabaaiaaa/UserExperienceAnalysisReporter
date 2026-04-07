import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ParsedArgs } from './cli.js';
import { initWorkspace, cleanupTempDir } from './file-manager.js';
import { distributePlan } from './work-distribution.js';
import {
  runInstanceRounds,
  RoundExecutionConfig,
  RoundExecutionResult,
  ProgressCallback,
  killAllChildProcesses,
} from './instance-manager.js';
import {
  consolidateReports,
  reassignAndRemapScreenshots,
  organizeHierarchically,
  formatConsolidatedReport,
  consolidateDiscoveryDocs,
  writeConsolidatedDiscovery,
} from './consolidation.js';
import { ProgressDisplay } from './progress-display.js';
import { setVerbose, debug } from './logger.js';

/**
 * Extract area names from a plan chunk by looking for markdown headings
 * and list items that describe review areas.
 *
 * Heuristic: extract ## headings as areas. If none found, extract top-level
 * list items (lines starting with "- " or "* "). If still none, return
 * a single generic area.
 */
export function extractAreasFromPlanChunk(chunk: string): string[] {
  // Try ## headings first
  const headings = chunk
    .split('\n')
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim())
    .filter((h) => h.length > 0);

  if (headings.length > 0) return headings;

  // Try # headings
  const h1s = chunk
    .split('\n')
    .filter((line) => /^#\s+/.test(line))
    .map((line) => line.replace(/^#\s+/, '').trim())
    .filter((h) => h.length > 0);

  if (h1s.length > 0) return h1s;

  // Try top-level list items
  const listItems = chunk
    .split('\n')
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((item) => item.length > 0);

  if (listItems.length > 0) return listItems;

  // Fallback: single generic area
  return ['Full review'];
}

/**
 * Build a ProgressCallback that wires runInstanceRounds state transitions
 * into the ProgressDisplay.
 */
function buildProgressCallback(display: ProgressDisplay): ProgressCallback {
  return {
    onRoundStart(instanceNumber: number, _round: number) {
      display.markRunning(instanceNumber);
    },
    onRoundComplete(instanceNumber: number, _round: number, durationMs: number) {
      display.markRoundComplete(instanceNumber, durationMs);
    },
    onFailure(instanceNumber: number, _round: number, error: string) {
      display.markFailed(instanceNumber, error);
    },
    onRetry(instanceNumber: number, _round: number, attempt: number, maxRetries: number) {
      display.markRetrying(instanceNumber, attempt, maxRetries);
    },
    onRetrySuccess(instanceNumber: number, _round: number) {
      display.markRunning(instanceNumber);
    },
    onRateLimited(instanceNumber: number, _round: number, backoffMs: number) {
      display.markRateLimited(instanceNumber, backoffMs);
    },
    onRateLimitResolved(instanceNumber: number, _round: number) {
      display.markRunning(instanceNumber);
    },
    onCompleted(instanceNumber: number) {
      display.markCompleted(instanceNumber);
    },
    onPermanentlyFailed(instanceNumber: number, error: string) {
      display.markPermanentlyFailed(instanceNumber, error);
    },
  };
}

/**
 * Run the full orchestration flow:
 *
 * 1. Initialize workspace (temp + output directories)
 * 2. Distribute work across instances
 * 3. Start progress display
 * 4. Spawn all instances in parallel with round execution
 * 5. After all complete or permanently fail, run consolidation
 * 6. Output final file paths
 */
export async function orchestrate(args: ParsedArgs): Promise<void> {
  // Enable verbose logging if requested
  setVerbose(args.verbose);

  // 1. Initialize workspace
  const workspace = await initWorkspace(args.instances, args.output);

  // 2. Set up progress display
  const instanceNumbers = Array.from({ length: args.instances }, (_, i) => i + 1);
  const display = new ProgressDisplay(instanceNumbers, args.rounds);
  const progressCallback = buildProgressCallback(display);

  // Register signal handlers to clean up child processes on SIGINT/SIGTERM
  const signalHandler = (signal: NodeJS.Signals) => {
    killAllChildProcesses();
    display.stop();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  display.start();

  try {
    // 3. Distribute work across instances
    const distributionStart = Date.now();
    const distribution = await distributePlan(args.plan, args.instances);
    debug(`Distribution phase completed in ${Date.now() - distributionStart}ms`);

    // 4. Spawn all instances in parallel — each runs all its rounds
    const configs: RoundExecutionConfig[] = distribution.chunks.map((chunk, i) => ({
      instanceNumber: i + 1,
      url: args.url,
      intro: args.intro,
      planChunk: chunk,
      scope: args.scope,
      totalRounds: args.rounds,
      assignedAreas: extractAreasFromPlanChunk(chunk),
      maxRetries: args.maxRetries,
      instanceTimeoutMs: args.instanceTimeout * 60_000,
      rateLimitRetries: args.rateLimitRetries,
      progress: progressCallback,
    }));

    debug(`Spawning ${configs.length} instance(s) for ${args.rounds} round(s)`);
    const executionStart = Date.now();
    const settled = await Promise.allSettled(
      configs.map((config) => runInstanceRounds(config)),
    );
    debug(`Instance execution phase completed in ${Date.now() - executionStart}ms`);

    // Process results — mark any unexpected rejections as permanently failed
    const results: RoundExecutionResult[] = settled.map((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }
      // Promise rejection (unexpected crash in orchestrator logic)
      const instanceNumber = i + 1;
      const error = outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
      display.markPermanentlyFailed(instanceNumber, error);
      return {
        instanceNumber,
        status: 'failed' as const,
        roundResults: [],
        completedRounds: 0,
        error,
        retries: [],
        permanentlyFailed: true,
      };
    });

    // 5. Consolidation phase
    const consolidationStart = Date.now();
    display.startConsolidation();

    // Consolidate reports (dedup, merge)
    const consolidation = await consolidateReports(instanceNumbers);

    // Reassign IDs and remap screenshots
    const { findings } = reassignAndRemapScreenshots(consolidation, workspace.outputDir);

    // Organize hierarchically
    const groups = await organizeHierarchically(findings);

    // Format and write the consolidated report
    const reportContent = formatConsolidatedReport(groups);
    const reportPath = join(workspace.outputDir, 'report.md');
    writeFileSync(reportPath, reportContent, 'utf-8');

    // Consolidate discovery docs
    const discoveryResult = await consolidateDiscoveryDocs(instanceNumbers);
    writeConsolidatedDiscovery(workspace.outputDir, discoveryResult.content);
    const discoveryPath = join(workspace.outputDir, 'discovery.md');

    debug(`Consolidation phase completed in ${Date.now() - consolidationStart}ms`);

    // 6. Show final output paths
    display.completeConsolidation(reportPath, discoveryPath);
  } finally {
    process.removeListener('SIGINT', signalHandler);
    process.removeListener('SIGTERM', signalHandler);
    display.stop();
    if (!args.keepTemp) {
      await cleanupTempDir();
    }
  }
}
