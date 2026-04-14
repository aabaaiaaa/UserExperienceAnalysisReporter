import { killAllChildProcesses } from './claude-cli.js';

/**
 * Manages flag-based signal handling for orchestrator functions.
 *
 * Instead of calling process.exit(), the signal handler sets a flag and
 * rejects a promise so the try block unwinds and the finally block runs cleanup.
 */
export interface SignalManager {
  /** Race a promise against the signal — rejects if a signal has been or is received. */
  raceSignal<T>(promise: Promise<T>): Promise<T>;
  /** Whether a signal has been received. */
  readonly signalReceived: boolean;
  /** Remove signal listeners. Call this in the finally block. */
  cleanup(): void;
}

/**
 * Create a signal manager that registers SIGINT/SIGTERM handlers.
 *
 * @param ErrorClass - The error class to throw when a signal is received.
 *   orchestrator.ts passes SignalInterruptError, plan-orchestrator.ts passes PlanSignalInterruptError.
 */
export function createSignalManager(
  ErrorClass: new (signal: string) => Error,
): SignalManager {
  let signalReceived = false;
  let rejectOnSignal: ((err: Error) => void) | undefined;
  const signalPromise = new Promise<never>((_, reject) => {
    rejectOnSignal = reject;
  });
  // Prevent unhandled rejection if signal fires between raceSignal calls
  signalPromise.catch(() => {});

  const signalHandler = (signal: NodeJS.Signals) => {
    if (signalReceived) return;
    signalReceived = true;
    killAllChildProcesses();
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    if (rejectOnSignal) {
      rejectOnSignal(new ErrorClass(signal));
    }
  };

  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);

  return {
    raceSignal<T>(promise: Promise<T>): Promise<T> {
      if (signalReceived) {
        return Promise.reject(new ErrorClass('signal'));
      }
      return Promise.race([promise, signalPromise]);
    },
    get signalReceived() {
      return signalReceived;
    },
    cleanup() {
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
    },
  };
}
