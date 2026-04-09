import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, resolveTextOrFile, detectSubcommand, parsePlanArgs } from '../src/cli.js';
import { DEFAULT_SCOPE } from '../src/default-scope.js';

describe('cli parseArgs', () => {
  // Suppress process.exit calls during tests
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as never);

  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const requiredArgs = [
    '--url', 'https://example.com',
    '--intro', 'Test intro text',
    '--plan', 'Test plan text',
  ];

  it('uses default output directory when --output is omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.output).toBe('./uxreview-output');
  });

  it('uses provided output directory when --output is specified', () => {
    const result = parseArgs([...requiredArgs, '--output', './custom-output']);
    expect(result.output).toBe('./custom-output');
  });

  it('defaults instances to 0 (auto) when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.instances).toBe(0);
  });

  it('defaults rounds to 1 when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.rounds).toBe(1);
  });

  it('defaults keepTemp to false when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.keepTemp).toBe(false);
  });

  it('sets keepTemp to true when --keep-temp is provided', () => {
    const result = parseArgs([...requiredArgs, '--keep-temp']);
    expect(result.keepTemp).toBe(true);
  });

  // --append
  it('defaults append to false when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.append).toBe(false);
  });

  it('sets append to true when --append is provided', () => {
    const result = parseArgs([...requiredArgs, '--append']);
    expect(result.append).toBe(true);
  });

  // --dry-run
  it('defaults dryRun to false when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.dryRun).toBe(false);
  });

  it('sets dryRun to true when --dry-run is provided', () => {
    const result = parseArgs([...requiredArgs, '--dry-run']);
    expect(result.dryRun).toBe(true);
  });

  // --verbose
  it('defaults verbose to false when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.verbose).toBe(false);
  });

  it('sets verbose to true when --verbose is provided', () => {
    const result = parseArgs([...requiredArgs, '--verbose']);
    expect(result.verbose).toBe(true);
  });

  // --max-retries
  it('defaults maxRetries to 3 when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.maxRetries).toBe(3);
  });

  it('accepts a custom --max-retries value', () => {
    const result = parseArgs([...requiredArgs, '--max-retries', '5']);
    expect(result.maxRetries).toBe(5);
  });

  it('rejects non-positive --max-retries', () => {
    expect(() => parseArgs([...requiredArgs, '--max-retries', '0'])).toThrow();
    expect(() => parseArgs([...requiredArgs, '--max-retries', '-1'])).toThrow();
    expect(() => parseArgs([...requiredArgs, '--max-retries', 'abc'])).toThrow();
  });

  // --instance-timeout
  it('defaults instanceTimeout to 30 when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.instanceTimeout).toBe(30);
  });

  it('accepts a custom --instance-timeout value', () => {
    const result = parseArgs([...requiredArgs, '--instance-timeout', '60']);
    expect(result.instanceTimeout).toBe(60);
  });

  it('rejects non-positive --instance-timeout', () => {
    expect(() => parseArgs([...requiredArgs, '--instance-timeout', '0'])).toThrow();
    expect(() => parseArgs([...requiredArgs, '--instance-timeout', '-5'])).toThrow();
    expect(() => parseArgs([...requiredArgs, '--instance-timeout', 'xyz'])).toThrow();
  });

  // --rate-limit-retries
  it('defaults rateLimitRetries to 10 when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.rateLimitRetries).toBe(10);
  });

  it('accepts a custom --rate-limit-retries value', () => {
    const result = parseArgs([...requiredArgs, '--rate-limit-retries', '20']);
    expect(result.rateLimitRetries).toBe(20);
  });

  it('rejects non-positive --rate-limit-retries', () => {
    expect(() => parseArgs([...requiredArgs, '--rate-limit-retries', '0'])).toThrow();
    expect(() => parseArgs([...requiredArgs, '--rate-limit-retries', '-2'])).toThrow();
    expect(() => parseArgs([...requiredArgs, '--rate-limit-retries', 'nope'])).toThrow();
  });
});

