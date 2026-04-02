#!/usr/bin/env node

import { parseArgs } from './cli.js';

const args = parseArgs(process.argv.slice(2));

console.log('Parsed arguments:');
console.log(JSON.stringify(args, null, 2));
