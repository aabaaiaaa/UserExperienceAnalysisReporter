import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  debug: vi.fn(),
}));

import { exec } from 'node:child_process';
import { debug } from '../src/logger.js';
import { openInBrowser } from '../src/browser-open.js';

const mockExec = vi.mocked(exec);
const mockDebug = vi.mocked(debug);

describe('openInBrowser', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.clearAllMocks();
  });

  it('uses start command on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    openInBrowser('/path/to/report.html');

    expect(mockExec).toHaveBeenCalledOnce();
    expect(mockExec.mock.calls[0][0]).toBe('start "" "/path/to/report.html"');
  });

  it('uses open command on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    openInBrowser('/path/to/report.html');

    expect(mockExec).toHaveBeenCalledOnce();
    expect(mockExec.mock.calls[0][0]).toBe('open "/path/to/report.html"');
  });

  it('uses xdg-open command on linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    openInBrowser('/path/to/report.html');

    expect(mockExec).toHaveBeenCalledOnce();
    expect(mockExec.mock.calls[0][0]).toBe('xdg-open "/path/to/report.html"');
  });

  it('calls debug when exec callback reports an error', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    // Make exec invoke its callback with an error
    mockExec.mockImplementation((_cmd: any, callback: any) => {
      callback(new Error('spawn xdg-open ENOENT'));
      return undefined as any;
    });

    openInBrowser('/path/to/report.html');

    expect(mockDebug).toHaveBeenCalledOnce();
    expect(mockDebug).toHaveBeenCalledWith(
      'Failed to open in browser: spawn xdg-open ENOENT',
    );
  });

  it('does not call debug when exec succeeds', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    mockExec.mockImplementation((_cmd: any, callback: any) => {
      callback(null);
      return undefined as any;
    });

    openInBrowser('/path/to/report.html');

    expect(mockDebug).not.toHaveBeenCalled();
  });
});
