import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  it('defaults instances to 1 when omitted', () => {
    const result = parseArgs(requiredArgs);
    expect(result.instances).toBe(1);
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
});
