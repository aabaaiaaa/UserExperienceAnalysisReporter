import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TEMP_DIR_NAME = '.uxreview-temp';
const DEFAULT_OUTPUT_DIR = './uxreview-output';

export interface WorkspaceLayout {
  tempDir: string;
  instanceDirs: string[];
  outputDir: string;
}

/**
 * Get the absolute path to the temp working directory.
 */
export function getTempDir(): string {
  return resolve(TEMP_DIR_NAME);
}

/**
 * Get the absolute path to an instance's working directory.
 */
export function getInstanceDir(instanceNumber: number): string {
  return join(getTempDir(), `instance-${instanceNumber}`);
}

/**
 * Get paths for all files within an instance directory.
 */
export function getInstancePaths(instanceNumber: number) {
  const dir = getInstanceDir(instanceNumber);
  return {
    dir,
    discovery: join(dir, 'discovery.md'),
    checkpoint: join(dir, 'checkpoint.json'),
    report: join(dir, 'report.md'),
    screenshots: join(dir, 'screenshots'),
  };
}

/**
 * Get the path to the work distribution file.
 */
export function getWorkDistributionPath(): string {
  return join(getTempDir(), 'work-distribution.md');
}

/**
 * Clean up the temp directory from a previous run.
 * Safe to call even if the directory doesn't exist.
 */
export function cleanupTempDir(): void {
  const tempDir = getTempDir();
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Initialize the temp working directory with per-instance subdirectories.
 * Cleans up any existing temp directory first to avoid stale state.
 */
export function initTempDir(instanceCount: number): string {
  const tempDir = getTempDir();

  // Clean up stale state from previous runs
  cleanupTempDir();

  // Create temp root
  mkdirSync(tempDir, { recursive: true });

  // Create per-instance directories with screenshots subdirectory
  for (let i = 1; i <= instanceCount; i++) {
    const paths = getInstancePaths(i);
    mkdirSync(paths.dir, { recursive: true });
    mkdirSync(paths.screenshots, { recursive: true });
  }

  return tempDir;
}

/**
 * Initialize the output directory. Creates it fresh (removes existing to avoid
 * mixing stale output with new results).
 */
export function initOutputDir(outputPath?: string): string {
  const outputDir = resolve(outputPath || DEFAULT_OUTPUT_DIR);

  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });

  return outputDir;
}

/**
 * Initialize the full workspace: temp directory and output directory.
 * Returns the layout with all resolved paths.
 */
export function initWorkspace(instanceCount: number, outputPath?: string): WorkspaceLayout {
  const tempDir = initTempDir(instanceCount);
  const outputDir = initOutputDir(outputPath);

  const instanceDirs: string[] = [];
  for (let i = 1; i <= instanceCount; i++) {
    instanceDirs.push(getInstanceDir(i));
  }

  return { tempDir, instanceDirs, outputDir };
}
