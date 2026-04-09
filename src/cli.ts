import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { DEFAULT_SCOPE } from './default-scope.js';
import { MAX_RETRIES, INSTANCE_TIMEOUT_MS, MAX_RATE_LIMIT_RETRIES } from './config.js';

export interface ParsedArgs {
  url: string;
  intro: string;
  plan: string;
  scope: string;
  instances: number;
  rounds: number;
  output: string;
  keepTemp: boolean;
  append: boolean;
  dryRun: boolean;
  verbose: boolean;
  suppressOpen: boolean;
  maxRetries: number;
  instanceTimeout: number;
  rateLimitRetries: number;
}

const USAGE = `Usage:
  uxreview --url <url> --intro <text|filepath> --plan <text|filepath> [options]
  uxreview --show-default-scope

Required:
  --url <url>              URL of the web application to review
  --intro <text|filepath>  Introduction/context about the app (inline text or file path)
  --plan <text|filepath>   Review plan describing areas to review (inline text or file path)

Options:
  --scope <text|filepath>  Custom evaluation scope (inline text or file path)
                           Defaults to the built-in scope if not provided
  --show-default-scope     Print the built-in default evaluation scope and exit
  --instances <n>          Number of parallel Claude Code instances (default: auto,
                           based on areas in the plan, max 5)
  --rounds <n>             Number of review rounds per instance (default: 1)
  --output <dir>           Output directory for deliverables (default: ./uxreview-output)
  --keep-temp              Preserve the .uxreview-temp/ working directory after the run
                           (default: false — temp directory is deleted on completion)
  --append                 Append new findings to existing output directory instead of
                           overwriting (default: false — output directory is recreated)
  --dry-run                Preview work distribution without running instances. Shows
                           instance count, plan chunks, areas, and scope, then exits.
  --verbose                Enable debug logging to stderr
  --max-retries <n>        Maximum normal retry attempts per instance (default: 3)
  --instance-timeout <min> Timeout per Claude instance in minutes (default: 30)
  --rate-limit-retries <n> Maximum rate-limit retry attempts globally (default: 10)
  --suppress-open          Do not open the HTML report in the browser after completion
  --help                   Show this help message
  --version                Show the version number`;

/**
 * Resolve a CLI value that could be either a file path or inline text.
 * If the value is a path to an existing file, read and return its contents.
 * Otherwise, return the value as-is (inline text).
 */
const FILE_SIZE_WARN_THRESHOLD = 1 * 1024 * 1024;  // 1 MB
const FILE_SIZE_ERROR_THRESHOLD = 10 * 1024 * 1024; // 10 MB

