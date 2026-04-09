import { rmSync, existsSync } from 'node:fs';

/**
 * Clean up a test directory with EBUSY/EPERM retry logic for Windows.
 * Mirrors the retry pattern in src/file-manager.ts:cleanupTempDir().
 */
export async function cleanTestDirs(testBase: string): Promise<void> {
  if (!existsSync(testBase)) return;

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      rmSync(testBase, { recursive: true, force: true });
      return;
    } catch (err: unknown) {
      const isLockError = err instanceof Error && 'code' in err &&
        ((err as NodeJS.ErrnoException).code === 'EBUSY' ||
         (err as NodeJS.ErrnoException).code === 'EPERM');
      if (!isLockError || attempt === maxAttempts) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 100 * attempt));
    }
  }
}
