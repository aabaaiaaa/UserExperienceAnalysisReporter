import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join, resolve, parse as parsePath } from 'node:path';
import { homedir } from 'node:os';
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

afterEach(async () => {
  // Clean up temp dir after each test
  await cleanupTempDir();
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
    it('removes the temp directory if it exists', async () => {
      await initTempDir(1);
      expect(existsSync(getTempDir())).toBe(true);
      await cleanupTempDir();
      expect(existsSync(getTempDir())).toBe(false);
    });

    it('does not throw if temp directory does not exist', async () => {
      await cleanupTempDir(); // ensure clean
      await expect(cleanupTempDir()).resolves.toBeUndefined();
    });
  });

  describe('initTempDir', () => {
    it('creates the temp directory structure for 1 instance', async () => {
      const tempDir = await initTempDir(1);
      expect(existsSync(tempDir)).toBe(true);
      expect(existsSync(join(tempDir, 'instance-1'))).toBe(true);
      expect(existsSync(join(tempDir, 'instance-1', 'screenshots'))).toBe(true);
    });

    it('creates the temp directory structure for 3 instances', async () => {
      const tempDir = await initTempDir(3);
      for (let i = 1; i <= 3; i++) {
        const instanceDir = join(tempDir, `instance-${i}`);
        expect(existsSync(instanceDir)).toBe(true);
        expect(statSync(instanceDir).isDirectory()).toBe(true);
        expect(existsSync(join(instanceDir, 'screenshots'))).toBe(true);
      }
    });

    it('cleans up existing temp dir before creating new one', async () => {
      // First init with 2 instances
      await initTempDir(2);
      expect(existsSync(getInstanceDir(2))).toBe(true);

      // Re-init with 1 instance — instance-2 should be gone
      await initTempDir(1);
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

    it('preserves existing output directory in preserve mode', () => {
      const outputDir = initOutputDir();
      const { writeFileSync } = require('node:fs');
      writeFileSync(join(outputDir, 'report.md'), '# Existing report');
      writeFileSync(join(outputDir, 'screenshots', 'old-screenshot.png'), 'img-data');

      // Re-init with cleanExisting=false — existing files should be preserved
      initOutputDir(undefined, false);
      expect(existsSync(join(outputDir, 'report.md'))).toBe(true);
      expect(existsSync(join(outputDir, 'screenshots', 'old-screenshot.png'))).toBe(true);
      expect(existsSync(join(outputDir, 'screenshots'))).toBe(true);
    });

    it('creates output directory in preserve mode when it does not exist', () => {
      const outputDir = initOutputDir('./test-output-custom', false);
      expect(existsSync(outputDir)).toBe(true);
      expect(existsSync(join(outputDir, 'screenshots'))).toBe(true);
    });
  });

  describe('initOutputDir safety guard', () => {
    it('refuses when target equals the current working directory', () => {
      expect(() => initOutputDir('.')).toThrow(/current working directory/i);
    });

    it('refuses when target is an ancestor of the current working directory', () => {
      const parentBefore = resolve('..');
      expect(existsSync(parentBefore)).toBe(true);
      expect(() => initOutputDir('..')).toThrow(/ancestor/i);
      // Guard must throw BEFORE rmSync runs — parent dir must still exist
      expect(existsSync(parentBefore)).toBe(true);
    });

    it("refuses when target equals the user's home directory", () => {
      expect(() => initOutputDir(homedir())).toThrow(/home directory/i);
    });

    it('refuses when target equals a filesystem root', () => {
      const root = parsePath(process.cwd()).root;
      expect(() => initOutputDir(root)).toThrow(/filesystem root/i);
    });

    it.runIf(process.platform === 'win32')(
      'refuses when target is the cwd in a different case (Windows)',
      () => {
        const cwdUpper = process.cwd().toUpperCase();
        expect(() => initOutputDir(cwdUpper)).toThrow(/current working directory/i);
      },
    );

    it('does not throw for a safe target and creates the directory', () => {
      const outputDir = initOutputDir('./test-output-custom');
      expect(existsSync(outputDir)).toBe(true);
      expect(existsSync(join(outputDir, 'screenshots'))).toBe(true);
    });

    it('error message includes the --output recovery hint', () => {
      expect(() => initOutputDir('.')).toThrow(/--output/);
    });
  });

  describe('main subcommand protection', () => {
    it('refuses to wipe the current working directory via initOutputDir(".")', () => {
      // initOutputDir is the single chokepoint every subcommand (plan or main)
      // flows through when preparing an output directory. A direct test here
      // proves end-to-end protection for the main `uxreview` subcommand as well:
      // if a user (or misconfigured caller) passes `--output .`, the guard must
      // fire before rmSync touches the cwd.
      expect(() => initOutputDir('.')).toThrow(/current working directory/i);
    });
  });

  describe('initWorkspace', () => {
    it('initializes both temp and output directories', async () => {
      const layout = await initWorkspace(2);
      expect(existsSync(layout.tempDir)).toBe(true);
      expect(existsSync(layout.outputDir)).toBe(true);
      expect(layout.instanceDirs).toHaveLength(2);
      for (const dir of layout.instanceDirs) {
        expect(existsSync(dir)).toBe(true);
      }
    });

    it('uses custom output path when provided', async () => {
      const layout = await initWorkspace(1, './test-output-custom');
      expect(layout.outputDir).toBe(resolve('./test-output-custom'));
      expect(existsSync(layout.outputDir)).toBe(true);
    });
  });
});
