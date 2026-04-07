import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, resolveTextOrFile } from '../src/cli.js';

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
