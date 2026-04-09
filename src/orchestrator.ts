import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { exec } from 'node:child_process';
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
  parseConsolidatedReport,
  detectCrossRunDuplicates,
  filterCrossRunDuplicates,
  groupFindingsByArea,
  ConsolidationResult,
  UIAreaGroup,
  Finding,
} from './consolidation.js';
import { ProgressDisplay } from './progress-display.js';
import { formatHtmlReport, ReportMetadata } from './html-report.js';
import { setVerbose, debug } from './logger.js';
import { MAX_AUTO_INSTANCES } from './config.js';
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
 * Error thrown when the orchestrator is interrupted by a signal (SIGINT/SIGTERM).
 * Allows callers to distinguish signal interruptions from other errors.
 */
export class SignalInterruptError extends Error {
  constructor(signal: string) {
    super(`Process interrupted by ${signal}`);
    this.name = 'SignalInterruptError';
  }
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

  // 0. Auto-detect instance count from plan areas if not specified
  if (args.instances === 0) {
    const areas = extractAreasFromPlanChunk(args.plan);
    args.instances = Math.max(1, Math.min(areas.length, MAX_AUTO_INSTANCES));
    debug(`Auto-detected ${areas.length} area(s) in plan, using ${args.instances} instance(s)`);
  }

  // 1. Initialize workspace
  const workspace = await initWorkspace(args.instances, args.output, args.append);

  // 2. Set up progress display
  const instanceNumbers = Array.from({ length: args.instances }, (_, i) => i + 1);
  const display = new ProgressDisplay(instanceNumbers, args.rounds);
  const progressCallback = buildProgressCallback(display);

  // Flag-based signal handling: instead of process.exit(), set a flag and
  // reject a promise so the try block unwinds and the finally block runs cleanup.
  let signalReceived = false;
  let rejectOnSignal: ((err: SignalInterruptError) => void) | undefined;
  const signalPromise = new Promise<never>((_, reject) => {
    rejectOnSignal = reject;
  });
  // Prevent unhandled rejection if signal fires between raceSignal calls
  signalPromise.catch(() => {});

  function raceSignal<T>(promise: Promise<T>): Promise<T> {
    if (signalReceived) {
      return Promise.reject(new SignalInterruptError('signal'));
    }
    return Promise.race([promise, signalPromise]);
  }

  const signalHandler = (signal: NodeJS.Signals) => {
    if (signalReceived) return;
    signalReceived = true;
    killAllChildProcesses();
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    if (rejectOnSignal) {
      rejectOnSignal(new SignalInterruptError(signal));
    }
  };
  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  display.start();

