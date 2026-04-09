import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    rmSync: vi.fn(),
    existsSync: vi.fn(() => true),
  };
});

import { rmSync, existsSync } from 'node:fs';
import { cleanTestDirs } from './test-helpers.js';

const mockedRmSync = vi.mocked(rmSync);
const mockedExistsSync = vi.mocked(existsSync);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: directory exists so cleanTestDirs proceeds
  mockedExistsSync.mockReturnValue(true);
});

describe('cleanTestDirs', () => {
  it('deletes the directory on first attempt when rmSync succeeds', async () => {
    mockedRmSync.mockReturnValue(undefined);

    await cleanTestDirs('/tmp/test-base');

    expect(mockedExistsSync).toHaveBeenCalledWith('/tmp/test-base');
    expect(mockedRmSync).toHaveBeenCalledTimes(1);
    expect(mockedRmSync).toHaveBeenCalledWith('/tmp/test-base', { recursive: true, force: true });
  });

  it('returns immediately when the directory does not exist', async () => {
    mockedExistsSync.mockReturnValue(false);

    await cleanTestDirs('/tmp/nonexistent');

    expect(mockedRmSync).not.toHaveBeenCalled();
  });

  it('retries on EBUSY and succeeds on the second attempt', async () => {
    const ebusyError = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    mockedRmSync
      .mockImplementationOnce(() => { throw ebusyError; })
      .mockImplementationOnce(() => undefined);

    await expect(cleanTestDirs('/tmp/test-base')).resolves.toBeUndefined();

    expect(mockedRmSync).toHaveBeenCalledTimes(2);
  });

  it('retries on EPERM and succeeds on the second attempt', async () => {
    const epermError = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    mockedRmSync
      .mockImplementationOnce(() => { throw epermError; })
      .mockImplementationOnce(() => undefined);

    await expect(cleanTestDirs('/tmp/test-base')).resolves.toBeUndefined();

    expect(mockedRmSync).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all 5 retry attempts on EBUSY', async () => {
    const ebusyError = Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
    mockedRmSync.mockImplementation(() => { throw ebusyError; });

    await expect(cleanTestDirs('/tmp/test-base')).rejects.toThrow('EBUSY');

    expect(mockedRmSync).toHaveBeenCalledTimes(5);
  });

  it('throws immediately on non-lock errors without retrying', async () => {
    const enoentError = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    mockedRmSync.mockImplementation(() => { throw enoentError; });

    await expect(cleanTestDirs('/tmp/test-base')).rejects.toThrow('ENOENT');

    expect(mockedRmSync).toHaveBeenCalledTimes(1);
  });
});
