#!/usr/bin/env node

import { parseArgs, detectSubcommand, parsePlanArgs } from './cli.js';
import { orchestrate, SignalInterruptError } from './orchestrator.js';
import { runPlanDiscovery, PlanSignalInterruptError } from './plan-orchestrator.js';

const argv = process.argv.slice(2);
const subcommand = detectSubcommand(argv);

if (subcommand === 'plan') {
  const args = parsePlanArgs(argv);

  runPlanDiscovery(args).catch((err) => {
    if (err instanceof PlanSignalInterruptError) {
      return;
    }
    console.error('Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  const args = parseArgs(argv);

  orchestrate(args).catch((err) => {
    if (err instanceof SignalInterruptError) {
      return;
    }
    console.error('Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
