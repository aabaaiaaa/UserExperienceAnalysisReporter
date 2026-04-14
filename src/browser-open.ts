import { execFile } from 'node:child_process';
import { debug } from './logger.js';

/**
 * Open a file in the default browser using the platform-specific command.
 * win32 → cmd /c start, darwin → open, else → xdg-open.
 * Uses execFile() to avoid shell injection risks.
 */
export function openInBrowser(filePath: string): void {
  const [cmd, args]: [string, string[]] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '""', filePath]]
    : process.platform === 'darwin'
      ? ['open', [filePath]]
      : ['xdg-open', [filePath]];
  execFile(cmd, args, (err) => {
    if (err) debug(`Failed to open in browser: ${err.message}`);
  });
}
