import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    rmSync: vi.fn(actual.rmSync),
    existsSync: vi.fn(actual.existsSync),
    readdirSync: vi.fn(actual.readdirSync),
    mkdirSync: vi.fn(actual.mkdirSync),
  };
});

vi.mock('../src/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/logger.js')>();
  return {
    ...actual,
    debug: vi.fn(),
  };
});

import { rmSync, existsSync, readdirSync } from 'node:fs';
import { debug } from '../src/logger.js';
import { cleanupTempDir, hasExistingCheckpointData, getTempDir } from '../src/file-manager.js';

const mockedRmSync = vi.mocked(rmSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedDebug = vi.mocked(debug);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cleanupTempDir EBUSY retry', () => {
  it('retries on EBUSY and succeeds on subsequent attempt', async () => {
    const tempDir = getTempDir();

    // existsSync returns true so cleanupTempDir proceeds to rmSync
    mockedExistsSync.mockReturnValue(true);

    // First call throws EBUSY, second call succeeds
    const ebusyError = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    mockedRmSync
      .mockImplementationOnce(() => { throw ebusyError; })
      .mockImplementationOnce(() => undefined);

    await expect(cleanupTempDir()).resolves.toBeUndefined();

    expect(mockedRmSync).toHaveBeenCalledTimes(2);
    expect(mockedRmSync).toHaveBeenCalledWith(tempDir, { recursive: true, force: true });
  });

  it('throws after exhausting all 5 retry attempts on EBUSY', async () => {
    mockedExistsSync.mockReturnValue(true);

    const ebusyError = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    mockedRmSync.mockImplementation(() => { throw ebusyError; });

    await expect(cleanupTempDir()).rejects.toThrow('EBUSY');

    expect(mockedRmSync).toHaveBeenCalledTimes(5);
  });

  it('throws immediately on non-EBUSY/EPERM errors without retrying', async () => {
    mockedExistsSync.mockReturnValue(true);

    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockedRmSync.mockImplementation(() => { throw enoentError; });

    await expect(cleanupTempDir()).rejects.toThrow('ENOENT');

    expect(mockedRmSync).toHaveBeenCalledTimes(1);
  });
});

describe('hasExistingCheckpointData error handling', () => {
  it('returns false when readdirSync throws', () => {
    const tempDir = getTempDir();

    // temp dir exists but no consolidation checkpoint
    mockedExistsSync.mockImplementation((p: string | URL) => {
      if (String(p) === tempDir) return true;
      return false;
    });

    mockedReaddirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(hasExistingCheckpointData()).toBe(false);
  });

  it('calls debug with the error when readdirSync throws', () => {
    const tempDir = getTempDir();

    mockedExistsSync.mockImplementation((p: string | URL) => {
      if (String(p) === tempDir) return true;
      return false;
    });

    const permError = new Error('EACCES: permission denied');
    mockedReaddirSync.mockImplementation(() => {
      throw permError;
    });

    hasExistingCheckpointData();

    expect(mockedDebug).toHaveBeenCalledWith(
      'Failed to read temp directory for checkpoint detection',
      permError,
    );
  });
});
