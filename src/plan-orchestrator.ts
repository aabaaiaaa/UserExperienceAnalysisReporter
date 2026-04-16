import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ParsedPlanArgs } from './cli.js';
import { initWorkspace, cleanupTempDir, getInstancePaths } from './file-manager.js';
import { distributePlan } from './work-distribution.js';
import {
  buildDiscoveryPrompt,
  runInstanceRounds,
  RoundExecutionConfig,
  RoundExecutionResult,
} from './instance-manager/index.js';
import {
  consolidateDiscoveryDocs,
  writeConsolidatedDiscovery,
  generatePlanTemplate,
} from './consolidation/index.js';
import { ProgressDisplay, formatDuration } from './progress-display.js';
import { buildProgressCallback } from './progress-callbacks.js';
import { formatDiscoveryHtml, DiscoveryMetadata } from './discovery-html.js';
import { openInBrowser } from './browser-open.js';
import { setVerbose, debug } from './logger.js';
import { createSignalManager } from './signal-handler.js';
import { extractAreasFromPlanChunk } from './orchestrator.js';

/**
 * Error thrown when the plan orchestrator is interrupted by a signal (SIGINT/SIGTERM).
 * Allows callers to distinguish signal interruptions from other errors.
 */
export class PlanSignalInterruptError extends Error {
  constructor(signal: string) {
    super(`Process interrupted by ${signal}`);
    this.name = 'PlanSignalInterruptError';
  }
}

/**
 * Copy screenshots from all instance temp dirs to the output screenshots directory.
 *
 * Each instance stores screenshots in `.uxreview-temp/instance-N/screenshots/`.
 * This function reads valid screenshot filenames from each instance directory
 * and copies them to `outputDir/screenshots/`.
 */
function copyScreenshotsToOutput(instanceNumbers: number[], outputDir: string): number {
  const outputScreenshotsDir = join(outputDir, 'screenshots');
  mkdirSync(outputScreenshotsDir, { recursive: true });

  let totalCopied = 0;

  for (const instanceNumber of instanceNumbers) {
    const paths = getInstancePaths(instanceNumber);
    const srcDir = paths.screenshots;

    if (!existsSync(srcDir)) {
      continue;
    }

    try {
      const files = readdirSync(srcDir).filter((f) => /\.png$/i.test(f));
      for (const file of files) {
        const srcPath = join(srcDir, file);
        const destPath = join(outputScreenshotsDir, file);
        copyFileSync(srcPath, destPath);
        totalCopied++;
      }
    } catch (err) {
      debug(`Failed to copy screenshots from instance ${instanceNumber}: ${err}`);
    }
  }

  return totalCopied;
}

/**
 * Run the plan discovery orchestration flow:
 *
 * 1. Initialize workspace (temp + output directories)
 * 2. Distribute plan across instances (if plan provided and instances > 1)
 * 3. Start progress display
 * 4. Spawn all instances with discovery-only prompt
 * 5. After all complete, consolidate discovery docs
 * 6. Generate plan template from consolidated discovery
 * 7. Generate discovery HTML report
 * 8. Copy screenshots to output directory
 * 9. Write plan.md and discovery.html to output directory
 * 10. Open discovery.html unless --suppress-open
 * 11. Cleanup temp unless --keep-temp
 */
