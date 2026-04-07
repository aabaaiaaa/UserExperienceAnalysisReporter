import { spawn } from 'node:child_process';

export interface ClaudeCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface ClaudeCliOptions {
  /** The prompt to send to Claude Code CLI */
  prompt: string;
  /** Working directory for the subprocess */
  cwd?: string;
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
  /** Additional CLI flags to pass (e.g., --allowedTools) */
  extraArgs?: string[];
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Invoke Claude Code CLI as a subprocess with the given prompt.
 *
 * Uses `claude -p` (print mode) for one-off calls. The prompt is passed
 * via stdin to avoid shell escaping issues with long/complex prompts.
 *
 * Returns the captured stdout, stderr, exit code, and a success flag.
 */
export function runClaude(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
  const { prompt, cwd, timeout = DEFAULT_TIMEOUT_MS, extraArgs = [] } = options;

  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text', ...extraArgs];
    const command = process.platform === 'win32' ? 'claude.cmd' : 'claude';

    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Claude Code CLI: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const exitCode = code ?? 1;

      if (signal === 'SIGTERM' && code === null) {
        resolve({
          stdout,
          stderr: stderr || `Process timed out after ${timeout}ms`,
          exitCode: 1,
          success: false,
        });
        return;
      }

      resolve({
        stdout,
        stderr,
        exitCode,
        success: exitCode === 0,
      });
    });

    // Send the prompt via stdin then close the stream
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
