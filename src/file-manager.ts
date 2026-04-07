import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { debug } from './logger.js';

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
 *
 * On Windows, directories may be briefly locked by processes that
 * haven't fully released handles (e.g., Playwright browser instances).
 * Retries a few times with short delays to handle this.
 */
export async function cleanupTempDir(): Promise<void> {
  const tempDir = getTempDir();
  if (!existsSync(tempDir)) return;
  debug(`Cleaning up temp directory: ${tempDir}`);

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
      return;
    } catch (err: unknown) {
      const isLockError = err instanceof Error && 'code' in err &&
        ((err as NodeJS.ErrnoException).code === 'EBUSY' ||
         (err as NodeJS.ErrnoException).code === 'EPERM');
      if (!isLockError || attempt === maxAttempts) {
        throw err;
      }
      // Non-blocking delay before retry (100ms * attempt)
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
}

/**
 * Initialize the temp working directory with per-instance subdirectories.
 * Cleans up any existing temp directory first to avoid stale state.
 */
export async function initTempDir(instanceCount: number): Promise<string> {
  const tempDir = getTempDir();
  debug(`Initializing temp directory for ${instanceCount} instance(s): ${tempDir}`);

  // Clean up stale state from previous runs
  await cleanupTempDir();

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
 * Initialize the output directory. By default, removes any existing output to
 * avoid mixing stale data with new results.
 *
 * When `append` is true, the existing output directory is preserved so that new
 * findings can be added alongside previous results. The directory (and its
 * screenshots subdirectory) is still created if it doesn't already exist.
 */
export function initOutputDir(outputPath?: string, append?: boolean): string {
  const outputDir = resolve(outputPath || DEFAULT_OUTPUT_DIR);
  debug(`Initializing output directory: ${outputDir}${append ? ' (append mode)' : ''}`);

  if (existsSync(outputDir) && !append) {
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
export async function initWorkspace(instanceCount: number, outputPath?: string, append?: boolean): Promise<WorkspaceLayout> {
  const tempDir = await initTempDir(instanceCount);
  const outputDir = initOutputDir(outputPath, append);

  const instanceDirs: string[] = [];
  for (let i = 1; i <= instanceCount; i++) {
    instanceDirs.push(getInstanceDir(i));
  }

  return { tempDir, instanceDirs, outputDir };
}
