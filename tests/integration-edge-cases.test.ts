import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// --- Test-isolated directory structure ---
const TEST_BASE = resolve('.uxreview-integ-edge-test');
const TEMP_DIR = join(TEST_BASE, '.uxreview-temp');
const OUTPUT_DIR = join(TEST_BASE, 'output');

function testInstanceDir(n: number) {
  return join(TEMP_DIR, `instance-${n}`);
}

function testInstancePaths(n: number) {
  const dir = testInstanceDir(n);
  return {
    dir,
    discovery: join(dir, 'discovery.md'),
    checkpoint: join(dir, 'checkpoint.json'),
    report: join(dir, 'report.md'),
    screenshots: join(dir, 'screenshots'),
  };
}

// --- Mocks ---

vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

vi.mock('../src/file-manager.js', () => ({
  getTempDir: () => TEMP_DIR,
  getInstanceDir: (n: number) => testInstanceDir(n),
  getInstancePaths: (n: number) => testInstancePaths(n),
  getWorkDistributionPath: () => join(TEMP_DIR, 'work-distribution.md'),
  initWorkspace: vi.fn(),
  initTempDir: vi.fn(),
  initOutputDir: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

const mockProgressDisplay = {
  start: vi.fn(),
  stop: vi.fn(),
  markRunning: vi.fn(),
  markCompleted: vi.fn(),
  markFailed: vi.fn(),
  markRetrying: vi.fn(),
  markPermanentlyFailed: vi.fn(),
  markRoundComplete: vi.fn(),
  markRateLimited: vi.fn(),
  startConsolidation: vi.fn(),
  completeConsolidation: vi.fn(),
  renderToTerminal: vi.fn(),
  updateProgress: vi.fn(),
};

vi.mock('../src/progress-display.js', () => ({
  ProgressDisplay: vi.fn().mockImplementation(() => mockProgressDisplay),
}));

vi.mock('../src/rate-limit.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/rate-limit.js')>();
  return {
    ...original,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

// --- Imports (after mocks are declared) ---
import { runClaude } from '../src/claude-cli.js';
import { initWorkspace } from '../src/file-manager.js';
import { orchestrate } from '../src/orchestrator.js';
import { parseArgs, resolveTextOrFile, ParsedArgs } from '../src/cli.js';
import { DEFAULT_SCOPE } from '../src/default-scope.js';
import { distributePlan } from '../src/work-distribution.js';
import { extractAreasFromPlanChunk } from '../src/orchestrator.js';

const mockRunClaude = vi.mocked(runClaude);
const mockInitWorkspace = vi.mocked(initWorkspace);

// --- Mock data ---

const SINGLE_AREA_PLAN = `## Settings
- Check form validation
- Verify save confirmation
- Test theme switching`;

const MOCK_SINGLE_AREA_DISCOVERY = `# Discovery Document - Instance 1

## Round 1

### Settings Page
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home → Settings
- **Elements Observed**:
  - Form fields
  - Save button
  - Theme toggle
- **Checked**:
  - Form usability
  - Validation feedback
`;

const MOCK_SINGLE_AREA_REPORT = `# UX Report - Instance 1

## I1-UXR-001: Save button lacks confirmation feedback

- **UI Area**: Settings
- **Severity**: minor
- **Description**: Clicking save shows no confirmation
- **Suggestion**: Add a success toast notification
- **Screenshot**: I1-UXR-001.png
`;

const MOCK_CONSOLIDATED_DISCOVERY = `# Settings

- Form fields
  - Checked: Form usability, Validation feedback
- Save button
  - Checked: Form usability
- Theme toggle
  - Checked: Form usability`;

const DUMMY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- Helpers ---

function createTestDirs(instanceCount = 1) {
  mkdirSync(TEMP_DIR, { recursive: true });
  for (let i = 1; i <= instanceCount; i++) {
    const paths = testInstancePaths(i);
    mkdirSync(paths.dir, { recursive: true });
    mkdirSync(paths.screenshots, { recursive: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'screenshots'), { recursive: true });
}

function cleanTestDirs() {
  if (existsSync(TEST_BASE)) {
    rmSync(TEST_BASE, { recursive: true, force: true });
  }
}

function makeArgs(overrides?: Partial<ParsedArgs>): ParsedArgs {
  return {
    url: 'https://example.com/app',
    intro: 'Test app intro text.',
    plan: SINGLE_AREA_PLAN,
    scope: DEFAULT_SCOPE,
    instances: 1,
    rounds: 1,
    output: OUTPUT_DIR,
    keepTemp: false,
    append: false,
    dryRun: false,
    verbose: false,
    maxRetries: 3,
    instanceTimeout: 30,
    rateLimitRetries: 10,
    suppressOpen: true,
    ...overrides,
  };
}

function writeMockSingleAreaOutput(instanceNumber: number) {
  const paths = testInstancePaths(instanceNumber);
  writeFileSync(paths.discovery, MOCK_SINGLE_AREA_DISCOVERY, 'utf-8');
  writeFileSync(paths.report, MOCK_SINGLE_AREA_REPORT.replace(/I1/g, `I${instanceNumber}`), 'utf-8');
  writeFileSync(join(paths.screenshots, `I${instanceNumber}-UXR-001.png`), DUMMY_PNG);
}

function setupSingleAreaMock() {
  mockRunClaude.mockImplementation(async (options) => {
    const prompt = options.prompt;

    if (prompt.includes('You are a UX analyst')) {
      writeMockSingleAreaOutput(1);
      return { stdout: 'Analysis complete', stderr: '', exitCode: 0, success: true };
    }

    if (prompt.includes('UX report organizer')) {
      return { stdout: 'NO_DEPENDENCIES', stderr: '', exitCode: 0, success: true };
    }

    if (prompt.includes('document consolidation assistant')) {
      return { stdout: MOCK_CONSOLIDATED_DISCOVERY, stderr: '', exitCode: 0, success: true };
    }

    return { stdout: '', stderr: 'Unexpected call', exitCode: 1, success: false };
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('Integration: Edge cases and input handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTestDirs();
    mockInitWorkspace.mockReturnValue({
      tempDir: TEMP_DIR,
      instanceDirs: [testInstanceDir(1)],
      outputDir: OUTPUT_DIR,
    });
  });

  afterEach(() => {
    cleanTestDirs();
  });

  // ---------------------------------------------------------------------------
  // Inline text vs file paths for intro/plan/scope
  // ---------------------------------------------------------------------------

  describe('inline text vs file paths for intro, plan, and scope', () => {
    it('resolves intro from a file path when the file exists', () => {
      const introFile = join(TEST_BASE, 'intro.md');
      writeFileSync(introFile, 'Introduction loaded from file', 'utf-8');

      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', introFile,
        '--plan', 'Some plan text',
      ]);

      expect(args.intro).toBe('Introduction loaded from file');
    });

    it('uses inline text for intro when value is not a file path', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'This is inline intro text',
        '--plan', 'Some plan text',
      ]);

      expect(args.intro).toBe('This is inline intro text');
    });

    it('resolves plan from a file path when the file exists', () => {
      const planFile = join(TEST_BASE, 'plan.md');
      writeFileSync(planFile, '## Areas\n- Check everything', 'utf-8');

      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', planFile,
      ]);

      expect(args.plan).toBe('## Areas\n- Check everything');
    });

    it('uses inline text for plan when value is not a file path', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'Review the dashboard and settings page',
      ]);

      expect(args.plan).toBe('Review the dashboard and settings page');
    });

    it('resolves scope from a file path when the file exists', () => {
      const scopeFile = join(TEST_BASE, 'custom-scope.md');
      writeFileSync(scopeFile, 'Only check accessibility and forms', 'utf-8');

      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
        '--scope', scopeFile,
      ]);

      expect(args.scope).toBe('Only check accessibility and forms');
    });

    it('uses inline text for scope when value is not a file path', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
        '--scope', 'Check button consistency only',
      ]);

      expect(args.scope).toBe('Check button consistency only');
    });

    it('resolveTextOrFile returns file content for existing file', () => {
      const filePath = join(TEST_BASE, 'resolve-test.txt');
      writeFileSync(filePath, 'content from file', 'utf-8');

      expect(resolveTextOrFile(filePath)).toBe('content from file');
    });

    it('resolveTextOrFile returns value as-is for non-existent path', () => {
      expect(resolveTextOrFile('just some inline text')).toBe('just some inline text');
    });

    it('passes file-loaded intro and plan to the instance prompt', async () => {
      const introFile = join(TEST_BASE, 'intro-for-prompt.md');
      const planFile = join(TEST_BASE, 'plan-for-prompt.md');
      writeFileSync(introFile, 'Detailed intro from file for instance', 'utf-8');
      writeFileSync(planFile, '## Navigation\n- Check nav bar\n\n## Settings\n- Check forms', 'utf-8');

      setupSingleAreaMock();

      const args = makeArgs({
        intro: readFileSync(introFile, 'utf-8'),
        plan: readFileSync(planFile, 'utf-8'),
      });
      await orchestrate(args);

      const instanceCall = mockRunClaude.mock.calls[0][0];
      expect(instanceCall.prompt).toContain('Detailed intro from file for instance');
      expect(instanceCall.prompt).toContain('## Navigation');
      expect(instanceCall.prompt).toContain('## Settings');
    });
  });

  // ---------------------------------------------------------------------------
  // Default scope when --scope is omitted
  // ---------------------------------------------------------------------------

  describe('default scope when --scope is omitted', () => {
    it('parseArgs uses DEFAULT_SCOPE when --scope is not provided', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.scope).toBe(DEFAULT_SCOPE);
      expect(args.scope).toContain('Layout Consistency and Spacing');
      expect(args.scope).toContain('Navigation Flow and Discoverability');
      expect(args.scope).toContain('Accessibility Basics');
    });

    it('default scope is included in instance prompt when --scope omitted', async () => {
      setupSingleAreaMock();

      const args = makeArgs(); // uses DEFAULT_SCOPE
      await orchestrate(args);

      const instanceCall = mockRunClaude.mock.calls[0][0];
      expect(instanceCall.prompt).toContain('Layout Consistency and Spacing');
      expect(instanceCall.prompt).toContain('Form Usability and Validation Feedback');
      expect(instanceCall.prompt).toContain('Terminology and Labeling Consistency');
    });
  });

  // ---------------------------------------------------------------------------
  // --show-default-scope output
  // ---------------------------------------------------------------------------

  describe('--show-default-scope output', () => {
    it('prints default scope to stdout and exits with code 0', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      try {
        parseArgs(['--show-default-scope']);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(consoleSpy).toHaveBeenCalledWith(DEFAULT_SCOPE);
      expect(exitSpy).toHaveBeenCalledWith(0);

      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('--show-default-scope does not require other args', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      // Should not throw validation errors about missing --url, --intro, --plan
      try {
        parseArgs(['--show-default-scope']);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      // The exit should be code 0 (not error exit)
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(consoleSpy).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Single-area plan
  // ---------------------------------------------------------------------------

  describe('single-area plan', () => {
    it('extractAreasFromPlanChunk extracts a single area from a plan with one heading', () => {
      const areas = extractAreasFromPlanChunk(SINGLE_AREA_PLAN);
      expect(areas).toEqual(['Settings']);
    });

    it('orchestrator works correctly with a single-area plan', async () => {
      setupSingleAreaMock();

      const args = makeArgs({ plan: SINGLE_AREA_PLAN });
      await orchestrate(args);

      // Instance prompt should contain the single area
      const instanceCall = mockRunClaude.mock.calls[0][0];
      expect(instanceCall.prompt).toContain('## Settings');
      expect(instanceCall.prompt).toContain('Check form validation');

      // Final report should be produced
      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
      const reportContent = readFileSync(reportPath, 'utf-8');
      expect(reportContent).toContain('UXR-001');
      expect(reportContent).toContain('Settings');
    });

    it('checkpoint reflects the single assigned area', async () => {
      setupSingleAreaMock();

      const args = makeArgs({ plan: SINGLE_AREA_PLAN });
      await orchestrate(args);

      const cpPath = testInstancePaths(1).checkpoint;
      const cp = JSON.parse(readFileSync(cpPath, 'utf-8'));
      expect(cp.assignedAreas).toEqual(['Settings']);
      expect(cp.areas).toHaveLength(1);
    });

    it('extractAreasFromPlanChunk falls back to list items when no headings', () => {
      const listPlan = `- Review navigation\n- Check forms\n- Test accessibility`;
      const areas = extractAreasFromPlanChunk(listPlan);
      expect(areas).toEqual(['Review navigation', 'Check forms', 'Test accessibility']);
    });

    it('extractAreasFromPlanChunk returns generic fallback for plain text', () => {
      const plainPlan = 'Just review the entire application thoroughly';
      const areas = extractAreasFromPlanChunk(plainPlan);
      expect(areas).toEqual(['Full review']);
    });
  });

  // ---------------------------------------------------------------------------
  // Single instance skips work distribution
  // ---------------------------------------------------------------------------

  describe('single instance skips work distribution', () => {
    it('distributePlan with 1 instance skips Claude call', async () => {
      const plan = '## Nav\n- Check links\n\n## Dashboard\n- Check cards';
      const result = await distributePlan(plan, 1);

      expect(result.usedClaude).toBe(false);
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]).toBe(plan);
      expect(mockRunClaude).not.toHaveBeenCalled();
    });

    it('work-distribution.md indicates single instance passthrough', async () => {
      await distributePlan(SINGLE_AREA_PLAN, 1);

      const wdPath = join(TEMP_DIR, 'work-distribution.md');
      expect(existsSync(wdPath)).toBe(true);
      const content = readFileSync(wdPath, 'utf-8');
      expect(content).toContain('Single instance');
      expect(content).toContain('no Claude call');
    });

    it('full pipeline with 1 instance never calls Claude for work distribution', async () => {
      setupSingleAreaMock();

      const args = makeArgs({ instances: 1 });
      await orchestrate(args);

      // No work distribution call — only analysis, hierarchy, and discovery consolidation
      const workDistCalls = mockRunClaude.mock.calls.filter(
        (call) => call[0].prompt.includes('work distribution'),
      );
      expect(workDistCalls).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // All instances fail
  // ---------------------------------------------------------------------------

  describe('all instances fail', () => {
    it('produces output files even when the single instance fails permanently', async () => {
      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('You are a UX analyst')) {
          return { stdout: '', stderr: 'Total failure', exitCode: 1, success: false };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: '', stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      const args = makeArgs();
      await orchestrate(args);

      // Instance should be permanently failed
      expect(mockProgressDisplay.markPermanentlyFailed).toHaveBeenCalledWith(1, 'Total failure');
      expect(mockProgressDisplay.markCompleted).not.toHaveBeenCalled();

      // Output should still be written (even if empty)
      // Single instance skips consolidation display but still produces output
      expect(mockProgressDisplay.completeConsolidation).toHaveBeenCalledTimes(1);

      const reportPath = join(OUTPUT_DIR, 'report.md');
      expect(existsSync(reportPath)).toBe(true);
    });

    it('produces output when all multiple instances fail permanently', async () => {
      createTestDirs(3);
      mockInitWorkspace.mockReturnValue({
        tempDir: TEMP_DIR,
        instanceDirs: [testInstanceDir(1), testInstanceDir(2), testInstanceDir(3)],
        outputDir: OUTPUT_DIR,
      });

      mockRunClaude.mockImplementation(async (options) => {
        const prompt = options.prompt;

        if (prompt.includes('work distribution')) {
          return {
            stdout: `## Nav\n- Check nav\n---CHUNK---\n## Dashboard\n- Check cards\n---CHUNK---\n## Settings\n- Check forms`,
            stderr: '',
            exitCode: 0,
            success: true,
          };
        }
        if (prompt.includes('You are a UX analyst')) {
          return { stdout: '', stderr: 'All instances fail', exitCode: 1, success: false };
        }
        if (prompt.includes('document consolidation assistant')) {
          return { stdout: '', stderr: '', exitCode: 0, success: true };
        }
        return { stdout: '', stderr: '', exitCode: 0, success: true };
      });

      const args = makeArgs({ instances: 3 });
      await orchestrate(args);

      // All 3 instances should be permanently failed
      expect(mockProgressDisplay.markPermanentlyFailed).toHaveBeenCalledTimes(3);

      // Consolidation should still complete
      expect(mockProgressDisplay.startConsolidation).toHaveBeenCalledTimes(1);
      expect(mockProgressDisplay.completeConsolidation).toHaveBeenCalledTimes(1);

      // Report file should exist
      expect(existsSync(join(OUTPUT_DIR, 'report.md'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Missing optional params use defaults
  // ---------------------------------------------------------------------------

  describe('missing optional params use defaults', () => {
    it('instances defaults to 1 when not provided', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.instances).toBe(0);
    });

    it('rounds defaults to 1 when not provided', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.rounds).toBe(1);
    });

    it('output defaults to ./uxreview-output when not provided', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.output).toBe('./uxreview-output');
    });

    it('scope defaults to DEFAULT_SCOPE when not provided', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.scope).toBe(DEFAULT_SCOPE);
    });

    it('all defaults together produce a valid config for orchestration', async () => {
      setupSingleAreaMock();

      // Parse with only required args, then override output for test isolation
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'Test app intro',
        '--plan', SINGLE_AREA_PLAN,
      ]);
      args.output = OUTPUT_DIR; // redirect for test

      await orchestrate(args);

      expect(mockProgressDisplay.start).toHaveBeenCalledTimes(1);
      expect(mockProgressDisplay.stop).toHaveBeenCalledTimes(2);
      expect(existsSync(join(OUTPUT_DIR, 'report.html'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid URL
  // ---------------------------------------------------------------------------

  describe('invalid URL handling', () => {
    it('rejects non-http/https URL', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs([
          '--url', 'ftp://example.com',
          '--intro', 'intro',
          '--plan', 'plan',
        ]);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'));

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('rejects malformed URL', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs([
          '--url', 'not-a-url',
          '--intro', 'intro',
          '--plan', 'plan',
        ]);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'));

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('accepts valid http URL', () => {
      const args = parseArgs([
        '--url', 'http://localhost:3000',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.url).toBe('http://localhost:3000');
    });

    it('accepts valid https URL', () => {
      const args = parseArgs([
        '--url', 'https://myapp.example.com/dashboard',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.url).toBe('https://myapp.example.com/dashboard');
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid instance and round counts
  // ---------------------------------------------------------------------------

  describe('invalid instance and round counts', () => {
    it('rejects zero instances', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs([
          '--url', 'https://example.com',
          '--intro', 'intro',
          '--plan', 'plan',
          '--instances', '0',
        ]);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--instances must be a positive integer'));

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('rejects negative instances', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs([
          '--url', 'https://example.com',
          '--intro', 'intro',
          '--plan', 'plan',
          '--instances', '-3',
        ]);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('rejects non-integer instances', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs([
          '--url', 'https://example.com',
          '--intro', 'intro',
          '--plan', 'plan',
          '--instances', '2.5',
        ]);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('rejects non-numeric instances', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs([
          '--url', 'https://example.com',
          '--intro', 'intro',
          '--plan', 'plan',
          '--instances', 'abc',
        ]);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('rejects zero rounds', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs([
          '--url', 'https://example.com',
          '--intro', 'intro',
          '--plan', 'plan',
          '--rounds', '0',
        ]);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--rounds must be a positive integer'));

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('rejects negative rounds', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs([
          '--url', 'https://example.com',
          '--intro', 'intro',
          '--plan', 'plan',
          '--rounds', '-1',
        ]);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('accepts valid positive integer instances and rounds', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
        '--instances', '5',
        '--rounds', '3',
      ]);

      expect(args.instances).toBe(5);
      expect(args.rounds).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Custom output directory
  // ---------------------------------------------------------------------------

  describe('custom output directory', () => {
    it('parseArgs accepts custom output directory', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
        '--output', '/tmp/custom-output',
      ]);

      expect(args.output).toBe('/tmp/custom-output');
    });
  });

  // ---------------------------------------------------------------------------
  // extractAreasFromPlanChunk edge cases
  // ---------------------------------------------------------------------------

  describe('extractAreasFromPlanChunk edge cases', () => {
    it('extracts from h1 headings when no h2 headings present', () => {
      const plan = '# Navigation\n- Check links\n\n# Settings\n- Check forms';
      const areas = extractAreasFromPlanChunk(plan);
      expect(areas).toEqual(['Navigation', 'Settings']);
    });

    it('prefers h2 headings over h1 headings', () => {
      const plan = '# Main\n\n## Navigation\n- Check links\n\n## Settings\n- Check forms';
      const areas = extractAreasFromPlanChunk(plan);
      expect(areas).toEqual(['Navigation', 'Settings']);
    });

    it('handles empty plan with generic fallback', () => {
      const areas = extractAreasFromPlanChunk('');
      expect(areas).toEqual(['Full review']);
    });

    it('handles asterisk list items', () => {
      const plan = '* Check navigation\n* Check forms\n* Check accessibility';
      const areas = extractAreasFromPlanChunk(plan);
      expect(areas).toEqual(['Check navigation', 'Check forms', 'Check accessibility']);
    });
  });

  // ---------------------------------------------------------------------------
  // Missing required params
  // ---------------------------------------------------------------------------

  describe('missing required params', () => {
    it('exits with error when --url is missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs(['--intro', 'intro', '--plan', 'plan']);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--url is required'));

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('exits with error when --intro is missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs(['--url', 'https://example.com', '--plan', 'plan']);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--intro is required'));

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('exits with error when --plan is missing', () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        parseArgs(['--url', 'https://example.com', '--intro', 'intro']);
      } catch (e: any) {
        expect(e.message).toBe('process.exit called');
      }

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--plan is required'));

      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // --keep-temp flag
  // ---------------------------------------------------------------------------

  describe('--keep-temp flag', () => {
    it('parseArgs defaults keepTemp to false when --keep-temp is not provided', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.keepTemp).toBe(false);
    });

    it('parseArgs sets keepTemp to true when --keep-temp is provided', () => {
      const args = parseArgs([
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
        '--keep-temp',
      ]);

      expect(args.keepTemp).toBe(true);
    });

    it('--keep-temp can appear anywhere in the argument list', () => {
      const args = parseArgs([
        '--keep-temp',
        '--url', 'https://example.com',
        '--intro', 'intro',
        '--plan', 'plan',
      ]);

      expect(args.keepTemp).toBe(true);
    });
  });
});