describe('cli --version flag', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the version from package.json and exits', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    expect(() => parseArgs(['--version'])).toThrow('process.exit called');
    expect(consoleSpy).toHaveBeenCalledWith(pkg.version);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('includes --version in the usage text', () => {
    expect(() => parseArgs(['--help'])).toThrow('process.exit called');
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('--version');
    expect(output).toContain('Show the version number');
  });
});

describe('resolveTextOrFile file size validation', () => {
  const testDir = join(process.cwd(), '.uxreview-temp-cli-size-test');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns inline text without size check', () => {
    // A string that is not a file path should pass through without any size validation
    const longText = 'x'.repeat(20 * 1024 * 1024); // 20MB inline text
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = resolveTextOrFile(longText);
    expect(result).toBe(longText);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('reads small files without warning', () => {
    const filePath = join(testDir, 'small.txt');
    writeFileSync(filePath, 'small content');
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = resolveTextOrFile(filePath);
    expect(result).toBe('small content');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('warns to stderr for files larger than 1MB', () => {
    const filePath = join(testDir, 'large.txt');
    const content = 'x'.repeat(1.5 * 1024 * 1024); // 1.5MB
    writeFileSync(filePath, content);
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = resolveTextOrFile(filePath);
    expect(result).toBe(content);
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy.mock.calls[0][0]).toMatch(/Warning: File is large/);
  });

  it('throws an error for files larger than 10MB', () => {
    const filePath = join(testDir, 'huge.txt');
    const content = 'x'.repeat(10.5 * 1024 * 1024); // 10.5MB
    writeFileSync(filePath, content);
    expect(() => resolveTextOrFile(filePath)).toThrow(/File is too large/);
  });
});

describe('detectSubcommand', () => {
  it('returns "plan" when first arg is plan', () => {
    expect(detectSubcommand(['plan', '--url', 'https://x.com'])).toBe('plan');
  });

  it('returns null when first arg is a flag', () => {
    expect(detectSubcommand(['--url', 'https://x.com'])).toBe(null);
  });

  it('returns null for empty argv', () => {
    expect(detectSubcommand([])).toBe(null);
  });

  it('returns null for unknown positional args', () => {
    expect(detectSubcommand(['review', '--url', 'https://x.com'])).toBe(null);
  });
});

describe('parsePlanArgs', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const planRequiredArgs = ['--url', 'https://example.com'];

  it('parses valid args with correct defaults', () => {
    const result = parsePlanArgs(planRequiredArgs);
    expect(result.url).toBe('https://example.com');
    expect(result.intro).toBe('');
    expect(result.plan).toBe('');
    expect(result.instances).toBe(1);
    expect(result.rounds).toBe(1);
    expect(result.output).toBe('.');
    expect(result.keepTemp).toBe(false);
    expect(result.dryRun).toBe(false);
    expect(result.verbose).toBe(false);
    expect(result.suppressOpen).toBe(false);
  });

  it('calls process.exit(1) when --url is missing', () => {
    expect(() => parsePlanArgs([])).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not require --intro', () => {
    const result = parsePlanArgs(planRequiredArgs);
    expect(result.intro).toBe('');
  });

  it('does not require --plan', () => {
    const result = parsePlanArgs(planRequiredArgs);
    expect(result.plan).toBe('');
  });

  it('accepts --intro as inline text', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--intro', 'My intro text']);
    expect(result.intro).toBe('My intro text');
  });

  it('accepts --plan as inline text', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--plan', 'My plan text']);
    expect(result.plan).toBe('My plan text');
  });

  it('resolves --intro from file', () => {
    const testDir = join(process.cwd(), '.uxreview-temp-plan-test');
    mkdirSync(testDir, { recursive: true });
    const filePath = join(testDir, 'intro.txt');
    writeFileSync(filePath, 'Intro from file');
    try {
      const result = parsePlanArgs([...planRequiredArgs, '--intro', filePath]);
      expect(result.intro).toBe('Intro from file');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('resolves --plan from file', () => {
    const testDir = join(process.cwd(), '.uxreview-temp-plan-test');
    mkdirSync(testDir, { recursive: true });
    const filePath = join(testDir, 'plan.txt');
    writeFileSync(filePath, 'Plan from file');
    try {
      const result = parsePlanArgs([...planRequiredArgs, '--plan', filePath]);
      expect(result.plan).toBe('Plan from file');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('defaults output to "."', () => {
    const result = parsePlanArgs(planRequiredArgs);
    expect(result.output).toBe('.');
  });

  it('defaults instances to 1', () => {
    const result = parsePlanArgs(planRequiredArgs);
    expect(result.instances).toBe(1);
  });

  it('warns and falls back to 1 instance when --instances > 1 without --plan', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--instances', '3']);
    expect(result.instances).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--instances > 1 requires --plan')
    );
  });

  it('allows --instances > 1 when --plan is provided', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--instances', '3', '--plan', 'Area 1\nArea 2\nArea 3']);
    expect(result.instances).toBe(3);
  });

  it('warns that --append is not applicable', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--append']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--append is not applicable')
    );
  });

  it('warns that --max-retries is not applicable', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--max-retries', '5']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--max-retries is not applicable')
    );
  });

  it('warns that --instance-timeout is not applicable', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--instance-timeout', '60']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--instance-timeout is not applicable')
    );
  });

  it('warns that --rate-limit-retries is not applicable', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--rate-limit-retries', '20']);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--rate-limit-retries is not applicable')
    );
  });

  it('rejects unknown flags', () => {
    expect(() => parsePlanArgs([...planRequiredArgs, '--unknown-flag', 'value'])).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('strips "plan" subcommand from argv if present', () => {
    const result = parsePlanArgs(['plan', '--url', 'https://example.com']);
    expect(result.url).toBe('https://example.com');
  });

  it('shows plan-specific help on --help', () => {
    expect(() => parsePlanArgs(['--help'])).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('uxreview plan');
  });

  it('sets boolean flags correctly', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--keep-temp', '--dry-run', '--verbose', '--suppress-open']);
    expect(result.keepTemp).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.verbose).toBe(true);
    expect(result.suppressOpen).toBe(true);
  });

  it('accepts custom --output', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--output', './my-output']);
    expect(result.output).toBe('./my-output');
  });

  it('accepts custom --rounds', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--rounds', '3']);
    expect(result.rounds).toBe(3);
  });

  it('rejects invalid URL (not http/https)', () => {
    expect(() => parsePlanArgs(['--url', 'ftp://example.com'])).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'));
  });

  it('rejects non-positive --instances value', () => {
    expect(() => parsePlanArgs([...planRequiredArgs, '--instances', '0'])).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects non-numeric --instances value', () => {
    expect(() => parsePlanArgs([...planRequiredArgs, '--instances', 'abc'])).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects non-positive --rounds value', () => {
    expect(() => parsePlanArgs([...planRequiredArgs, '--rounds', '0'])).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects non-numeric --rounds value', () => {
    expect(() => parsePlanArgs([...planRequiredArgs, '--rounds', 'xyz'])).toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('defaults scope to DEFAULT_SCOPE when --scope is not provided', () => {
    const result = parsePlanArgs(planRequiredArgs);
    expect(result.scope).toBe(DEFAULT_SCOPE);
  });

  it('accepts custom --scope as inline text', () => {
    const result = parsePlanArgs([...planRequiredArgs, '--scope', 'Custom scope text']);
    expect(result.scope).toBe('Custom scope text');
  });

  it('works end-to-end with detectSubcommand then parsePlanArgs', () => {
    const fullArgv = ['plan', '--url', 'https://myapp.com', '--verbose', '--rounds', '2'];
    const subcommand = detectSubcommand(fullArgv);
    expect(subcommand).toBe('plan');
    // parsePlanArgs handles stripping 'plan' from the front
    const result = parsePlanArgs(fullArgv);
    expect(result.url).toBe('https://myapp.com');
    expect(result.verbose).toBe(true);
    expect(result.rounds).toBe(2);
    expect(result.instances).toBe(1);
    expect(result.output).toBe('.');
    expect(result.scope).toBe(DEFAULT_SCOPE);
  });
});