  try {
    // 3. Distribute work across instances
    const distributionStart = Date.now();
    const distribution = await raceSignal(distributePlan(args.plan, args.instances));
    debug(`Distribution phase completed in ${Date.now() - distributionStart}ms`);

    // 3a. Dry-run mode: print distribution info and exit
    if (args.dryRun) {
      display.stop();
      console.log('=== Dry Run ===\n');
      console.log(`Instances: ${args.instances}`);
      console.log(`Rounds per instance: ${args.rounds}`);
      console.log(`Total rounds: ${args.instances * args.rounds}\n`);

      for (let i = 0; i < distribution.chunks.length; i++) {
        const chunk = distribution.chunks[i];
        const areas = extractAreasFromPlanChunk(chunk);
        console.log(`--- Instance ${i + 1} ---`);
        console.log(`Areas: ${areas.join(', ')}`);
        console.log(`Plan chunk:\n${chunk}\n`);
      }

      console.log('--- Evaluation Scope ---');
      console.log(args.scope);
      console.log('\nNote: Actual API cost and duration depend on app complexity.');
      return;
    }

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
    const settled = await raceSignal(Promise.allSettled(
      configs.map((config) => runInstanceRounds(config)),
    ));
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

    // 5. Output phase
    const consolidationStart = Date.now();
    const mdReportPath = join(workspace.outputDir, 'report.md');
    const htmlReportPath = join(workspace.outputDir, 'report.html');
    const reportPath = htmlReportPath;
    const discoveryPath = join(workspace.outputDir, 'discovery.md');
    let findings: Finding[];

    if (args.instances === 1 && !args.append) {
      // Single instance, non-append: skip consolidation Claude calls entirely.
      // Just read the instance output, reassign IDs, format reports, copy files.
      debug('Single instance: skipping consolidation, copying output directly');

      const consolidation = await raceSignal(consolidateReports(instanceNumbers));
      const reassignResult = reassignAndRemapScreenshots(
        consolidation, workspace.outputDir, 1, false,
      );
      findings = reassignResult.findings;

      // Group by area with flat hierarchy (no Claude call)
      const areaMap = groupFindingsByArea(findings);
      const groups: UIAreaGroup[] = [];
      for (const [area, areaFindings] of areaMap) {
        groups.push({ area, findings: areaFindings.map(f => ({ finding: f, children: [] })) });
      }

      // Write reports
      writeFileSync(mdReportPath, formatConsolidatedReport(groups), 'utf-8');
      const metadata: ReportMetadata = {
        url: args.url,
        date: new Date().toISOString().split('T')[0],
        instanceCount: args.instances,
        roundCount: args.rounds,
      };
      writeFileSync(htmlReportPath, formatHtmlReport(groups, metadata, join(workspace.outputDir, 'screenshots')), 'utf-8');

      // Copy discovery doc
      writeConsolidatedDiscovery(workspace.outputDir,
        (await raceSignal(consolidateDiscoveryDocs(instanceNumbers))).content);
    } else {
      // Multi-instance or append mode: full consolidation with checkpointing
      display.startConsolidation();

      // Read existing consolidation checkpoint (for resume)
      let checkpoint: ConsolidationCheckpoint =
        readConsolidationCheckpoint() ?? createEmptyConsolidationCheckpoint();

      // Step 1: Dedup — consolidate reports (within-run dedup)
      let consolidation: ConsolidationResult;
      if (isStepCompleted(checkpoint, 'dedup') && checkpoint.dedupOutput) {
        consolidation = checkpoint.dedupOutput;
        debug('Resuming consolidation: skipping dedup (already completed)');
      } else {
        consolidation = await raceSignal(consolidateReports(instanceNumbers));

        // In append mode, run cross-run deduplication against existing findings
        if (args.append) {
          const reportPath = join(workspace.outputDir, 'report.md');
          if (existsSync(reportPath)) {
            const existingContent = readFileSync(reportPath, 'utf-8');
            const existingFindings = parseConsolidatedReport(existingContent);
            if (existingFindings.length > 0) {
              debug(`Append mode: cross-run dedup against ${existingFindings.length} existing finding(s)`);
              const crossRunDedup = await raceSignal(detectCrossRunDuplicates(existingFindings, consolidation.findings));
              if (crossRunDedup.duplicateGroups.length > 0) {
                const filtered = filterCrossRunDuplicates(
                  existingFindings,
                  consolidation.findings,
                  crossRunDedup.duplicateGroups,
                );
                const removedCount = consolidation.findings.length - filtered.length;
                debug(`Cross-run dedup removed ${removedCount} duplicate(s)`);
                consolidation = { ...consolidation, findings: filtered };
              }
            }
          }
        }

        checkpoint.dedupOutput = consolidation;
        checkpoint.completedSteps = [...checkpoint.completedSteps, 'dedup'];
        checkpoint.timestamp = new Date().toISOString();
        writeConsolidationCheckpoint(checkpoint);
      }

      // Step 2: Reassign IDs and remap screenshots
      // In append mode, determine the next available ID from the existing report
      let startId = 1;
      let existingFindings: Finding[] = [];
      if (args.append) {
        const existingReportPath = join(workspace.outputDir, 'report.md');
        const existing = parseExistingReportIds(existingReportPath);
        if (!existing.success) {
          debug('Warning: existing report could not be parsed, starting IDs from 1');
        }
        startId = existing.maxId + 1;
        if (startId > 1) {
          debug(`Append mode: continuing IDs from UXR-${String(startId).padStart(3, '0')}`);
          // Parse existing findings for merging into the full report
          if (existsSync(existingReportPath)) {
            existingFindings = parseConsolidatedReport(readFileSync(existingReportPath, 'utf-8'));
          }
        }
      }

      if (isStepCompleted(checkpoint, 'reassign') && checkpoint.reassignOutput) {
        findings = checkpoint.reassignOutput;
        debug('Resuming consolidation: skipping reassign (already completed)');
      } else {
        const reassignResult = reassignAndRemapScreenshots(
          consolidation, workspace.outputDir, startId, args.append,
        );
        // In append mode, combine existing findings with newly assigned ones
        findings = args.append
          ? [...existingFindings, ...reassignResult.findings]
          : reassignResult.findings;
        checkpoint.reassignOutput = findings;
        checkpoint.completedSteps = [...checkpoint.completedSteps, 'reassign'];
        checkpoint.timestamp = new Date().toISOString();
        writeConsolidationCheckpoint(checkpoint);
      }

      // Step 3: Organize hierarchically (all findings: existing + new)
      let groups: UIAreaGroup[];
      if (isStepCompleted(checkpoint, 'hierarchy') && checkpoint.hierarchyOutput) {
        groups = checkpoint.hierarchyOutput;
        debug('Resuming consolidation: skipping hierarchy (already completed)');
      } else {
        groups = await raceSignal(organizeHierarchically(findings));
        checkpoint.hierarchyOutput = groups;
        checkpoint.completedSteps = [...checkpoint.completedSteps, 'hierarchy'];
        checkpoint.timestamp = new Date().toISOString();
        writeConsolidationCheckpoint(checkpoint);
      }

      // Step 4: Format and write both markdown and HTML reports
      if (isStepCompleted(checkpoint, 'format-report') && checkpoint.formatReportOutput) {
        debug('Resuming consolidation: skipping format-report (already completed)');
      } else {
        writeFileSync(mdReportPath, formatConsolidatedReport(groups), 'utf-8');

        const metadata: ReportMetadata = {
          url: args.url,
          date: new Date().toISOString().split('T')[0],
          instanceCount: args.instances,
          roundCount: args.rounds,
        };
        const screenshotsDir = join(workspace.outputDir, 'screenshots');
        const htmlContent = formatHtmlReport(groups, metadata, screenshotsDir);
        writeFileSync(htmlReportPath, htmlContent, 'utf-8');

        checkpoint.formatReportOutput = htmlContent;
        checkpoint.completedSteps = [...checkpoint.completedSteps, 'format-report'];
        checkpoint.timestamp = new Date().toISOString();
        writeConsolidationCheckpoint(checkpoint);
      }

      // Step 5: Consolidate discovery docs
      if (isStepCompleted(checkpoint, 'discovery-merge') && checkpoint.discoveryMergeOutput) {
        debug('Resuming consolidation: skipping discovery-merge (already completed)');
      } else {
        const discoveryResult = await raceSignal(consolidateDiscoveryDocs(instanceNumbers));
        // In append mode, merge with existing discovery document
        let mergedDiscovery = discoveryResult.content;
        if (args.append && existsSync(discoveryPath)) {
          const existingDiscovery = readFileSync(discoveryPath, 'utf-8').trim();
          if (existingDiscovery && mergedDiscovery) {
            debug('Append mode: merging new discovery with existing discovery document');
            mergedDiscovery = existingDiscovery + '\n\n' + mergedDiscovery;
          } else if (existingDiscovery && !mergedDiscovery) {
            mergedDiscovery = existingDiscovery;
          }
        }
        checkpoint.discoveryMergeOutput = mergedDiscovery;
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
    }

    const consolidationDurationMs = Date.now() - consolidationStart;
    const executionDurationMs = consolidationStart - executionStart;
    debug(`Consolidation phase completed in ${consolidationDurationMs}ms`);

    // 6. Show final output paths and summary
    display.completeConsolidation(reportPath, discoveryPath);
    display.stop();

    const formatDuration = (ms: number): string => {
      const totalSec = Math.round(ms / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    };

    console.log('');
    console.log(`  Findings:      ${findings.length}`);
    console.log(`  Execution:     ${formatDuration(executionDurationMs)}`);
    console.log(`  Consolidation: ${formatDuration(consolidationDurationMs)}`);
    console.log('');
    console.log('  Tip: The discovery document can be reused as the --intro for future');
    console.log('  runs to give the reviewer a head start on understanding the app.');

    // Open the HTML report in the default browser
    if (!args.suppressOpen) {
      const openCmd = process.platform === 'win32' ? `start "" "${reportPath}"`
        : process.platform === 'darwin' ? `open "${reportPath}"`
        : `xdg-open "${reportPath}"`;
      exec(openCmd, (err) => {
        if (err) debug(`Failed to open report in browser: ${err.message}`);
      });
    }
  } finally {
    process.removeListener('SIGINT', signalHandler);
    process.removeListener('SIGTERM', signalHandler);
    display.stop();
    if (!args.keepTemp) {
      await cleanupTempDir();
    }
  }
}
