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
  parseExistingReportIds,
  ConsolidationResult,
  UIAreaGroup,
} from './consolidation.js';
import { ProgressDisplay } from './progress-display.js';
import { setVerbose, debug } from './logger.js';
import {
  readConsolidationCheckpoint,
  writeConsolidationCheckpoint,
  createEmptyConsolidationCheckpoint,
  isStepCompleted,
  ConsolidationCheckpoint,
} from './consolidation-checkpoint.js';

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
    onProgressUpdate(
      instanceNumber: number,
      completedItems: number,
      inProgressItems: number,
      totalItems: number,
      findingsCount: number,
    ) {
      display.updateProgress(instanceNumber, completedItems, inProgressItems, totalItems, findingsCount);
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
  const workspace = await initWorkspace(args.instances, args.output, args.append);

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

    // Read existing consolidation checkpoint (for resume)
    let checkpoint: ConsolidationCheckpoint =
      readConsolidationCheckpoint() ?? createEmptyConsolidationCheckpoint();

    // Step 1: Dedup — consolidate reports
    let consolidation: ConsolidationResult;
    if (isStepCompleted(checkpoint, 'dedup') && checkpoint.dedupOutput) {
      consolidation = JSON.parse(checkpoint.dedupOutput);
      debug('Resuming consolidation: skipping dedup (already completed)');
    } else {
      consolidation = await consolidateReports(instanceNumbers);
      checkpoint.dedupOutput = JSON.stringify(consolidation);
      checkpoint.completedSteps = [...checkpoint.completedSteps, 'dedup'];
      checkpoint.timestamp = new Date().toISOString();
      writeConsolidationCheckpoint(checkpoint);
    }

    // Step 2: Reassign IDs and remap screenshots
    // In append mode, determine the next available ID from the existing report
    let startId = 1;
    if (args.append) {
      const reportPath = join(workspace.outputDir, 'report.md');
      const existing = parseExistingReportIds(reportPath);
      if (!existing.success) {
        debug('Warning: existing report could not be parsed, starting IDs from 1');
      }
      startId = existing.maxId + 1;
      if (startId > 1) {
        debug(`Append mode: continuing IDs from UXR-${String(startId).padStart(3, '0')}`);
      }
    }

    let findings: ConsolidationResult['findings'];
    if (isStepCompleted(checkpoint, 'reassign') && checkpoint.reassignOutput) {
      findings = JSON.parse(checkpoint.reassignOutput);
      debug('Resuming consolidation: skipping reassign (already completed)');
    } else {
      const reassignResult = reassignAndRemapScreenshots(consolidation, workspace.outputDir, startId);
      findings = reassignResult.findings;
      checkpoint.reassignOutput = JSON.stringify(findings);
      checkpoint.completedSteps = [...checkpoint.completedSteps, 'reassign'];
      checkpoint.timestamp = new Date().toISOString();
      writeConsolidationCheckpoint(checkpoint);
    }

    // Step 3: Organize hierarchically
    let groups: UIAreaGroup[];
    if (isStepCompleted(checkpoint, 'hierarchy') && checkpoint.hierarchyOutput) {
      groups = JSON.parse(checkpoint.hierarchyOutput);
      debug('Resuming consolidation: skipping hierarchy (already completed)');
    } else {
      groups = await organizeHierarchically(findings);
      checkpoint.hierarchyOutput = JSON.stringify(groups);
      checkpoint.completedSteps = [...checkpoint.completedSteps, 'hierarchy'];
      checkpoint.timestamp = new Date().toISOString();
      writeConsolidationCheckpoint(checkpoint);
    }

    // Step 4: Format and write the consolidated report
    const reportPath = join(workspace.outputDir, 'report.md');
    if (isStepCompleted(checkpoint, 'format-report') && checkpoint.formatReportOutput) {
      debug('Resuming consolidation: skipping format-report (already completed)');
    } else {
      const reportContent = formatConsolidatedReport(groups);
      writeFileSync(reportPath, reportContent, 'utf-8');
      checkpoint.formatReportOutput = reportContent;
      checkpoint.completedSteps = [...checkpoint.completedSteps, 'format-report'];
      checkpoint.timestamp = new Date().toISOString();
      writeConsolidationCheckpoint(checkpoint);
    }

    // Step 5: Consolidate discovery docs
    const discoveryPath = join(workspace.outputDir, 'discovery.md');
    if (isStepCompleted(checkpoint, 'discovery-merge') && checkpoint.discoveryMergeOutput) {
      debug('Resuming consolidation: skipping discovery-merge (already completed)');
    } else {
      const discoveryResult = await consolidateDiscoveryDocs(instanceNumbers);
      checkpoint.discoveryMergeOutput = discoveryResult.content;
      checkpoint.completedSteps = [...checkpoint.completedSteps, 'discovery-merge'];
      checkpoint.timestamp = new Date().toISOString();
      writeConsolidationCheckpoint(checkpoint);
    }

    // Step 6: Write consolidated discovery
    if (!isStepCompleted(checkpoint, 'write-discovery')) {
      writeConsolidatedDiscovery(workspace.outputDir, checkpoint.discoveryMergeOutput ?? '');
      checkpoint.completedSteps = [...checkpoint.completedSteps, 'write-discovery'];
      checkpoint.timestamp = new Date().toISOString();
      writeConsolidationCheckpoint(checkpoint);
    } else {
      debug('Resuming consolidation: skipping write-discovery (already completed)');
    }

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