export function resolveTextOrFile(value: string): string {
  const resolved = resolve(value);
  if (existsSync(resolved)) {
    const content = readFileSync(resolved, 'utf-8');
    const byteLength = Buffer.byteLength(content, 'utf-8');
    if (byteLength > FILE_SIZE_ERROR_THRESHOLD) {
      throw new Error(`File is too large (${(byteLength / 1024 / 1024).toFixed(1)}MB): ${resolved}. Maximum allowed size is 10MB.`);
    }
    if (byteLength > FILE_SIZE_WARN_THRESHOLD) {
      console.error(`Warning: File is large (${(byteLength / 1024 / 1024).toFixed(1)}MB): ${resolved}`);
    }
    return content;
  }
  return value;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPositiveInteger(value: string): boolean {
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
}

function printUsageAndExit(error?: string): never {
  if (error) {
    console.error(`Error: ${error}\n`);
  }
  console.log(USAGE);
  process.exit(error ? 1 : 0);
}

/**
 * Parse raw argv (process.argv.slice(2)) into a key-value map.
 */
function parseRawArgs(argv: string[]): Map<string, string | true> {
  const args = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      printUsageAndExit(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);

    // Boolean flags (no value)
    if (key === 'show-default-scope' || key === 'help' || key === 'version' || key === 'keep-temp' || key === 'append' || key === 'dry-run' || key === 'verbose' || key === 'suppress-open') {
      args.set(key, true);
      continue;
    }

    // All other flags require a value
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      printUsageAndExit(`Missing value for --${key}`);
    }
    args.set(key, next);
    i++; // skip value
  }

  return args;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const raw = parseRawArgs(argv);

  // Handle --help
  if (raw.has('help')) {
    printUsageAndExit();
  }

  // Handle --version
  if (raw.has('version')) {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    console.log(pkg.version);
    process.exit(0);
  }

  // Handle --show-default-scope
  if (raw.has('show-default-scope')) {
    console.log(DEFAULT_SCOPE);
    process.exit(0);
  }

  // Check for unknown flags
  const knownFlags = new Set(['url', 'intro', 'plan', 'scope', 'instances', 'rounds', 'output', 'keep-temp', 'append', 'dry-run', 'verbose', 'suppress-open', 'max-retries', 'instance-timeout', 'rate-limit-retries', 'version', 'help', 'show-default-scope']);
  for (const key of raw.keys()) {
    if (!knownFlags.has(key)) {
      printUsageAndExit(`Unknown option: --${key}`);
    }
  }

  // Validate required params
  const url = raw.get('url');
  if (!url || url === true) {
    printUsageAndExit('--url is required');
  }

  const intro = raw.get('intro');
  if (!intro || intro === true) {
    printUsageAndExit('--intro is required');
  }

  const plan = raw.get('plan');
  if (!plan || plan === true) {
    printUsageAndExit('--plan is required');
  }

  // Validate URL
  if (!isValidUrl(url)) {
    printUsageAndExit(`Invalid URL: ${url} (must be http:// or https://)`);
  }

  // Validate numeric params
  const instancesRaw = raw.get('instances');
  if (instancesRaw !== undefined && instancesRaw !== true) {
    if (!isPositiveInteger(instancesRaw)) {
      printUsageAndExit('--instances must be a positive integer');
    }
  }

  const roundsRaw = raw.get('rounds');
  if (roundsRaw !== undefined && roundsRaw !== true) {
    if (!isPositiveInteger(roundsRaw)) {
      printUsageAndExit('--rounds must be a positive integer');
    }
  }

  const maxRetriesRaw = raw.get('max-retries');
  if (maxRetriesRaw !== undefined && maxRetriesRaw !== true) {
    if (!isPositiveInteger(maxRetriesRaw)) {
      printUsageAndExit('--max-retries must be a positive integer');
    }
  }

  const instanceTimeoutRaw = raw.get('instance-timeout');
  if (instanceTimeoutRaw !== undefined && instanceTimeoutRaw !== true) {
    if (!isPositiveInteger(instanceTimeoutRaw)) {
      printUsageAndExit('--instance-timeout must be a positive integer');
    }
  }

  const rateLimitRetriesRaw = raw.get('rate-limit-retries');
  if (rateLimitRetriesRaw !== undefined && rateLimitRetriesRaw !== true) {
    if (!isPositiveInteger(rateLimitRetriesRaw)) {
      printUsageAndExit('--rate-limit-retries must be a positive integer');
    }
  }

  // Resolve text-or-file params
  const resolvedIntro = resolveTextOrFile(intro);
  const resolvedPlan = resolveTextOrFile(plan);

  const scopeRaw = raw.get('scope');
  const resolvedScope = (scopeRaw && scopeRaw !== true)
    ? resolveTextOrFile(scopeRaw)
    : DEFAULT_SCOPE;

  return {
    url,
    intro: resolvedIntro,
    plan: resolvedPlan,
    scope: resolvedScope,
    instances: instancesRaw !== undefined && instancesRaw !== true ? Number(instancesRaw) : 0,
    rounds: roundsRaw !== undefined && roundsRaw !== true ? Number(roundsRaw) : 1,
    output: (() => {
      const outputRaw = raw.get('output');
      return typeof outputRaw === 'string' ? outputRaw : './uxreview-output';
    })(),
    keepTemp: raw.has('keep-temp'),
    append: raw.has('append'),
    dryRun: raw.has('dry-run'),
    verbose: raw.has('verbose'),
    suppressOpen: raw.has('suppress-open'),
    maxRetries: maxRetriesRaw !== undefined && maxRetriesRaw !== true ? Number(maxRetriesRaw) : MAX_RETRIES,
    instanceTimeout: instanceTimeoutRaw !== undefined && instanceTimeoutRaw !== true ? Number(instanceTimeoutRaw) : INSTANCE_TIMEOUT_MS / 60_000,
    rateLimitRetries: rateLimitRetriesRaw !== undefined && rateLimitRetriesRaw !== true ? Number(rateLimitRetriesRaw) : MAX_RATE_LIMIT_RETRIES,
  };
}
