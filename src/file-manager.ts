import { mkdirSync, rmSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, parse as parsePath, sep } from 'node:path';
import { homedir } from 'node:os';
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
      const isRetryableError = err instanceof Error && 'code' in err &&
        ((err as NodeJS.ErrnoException).code === 'EBUSY' ||
         (err as NodeJS.ErrnoException).code === 'EPERM' ||
         (err as NodeJS.ErrnoException).code === 'ENOTEMPTY');
      if (!isRetryableError || attempt === maxAttempts) {
        throw err;
      }
      // Non-blocking delay before retry (100ms * attempt)
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
}

/**
 * Check whether the temp directory contains checkpoint data from a previous
 * interrupted run. Returns true if a consolidation checkpoint or any instance
 * checkpoint file exists.
 */
export function hasExistingCheckpointData(): boolean {
  const tempDir = getTempDir();
  if (!existsSync(tempDir)) return false;

  // Check for consolidation checkpoint
  if (existsSync(join(tempDir, 'consolidation-checkpoint.json'))) {
    return true;
  }

  // Check for instance checkpoint files
  try {
    const entries = readdirSync(tempDir);
    for (const entry of entries) {
      if (entry.startsWith('instance-')) {
        if (existsSync(join(tempDir, entry, 'checkpoint.json'))) {
          return true;
        }
      }
    }
  } catch (err) {
    debug('Failed to read temp directory for checkpoint detection', err);
    return false;
  }

  return false;
}

/**
 * Initialize the temp working directory with per-instance subdirectories.
 *
 * If checkpoint data exists from a previous interrupted run, the temp
 * directory is preserved so consolidation can resume. Otherwise, any
 * existing temp directory is cleaned first to avoid stale state.
 */
export async function initTempDir(instanceCount: number): Promise<string> {
  const tempDir = getTempDir();
  debug(`Initializing temp directory for ${instanceCount} instance(s): ${tempDir}`);

  const resuming = hasExistingCheckpointData();

  if (resuming) {
    debug('Checkpoint data found — preserving temp directory for resume');
  } else {
    // Fresh run — clean up stale state from previous runs
    await cleanupTempDir();
  }

  // Create temp root (no-op if already exists)
  mkdirSync(tempDir, { recursive: true });

  // Create per-instance directories with screenshots subdirectory
  for (let i = 1; i <= instanceCount; i++) {
    const paths = getInstancePaths(i);
    mkdirSync(paths.dir, { recursive: true });
    mkdirSync(paths.screenshots, { recursive: true });
  }

  return tempDir;
}

function canonicalize(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
}

function normalizeForCompare(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * Throws if `targetPath` resolves to a path that must never be recursively
 * removed: the current working directory, any ancestor of it, the user's
 * home directory, or a filesystem root. The check canonicalizes paths via
 * `fs.realpathSync.native()` so symlinks and `..` segments cannot sneak past.
 */
function assertSafeRemovalTarget(targetPath: string): void {
  const target = normalizeForCompare(canonicalize(targetPath));
  const cwd = normalizeForCompare(canonicalize(process.cwd()));
  const home = normalizeForCompare(canonicalize(homedir()));
  const root = normalizeForCompare(parsePath(target).root);

  const recoveryHint = 'Choose a different --output path (e.g. --output ./uxreview-output).';

  if (target === cwd) {
    throw new Error(
      `Refusing to delete output directory ${targetPath}: it is the current working directory. ${recoveryHint}`,
    );
  }

  if (cwd.startsWith(target + sep)) {
    throw new Error(
      `Refusing to delete output directory ${targetPath}: it is an ancestor of the current working directory. ${recoveryHint}`,
    );
  }

  if (target === home) {
    throw new Error(
      `Refusing to delete output directory ${targetPath}: it is the user's home directory. ${recoveryHint}`,
    );
  }

  if (root !== '' && target === root) {
    throw new Error(
      `Refusing to delete output directory ${targetPath}: it is a filesystem root. ${recoveryHint}`,
    );
  }
}

/**
 * Initialize the output directory.
 *
 * When `cleanExisting` is true (the default), any existing output directory is
 * removed first to avoid mixing stale data with new results. When false, the
 * existing output directory is preserved so that new findings can be added
 * alongside previous results. Either way, the directory (and its screenshots
 * subdirectory) is created if it doesn't already exist.
 */
export function initOutputDir(outputPath?: string, cleanExisting: boolean = true): string {
  const outputDir = resolve(outputPath || DEFAULT_OUTPUT_DIR);
  debug(`Initializing output directory: ${outputDir}${cleanExisting ? '' : ' (preserve mode)'}`);

  if (existsSync(outputDir) && cleanExisting) {
    debug(`Removing existing output directory: ${outputDir}`);
    assertSafeRemovalTarget(outputDir);
    rmSync(outputDir, { recursive: true, force: true });
  }

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });

  return outputDir;
}

/**
 * Initialize the full workspace: temp directory and output directory.
 * Returns the layout with all resolved paths.
 *
 * `cleanExisting` is forwarded to `initOutputDir`: true (the default) removes
 * any existing output directory first; false preserves it.
 */
export async function initWorkspace(
  instanceCount: number,
  outputPath?: string,
  cleanExisting: boolean = true,
): Promise<WorkspaceLayout> {
  const tempDir = await initTempDir(instanceCount);
  const outputDir = initOutputDir(outputPath, cleanExisting);

  const instanceDirs: string[] = [];
  for (let i = 1; i <= instanceCount; i++) {
    instanceDirs.push(getInstanceDir(i));
  }

  return { tempDir, instanceDirs, outputDir };
}
