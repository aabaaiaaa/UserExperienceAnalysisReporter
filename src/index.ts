#!/usr/bin/env node

import { parseArgs, detectSubcommand, parsePlanArgs } from './cli.js';
import { orchestrate } from './orchestrator.js';
import { runPlanDiscovery } from './plan-orchestrator.js';

const argv = process.argv.slice(2);
const subcommand = detectSubcommand(argv);

if (subcommand === 'plan') {
  const args = parsePlanArgs(argv);

  runPlanDiscovery(args).catch((err) => {
    console.error('Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  const args = parseArgs(argv);

  orchestrate(args).catch((err) => {
    console.error('Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
