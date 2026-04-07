import { spawn, ChildProcess } from 'node:child_process';
import { DEFAULT_CLI_TIMEOUT_MS } from './config.js';
import { debug } from './logger.js';

/** Registry of currently active child processes for cleanup on shutdown */
const activeProcesses = new Set<ChildProcess>();

/**
 * Kill all active child processes.
 * Used by the orchestrator's signal handler to clean up on SIGINT/SIGTERM.
 */
export function killAllChildProcesses(): void {
  for (const child of activeProcesses) {
    try {
      child.kill();
    } catch {
      // Process may have already exited — ignore
    }
  }
  activeProcesses.clear();
}

/**
 * Returns the number of currently tracked active child processes.
 */
export function getActiveProcessCount(): number {
  return activeProcesses.size;
}

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

/**
 * Invoke Claude Code CLI as a subprocess with the given prompt.
 *
 * Uses `claude -p` (print mode) for one-off calls. The prompt is passed
 * via stdin to avoid shell escaping issues with long/complex prompts.
 *
 * Returns the captured stdout, stderr, exit code, and a success flag.
 */
export function runClaude(options: ClaudeCliOptions): Promise<ClaudeCliResult> {
  const { prompt, cwd, timeout = DEFAULT_CLI_TIMEOUT_MS, extraArgs = [] } = options;

  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text', ...extraArgs];
    const command = 'claude';

    const spawnStart = Date.now();
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      shell: process.platform === 'win32',
    });

    activeProcesses.add(child);
    debug(`Spawned subprocess PID=${child.pid} command=${command} args=${JSON.stringify(args)}`);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      activeProcesses.delete(child);
      reject(new Error(`Failed to spawn Claude Code CLI: ${err.message}`));
    });

    child.on('close', (code, signal) => {
      activeProcesses.delete(child);
      const durationMs = Date.now() - spawnStart;
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const exitCode = code ?? 1;
      debug(`Subprocess PID=${child.pid} exited code=${exitCode} signal=${signal ?? 'none'} duration=${durationMs}ms`);

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
