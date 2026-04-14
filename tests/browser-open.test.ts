import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  debug: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { debug } from '../src/logger.js';
import { openInBrowser } from '../src/browser-open.js';

const mockExecFile = vi.mocked(execFile);
const mockDebug = vi.mocked(debug);

describe('openInBrowser', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.clearAllMocks();
  });

  it('uses cmd /c start on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    openInBrowser('/path/to/report.html');

    expect(mockExecFile).toHaveBeenCalledOnce();
    expect(mockExecFile.mock.calls[0][0]).toBe('cmd');
    expect(mockExecFile.mock.calls[0][1]).toEqual(['/c', 'start', '""', '/path/to/report.html']);
  });

  it('uses open command on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    openInBrowser('/path/to/report.html');

    expect(mockExecFile).toHaveBeenCalledOnce();
    expect(mockExecFile.mock.calls[0][0]).toBe('open');
    expect(mockExecFile.mock.calls[0][1]).toEqual(['/path/to/report.html']);
  });

  it('uses xdg-open command on linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    openInBrowser('/path/to/report.html');

    expect(mockExecFile).toHaveBeenCalledOnce();
    expect(mockExecFile.mock.calls[0][0]).toBe('xdg-open');
    expect(mockExecFile.mock.calls[0][1]).toEqual(['/path/to/report.html']);
  });

  it('calls debug when execFile callback reports an error', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    // Make execFile invoke its callback with an error
    mockExecFile.mockImplementation((_cmd: any, _args: any, callback: any) => {
      callback(new Error('spawn xdg-open ENOENT'));
      return undefined as any;
    });

    openInBrowser('/path/to/report.html');

    expect(mockDebug).toHaveBeenCalledOnce();
    expect(mockDebug).toHaveBeenCalledWith(
      'Failed to open in browser: spawn xdg-open ENOENT',
    );
  });

  it('does not call debug when execFile succeeds', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    mockExecFile.mockImplementation((_cmd: any, _args: any, callback: any) => {
      callback(null);
      return undefined as any;
    });

    openInBrowser('/path/to/report.html');

    expect(mockDebug).not.toHaveBeenCalled();
  });
});