export async function runPlanDiscovery(args: ParsedPlanArgs): Promise<void> {
  // Enable verbose logging if requested
  setVerbose(args.verbose);

  // 1. Initialize workspace
  // cleanExisting: false — the plan subcommand only writes a small fixed set of files
  // (plan.md, discovery.html, discovery.md, screenshots/). mkdirSync is idempotent and
  // writeFileSync overwrites in place, so wiping the output directory is unnecessary and
  // dangerous (see requirements.md Part A and the A3 safety guard).
  const workspace = await initWorkspace(args.instances, args.output, false);

  // 2. Set up progress display
  const instanceNumbers = Array.from({ length: args.instances }, (_, i) => i + 1);
  const display = new ProgressDisplay(instanceNumbers, args.rounds);
  const progressCallback = buildProgressCallback(display);

  const signals = createSignalManager(PlanSignalInterruptError);

  display.start();

  try {
    // 3. Distribute work across instances (if plan provided)
    let chunks: string[];
    if (args.plan.trim().length > 0 && args.instances > 1) {
      const distributionStart = Date.now();
      const distribution = await signals.raceSignal(distributePlan(args.plan, args.instances));
      chunks = distribution.chunks;
      debug(`Distribution phase completed in ${Date.now() - distributionStart}ms`);
    } else {
      // Single instance or no plan: one chunk per instance
      chunks = Array.from({ length: args.instances }, () => args.plan);
    }

    // 3a. Dry-run mode: print config info and exit
    if (args.dryRun) {
      display.stop();
      console.log('=== Dry Run (Plan Discovery) ===\n');
      console.log(`URL: ${args.url}`);
      console.log(`Instances: ${args.instances}`);
      console.log(`Rounds per instance: ${args.rounds}`);
      console.log(`Total rounds: ${args.instances * args.rounds}`);
      console.log(`Output: ${args.output}\n`);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const areas = chunk.trim().length > 0
          ? extractAreasFromPlanChunk(chunk)
          : ['Free exploration'];
        console.log(`--- Instance ${i + 1} ---`);
        console.log(`Areas: ${areas.join(', ')}`);
        if (chunk.trim().length > 0) {
          console.log(`Plan chunk:\n${chunk}\n`);
        } else {
          console.log('(No plan — free exploration)\n');
        }
      }

      if (args.scope.trim().length > 0) {
        console.log('--- Exploration Scope ---');
        console.log(args.scope);
      }
      console.log('\nNote: Actual API cost and duration depend on app complexity.');
      return;
    }

    // 4. Spawn all instances with discovery-only prompt
    const configs: RoundExecutionConfig[] = chunks.map((chunk, i) => ({
      instanceNumber: i + 1,
      url: args.url,
      intro: args.intro,
      planChunk: chunk,
      scope: args.scope,
      totalRounds: args.rounds,
      assignedAreas: chunk.trim().length > 0
        ? extractAreasFromPlanChunk(chunk)
        : ['Full exploration'],
      progress: progressCallback,
      promptBuilder: buildDiscoveryPrompt,
    }));

    debug(`Spawning ${configs.length} instance(s) for ${args.rounds} round(s) of discovery`);
    const executionStart = Date.now();
    const settled = await signals.raceSignal(Promise.allSettled(
      configs.map((config) => runInstanceRounds(config)),
    ));
    const executionDurationMs = Date.now() - executionStart;
    debug(`Instance execution phase completed in ${executionDurationMs}ms`);

    // Process results — mark any unexpected rejections as permanently failed
    const results: RoundExecutionResult[] = settled.map((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }
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

    // 4a. Check if any instance succeeded
    const anySucceeded = results.some(r => r.status === 'completed');
    if (!anySucceeded) {
      display.stop();
      console.error('\nAll discovery instances failed — no output generated.');
      console.error('Check --verbose output for details, or retry with fewer instances.\n');
      process.exitCode = 1;
      return;
    }

    // 5. Consolidation phase
    const consolidationStart = Date.now();

    // 5a. Consolidate discovery documents
    const discoveryResult = await signals.raceSignal(consolidateDiscoveryDocs(instanceNumbers));
    debug(`Discovery consolidation complete: ${discoveryResult.instanceCount} doc(s), usedClaude=${discoveryResult.usedClaude}`);

    // 5b. Generate plan template from consolidated discovery
    const planContent = await signals.raceSignal(generatePlanTemplate(discoveryResult.content));
    debug('Plan template generation complete');

    // 5c. Copy screenshots to output directory
    const screenshotsCopied = copyScreenshotsToOutput(instanceNumbers, workspace.outputDir);
    debug(`Copied ${screenshotsCopied} screenshot(s) to output directory`);

    // 5d. Generate discovery HTML
    const metadata: DiscoveryMetadata = {
      url: args.url,
      date: new Date().toISOString().split('T')[0],
      instanceCount: args.instances,
      roundCount: args.rounds,
    };
    const screenshotsDir = join(workspace.outputDir, 'screenshots');
    const discoveryHtml = formatDiscoveryHtml(discoveryResult.content, metadata, screenshotsDir);

    const consolidationDurationMs = Date.now() - consolidationStart;
    debug(`Consolidation phase completed in ${consolidationDurationMs}ms`);

    // 6. Write output files
    const planPath = join(workspace.outputDir, 'plan.md');
    const discoveryHtmlPath = join(workspace.outputDir, 'discovery.html');
    const discoveryMdPath = join(workspace.outputDir, 'discovery.md');

    writeFileSync(planPath, planContent + '\n', 'utf-8');
    writeFileSync(discoveryHtmlPath, discoveryHtml, 'utf-8');
    writeConsolidatedDiscovery(workspace.outputDir, discoveryResult.content);

    // 7. Show final output paths and summary
    display.stop();

    console.log('');
    console.log('  Plan discovery complete!');
    console.log('');
    console.log(`  Plan template:  ${planPath}`);
    console.log(`  Discovery HTML: ${discoveryHtmlPath}`);
    console.log(`  Discovery MD:   ${discoveryMdPath}`);
    console.log(`  Screenshots:    ${screenshotsCopied}`);
    console.log('');
    console.log(`  Execution:     ${formatDuration(executionDurationMs)}`);
    console.log(`  Consolidation: ${formatDuration(consolidationDurationMs)}`);
    console.log('');
    console.log('  Tip: Edit plan.md to refine the review areas, then run:');
    console.log(`  uxreview --url ${args.url} --plan ${planPath}`);

    // 8. Open discovery.html in the default browser
    if (!args.suppressOpen) {
      openInBrowser(discoveryHtmlPath);
    }
  } finally {
    signals.cleanup();
    display.stop();
    if (!args.keepTemp) {
      await cleanupTempDir();
    }
  }
}
