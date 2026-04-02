import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  getTempDir,
  getInstanceDir,
  getInstancePaths,
  getWorkDistributionPath,
  cleanupTempDir,
  initTempDir,
  initOutputDir,
  initWorkspace,
} from '../src/file-manager.js';

afterEach(() => {
  // Clean up temp dir after each test
  cleanupTempDir();
  // Clean up any output dirs created during tests
  const defaultOutput = resolve('./uxreview-output');
  const customOutput = resolve('./test-output-custom');
  for (const dir of [defaultOutput, customOutput]) {
    if (existsSync(dir)) {
      const { rmSync } = require('node:fs');
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('file-manager', () => {
  describe('getTempDir', () => {
    it('returns an absolute path ending with .uxreview-temp', () => {
      const tempDir = getTempDir();
      expect(tempDir).toMatch(/\.uxreview-temp$/);
      expect(tempDir).toBe(resolve('.uxreview-temp'));
    });
  });

  describe('getInstanceDir', () => {
    it('returns correct path for instance number', () => {
      const dir = getInstanceDir(1);
      expect(dir).toBe(join(getTempDir(), 'instance-1'));
    });
  });

  describe('getInstancePaths', () => {
    it('returns all expected file paths for an instance', () => {
      const paths = getInstancePaths(2);
      const dir = getInstanceDir(2);
      expect(paths.dir).toBe(dir);
      expect(paths.discovery).toBe(join(dir, 'discovery.md'));
      expect(paths.checkpoint).toBe(join(dir, 'checkpoint.json'));
      expect(paths.report).toBe(join(dir, 'report.md'));
      expect(paths.screenshots).toBe(join(dir, 'screenshots'));
    });
  });

  describe('getWorkDistributionPath', () => {
    it('returns path inside temp dir', () => {
      expect(getWorkDistributionPath()).toBe(join(getTempDir(), 'work-distribution.md'));
    });
  });

  describe('cleanupTempDir', () => {
    it('removes the temp directory if it exists', () => {
      initTempDir(1);
      expect(existsSync(getTempDir())).toBe(true);
      cleanupTempDir();
      expect(existsSync(getTempDir())).toBe(false);
    });

    it('does not throw if temp directory does not exist', () => {
      cleanupTempDir(); // ensure clean
      expect(() => cleanupTempDir()).not.toThrow();
    });
  });

  describe('initTempDir', () => {
    it('creates the temp directory structure for 1 instance', () => {
      const tempDir = initTempDir(1);
      expect(existsSync(tempDir)).toBe(true);
      expect(existsSync(join(tempDir, 'instance-1'))).toBe(true);
      expect(existsSync(join(tempDir, 'instance-1', 'screenshots'))).toBe(true);
    });

    it('creates the temp directory structure for 3 instances', () => {
      const tempDir = initTempDir(3);
      for (let i = 1; i <= 3; i++) {
        const instanceDir = join(tempDir, `instance-${i}`);
        expect(existsSync(instanceDir)).toBe(true);
        expect(statSync(instanceDir).isDirectory()).toBe(true);
        expect(existsSync(join(instanceDir, 'screenshots'))).toBe(true);
      }
    });

    it('cleans up existing temp dir before creating new one', () => {
      // First init with 2 instances
      initTempDir(2);
      expect(existsSync(getInstanceDir(2))).toBe(true);

      // Re-init with 1 instance — instance-2 should be gone
      initTempDir(1);
      expect(existsSync(getInstanceDir(1))).toBe(true);
      expect(existsSync(getInstanceDir(2))).toBe(false);
    });
  });

  describe('initOutputDir', () => {
    it('creates the default output directory with screenshots subdirectory', () => {
      const outputDir = initOutputDir();
      expect(existsSync(outputDir)).toBe(true);
      expect(existsSync(join(outputDir, 'screenshots'))).toBe(true);
      expect(outputDir).toBe(resolve('./uxreview-output'));
    });

    it('creates a custom output directory', () => {
      const outputDir = initOutputDir('./test-output-custom');
      expect(existsSync(outputDir)).toBe(true);
      expect(existsSync(join(outputDir, 'screenshots'))).toBe(true);
      expect(outputDir).toBe(resolve('./test-output-custom'));
    });

    it('overwrites an existing output directory', () => {
      const outputDir = initOutputDir();
      // Write a file to confirm it gets replaced
      const { writeFileSync } = require('node:fs');
      writeFileSync(join(outputDir, 'stale.txt'), 'old');
      expect(existsSync(join(outputDir, 'stale.txt'))).toBe(true);

      // Re-init — stale file should be gone
      initOutputDir();
      expect(existsSync(join(outputDir, 'stale.txt'))).toBe(false);
      expect(existsSync(join(outputDir, 'screenshots'))).toBe(true);
    });
  });

  describe('initWorkspace', () => {
    it('initializes both temp and output directories', () => {
      const layout = initWorkspace(2);
      expect(existsSync(layout.tempDir)).toBe(true);
      expect(existsSync(layout.outputDir)).toBe(true);
      expect(layout.instanceDirs).toHaveLength(2);
      for (const dir of layout.instanceDirs) {
        expect(existsSync(dir)).toBe(true);
      }
    });

    it('uses custom output path when provided', () => {
      const layout = initWorkspace(1, './test-output-custom');
      expect(layout.outputDir).toBe(resolve('./test-output-custom'));
      expect(existsSync(layout.outputDir)).toBe(true);
    });
  });
});
