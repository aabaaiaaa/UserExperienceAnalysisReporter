import { exec } from 'node:child_process';
import { debug } from './logger.js';

/**
 * Open a file in the default browser using the platform-specific command.
 * win32 → start "", darwin → open, else → xdg-open.
 */
export function openInBrowser(filePath: string): void {
  const openCmd = process.platform === 'win32' ? `start "" "${filePath}"`
    : process.platform === 'darwin' ? `open "${filePath}"`
    : `xdg-open "${filePath}"`;
  exec(openCmd, (err) => {
    if (err) debug(`Failed to open in browser: ${err.message}`);
  });
}
