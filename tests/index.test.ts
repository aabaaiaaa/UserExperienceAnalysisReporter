import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock cli module
vi.mock('../src/cli.js', () => ({
  parseArgs: vi.fn().mockReturnValue({
    url: 'https://example.com',
    intro: 'test',
    plan: 'test',
    output: './out',
    instances: 1,
    rounds: 1,
    keepTemp: false,
  }),
  detectSubcommand: vi.fn().mockReturnValue('main'),
  parsePlanArgs: vi.fn().mockReturnValue({
    url: 'https://example.com',
    output: './out',
    instances: 1,
    rounds: 1,
  }),
}));

// Mock orchestrator — preserve real error classes, mock the function
vi.mock('../src/orchestrator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/orchestrator.js')>();
  return {
    ...actual,
    orchestrate: vi.fn(),
  };
});

// Mock plan-orchestrator — preserve real error classes, mock the function
vi.mock('../src/plan-orchestrator.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/plan-orchestrator.js')>();
  return {
    ...actual,
    runPlanDiscovery: vi.fn(),
  };
});

describe('index.ts entry point', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('main subcommand (orchestrate)', () => {
    it('silently returns when orchestrate rejects with SignalInterruptError', async () => {
      const { detectSubcommand } = await import('../src/cli.js');
      const { orchestrate, SignalInterruptError } = await import('../src/orchestrator.js');

      vi.mocked(detectSubcommand).mockReturnValue('main');
      vi.mocked(orchestrate).mockRejectedValue(new SignalInterruptError('SIGINT'));

      await import('../src/index.js');

      // Allow the microtask / catch handler to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Fatal error'),
        expect.anything(),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('prints fatal error and exits when orchestrate rejects with regular Error', async () => {
      const { detectSubcommand } = await import('../src/cli.js');
      const { orchestrate } = await import('../src/orchestrator.js');

      vi.mocked(detectSubcommand).mockReturnValue('main');
      vi.mocked(orchestrate).mockRejectedValue(new Error('something went wrong'));

      await import('../src/index.js');

      // Allow the microtask / catch handler to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith('Fatal error:', 'something went wrong');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('prints fatal error with string coercion for non-Error rejections', async () => {
      const { detectSubcommand } = await import('../src/cli.js');
      const { orchestrate } = await import('../src/orchestrator.js');

      vi.mocked(detectSubcommand).mockReturnValue('main');
      vi.mocked(orchestrate).mockRejectedValue('raw string error');

      await import('../src/index.js');

      // Allow the microtask / catch handler to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith('Fatal error:', 'raw string error');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('plan subcommand (runPlanDiscovery)', () => {
    it('silently returns when runPlanDiscovery rejects with PlanSignalInterruptError', async () => {
      const { detectSubcommand } = await import('../src/cli.js');
      const { runPlanDiscovery, PlanSignalInterruptError } = await import('../src/plan-orchestrator.js');

      vi.mocked(detectSubcommand).mockReturnValue('plan');
      vi.mocked(runPlanDiscovery).mockRejectedValue(new PlanSignalInterruptError('SIGTERM'));

      await import('../src/index.js');

      // Allow the microtask / catch handler to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Fatal error'),
        expect.anything(),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('prints fatal error and exits when runPlanDiscovery rejects with regular Error', async () => {
      const { detectSubcommand } = await import('../src/cli.js');
      const { runPlanDiscovery } = await import('../src/plan-orchestrator.js');

      vi.mocked(detectSubcommand).mockReturnValue('plan');
      vi.mocked(runPlanDiscovery).mockRejectedValue(new Error('plan failed'));

      await import('../src/index.js');

      // Allow the microtask / catch handler to run
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith('Fatal error:', 'plan failed');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
