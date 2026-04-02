#!/usr/bin/env node

import { parseArgs } from './cli.js';
import { orchestrate } from './orchestrator.js';

const args = parseArgs(process.argv.slice(2));

orchestrate(args).catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
