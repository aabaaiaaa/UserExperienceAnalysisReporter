/**
 * Tests for error catch blocks in discovery.ts and report.ts.
 *
 * These tests mock node:fs at the module level to simulate readFileSync
 * throwing errors when the file exists but can't be read (e.g., permission denied).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

// Track which paths should cause read errors
let errorPaths = new Set<string>();

// Mock node:fs to override existsSync and readFileSync
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: string) => {
      // Return true for our mock instance paths so the functions attempt to read
      if (typeof path === 'string' && path.includes('mock-temp')) return true;
      return actual.existsSync(path);
    },
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      const filePath = typeof args[0] === 'string' ? args[0] : args[0].toString();
      if (errorPaths.has(filePath)) {
        throw new Error('EACCES: permission denied');
      }
      return actual.readFileSync(...args);
    },
  };
});

// Mock file-manager to return deterministic paths
vi.mock('../src/file-manager.js', () => ({
  getInstancePaths: (n: number) => {
    const dir = join('mock-temp', `instance-${n}`);
    return {
      dir,
      discovery: join(dir, 'discovery.md'),
      checkpoint: join(dir, 'checkpoint.json'),
      report: join(dir, 'report.md'),
      screenshots: join(dir, 'screenshots'),
    };
  },
}));

import { readDiscoveryDocument, readDiscoveryContent } from '../src/discovery.js';
import { readInstanceReport, readReportContent } from '../src/report.js';

beforeEach(() => {
  errorPaths.clear();
});

describe('discovery.ts read error paths', () => {
  it('readDiscoveryDocument returns null when readFileSync throws', () => {
    const discoveryPath = join('mock-temp', 'instance-1', 'discovery.md');
    errorPaths.add(discoveryPath);

    const result = readDiscoveryDocument(1);
    expect(result).toBeNull();
  });

  it('readDiscoveryContent returns null when readFileSync throws', () => {
    const discoveryPath = join('mock-temp', 'instance-1', 'discovery.md');
    errorPaths.add(discoveryPath);

    const result = readDiscoveryContent(1);
    expect(result).toBeNull();
  });
});

describe('report.ts read error paths', () => {
  it('readInstanceReport returns null when readFileSync throws', () => {
    const reportPath = join('mock-temp', 'instance-1', 'report.md');
    errorPaths.add(reportPath);

    const result = readInstanceReport(1);
    expect(result).toBeNull();
  });

  it('readReportContent returns null when readFileSync throws', () => {
    const reportPath = join('mock-temp', 'instance-1', 'report.md');
    errorPaths.add(reportPath);

    const result = readReportContent(1);
    expect(result).toBeNull();
  });
});
