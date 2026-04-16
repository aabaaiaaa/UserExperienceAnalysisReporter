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

export interface ParsedPlanArgs {
  url: string;
  intro: string;
  plan: string;
  scope: string;
  instances: number;
  rounds: number;
  output: string;
  keepTemp: boolean;
  dryRun: boolean;
  verbose: boolean;
  suppressOpen: boolean;
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

const PLAN_USAGE = `Usage:
  uxreview plan --url <url> [options]

Required:
  --url <url>              URL of the web application to analyze

Options:
  --intro <text|filepath>  Introduction/context about the app (inline text or file path)
  --plan <text|filepath>   Broad exploration areas to focus on (inline text or file path)
  --scope <text|filepath>  Custom evaluation scope (inline text or file path)
                           Defaults to the built-in scope if not provided
  --instances <n>          Number of parallel Claude Code instances (default: 1)
                           Requires --plan when > 1 to distribute work across instances
  --rounds <n>             Number of review rounds per instance (default: 1)
  --output <dir>           Output directory for deliverables (default: ./uxreview-plan)
  --keep-temp              Preserve the .uxreview-temp/ working directory after the run
  --dry-run                Preview work distribution without running instances
  --verbose                Enable debug logging to stderr
  --suppress-open          Do not open the HTML report in the browser after completion
  --help                   Show this help message`;

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

const MAIN_BOOLEAN_FLAGS = new Set(['show-default-scope', 'help', 'version', 'keep-temp', 'append', 'dry-run', 'verbose', 'suppress-open']);
const PLAN_BOOLEAN_FLAGS = new Set(['help', 'keep-temp', 'dry-run', 'verbose', 'suppress-open', 'append']);

function parseRawArgv(
  argv: string[],
  booleanFlags: Set<string>,
  onError: (msg: string) => never,
): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      onError(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (booleanFlags.has(key)) {
      args.set(key, true);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      onError(`Missing value for --${key}`);
    }
    args.set(key, next);
    i++;
  }
  return args;
}

/**
 * Parse raw argv (process.argv.slice(2)) into a key-value map.
 */
function parseRawArgs(argv: string[]): Map<string, string | true> {
  return parseRawArgv(argv, MAIN_BOOLEAN_FLAGS, printUsageAndExit);
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

/**
 * Detect whether the first positional argument is a known subcommand.
 * Returns the subcommand name or null if none is found.
 */
export function detectSubcommand(argv: string[]): 'plan' | null {
  if (argv.length > 0 && !argv[0].startsWith('--') && argv[0] === 'plan') {
    return 'plan';
  }
  return null;
}

function printPlanUsageAndExit(error?: string): never {
  if (error) {
    console.error(`Error: ${error}\n`);
  }
  console.log(PLAN_USAGE);
  process.exit(error ? 1 : 0);
}

/**
 * Parse raw argv for the plan subcommand (argv should NOT include the 'plan' word).
 */
function parsePlanRawArgs(argv: string[]): Map<string, string | true> {
  return parseRawArgv(argv, PLAN_BOOLEAN_FLAGS, printPlanUsageAndExit);
}

export function parsePlanArgs(argv: string[]): ParsedPlanArgs {
  // Strip 'plan' subcommand if present at the start
  const args = argv[0] === 'plan' ? argv.slice(1) : argv;
  const raw = parsePlanRawArgs(args);

  // Handle --help
  if (raw.has('help')) {
    printPlanUsageAndExit();
  }

  // Known flags for the plan subcommand
  const planKnownFlags = new Set(['url', 'intro', 'plan', 'scope', 'instances', 'rounds', 'output', 'keep-temp', 'dry-run', 'verbose', 'suppress-open', 'help', 'append', 'max-retries', 'instance-timeout', 'rate-limit-retries']);

  // Check for unknown flags
  for (const key of raw.keys()) {
    if (!planKnownFlags.has(key)) {
      printPlanUsageAndExit(`Unknown option: --${key}`);
    }
  }

  // Warn about flags not applicable to the plan subcommand
  if (raw.has('append')) {
    console.error('Warning: --append is not applicable to the plan subcommand and will be ignored');
  }
  if (raw.has('max-retries')) {
    console.error('Warning: --max-retries is not applicable to the plan subcommand and will be ignored');
  }
  if (raw.has('instance-timeout')) {
    console.error('Warning: --instance-timeout is not applicable to the plan subcommand and will be ignored');
  }
  if (raw.has('rate-limit-retries')) {
    console.error('Warning: --rate-limit-retries is not applicable to the plan subcommand and will be ignored');
  }

  // Validate required params
  const url = raw.get('url');
  if (!url || url === true) {
    printPlanUsageAndExit('--url is required');
  }

  // Validate URL
  if (!isValidUrl(url)) {
    printPlanUsageAndExit(`Invalid URL: ${url} (must be http:// or https://)`);
  }

  // Validate numeric params
  const instancesRaw = raw.get('instances');
  if (instancesRaw !== undefined && instancesRaw !== true) {
    if (!isPositiveInteger(instancesRaw)) {
      printPlanUsageAndExit('--instances must be a positive integer');
    }
  }

  const roundsRaw = raw.get('rounds');
  if (roundsRaw !== undefined && roundsRaw !== true) {
    if (!isPositiveInteger(roundsRaw)) {
      printPlanUsageAndExit('--rounds must be a positive integer');
    }
  }

  // Resolve text-or-file params
  const introRaw = raw.get('intro');
  const resolvedIntro = (introRaw && introRaw !== true) ? resolveTextOrFile(introRaw) : '';

  const planRaw = raw.get('plan');
  const resolvedPlan = (planRaw && planRaw !== true) ? resolveTextOrFile(planRaw) : '';

  const scopeRaw = raw.get('scope');
  const resolvedScope = (scopeRaw && scopeRaw !== true)
    ? resolveTextOrFile(scopeRaw)
    : DEFAULT_SCOPE;

  // Determine instances — default 1, but warn and fall back to 1 if > 1 without --plan
  let instances = instancesRaw !== undefined && instancesRaw !== true ? Number(instancesRaw) : 1;
  if (instances > 1 && !resolvedPlan) {
    console.error('Warning: --instances > 1 requires --plan to distribute work; falling back to 1 instance');
    instances = 1;
  }

  return {
    url,
    intro: resolvedIntro,
    plan: resolvedPlan,
    scope: resolvedScope,
    instances,
    rounds: roundsRaw !== undefined && roundsRaw !== true ? Number(roundsRaw) : 1,
    output: (() => {
      const outputRaw = raw.get('output');
      return typeof outputRaw === 'string' ? outputRaw : './uxreview-plan';
    })(),
    keepTemp: raw.has('keep-temp'),
    dryRun: raw.has('dry-run'),
    verbose: raw.has('verbose'),
    suppressOpen: raw.has('suppress-open'),
  };
}
