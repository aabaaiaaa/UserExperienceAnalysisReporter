/**
 * Verification script for TASK-007: Claude Code instance spawning and management.
 *
 * Spawns a single Claude Code instance with a mock plan chunk.
 * Confirms the subprocess starts, receives the correct inputs (including scope),
 * and the orchestrator can detect when it completes or fails.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { spawnInstance, buildInstancePrompt, InstanceConfig } from '../src/instance-manager.js';

// Mock the claude-cli module so we never actually call the CLI
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

// Mock file-manager to return deterministic paths
vi.mock('../src/file-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/file-manager.js')>();
  return {
    ...original,
    getInstancePaths: (n: number) => {
      const dir = resolve(`.uxreview-temp-verify-007/instance-${n}`);
      return {
        dir,
        discovery: join(dir, 'discovery.md'),
        checkpoint: join(dir, 'checkpoint.json'),
        report: join(dir, 'report.md'),
        screenshots: join(dir, 'screenshots'),
      };
    },
  };
});

import { runClaude } from '../src/claude-cli.js';
const mockRunClaude = vi.mocked(runClaude);

const MOCK_PLAN_CHUNK = `## Navigation
- Review main navigation bar layout and responsiveness
- Check breadcrumb trail on all sub-pages
- Test mobile hamburger menu open/close animation`;

const MOCK_INTRO = `This is a web-based project management tool.
Login at the URL with username: test@example.com, password: test123.
The app has a sidebar navigation, a main dashboard, and settings pages.`;

const MOCK_SCOPE = `## Layout Consistency
- Check spacing and alignment
- Verify consistent margins

## Navigation Flow
- Ensure no dead-end pages
- Check breadcrumb behavior`;

const TEST_CONFIG: InstanceConfig = {
  instanceNumber: 1,
  url: 'https://testapp.example.com',
  intro: MOCK_INTRO,
  planChunk: MOCK_PLAN_CHUNK,
  scope: MOCK_SCOPE,
};

describe('TASK-007 Verification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Verify: subprocess starts and receives correct inputs including scope', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'Analysis complete. Found 3 UX issues.',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    // Spawn instance
    const state = await spawnInstance(TEST_CONFIG);

    // 1. Verify: runClaude was called (subprocess was started)
    expect(mockRunClaude).toHaveBeenCalledOnce();
    const callArgs = mockRunClaude.mock.calls[0][0];

    // 2. Verify: prompt contains the target URL
    expect(callArgs.prompt).toContain('https://testapp.example.com');

    // 3. Verify: prompt contains the full intro document
    expect(callArgs.prompt).toContain('project management tool');
    expect(callArgs.prompt).toContain('test@example.com');

    // 4. Verify: prompt contains the assigned plan chunk
    expect(callArgs.prompt).toContain('## Navigation');
    expect(callArgs.prompt).toContain('Review main navigation bar');
    expect(callArgs.prompt).toContain('Check breadcrumb trail');
    expect(callArgs.prompt).toContain('mobile hamburger menu');

    // 5. Verify: prompt contains the evaluation scope
    expect(callArgs.prompt).toContain('## Layout Consistency');
    expect(callArgs.prompt).toContain('Check spacing and alignment');
    expect(callArgs.prompt).toContain('## Navigation Flow');
    expect(callArgs.prompt).toContain('Ensure no dead-end pages');

    // 6. Verify: prompt contains instructions for all three output files
    expect(callArgs.prompt).toContain('discovery.md');
    expect(callArgs.prompt).toContain('checkpoint.json');
    expect(callArgs.prompt).toContain('report.md');
    expect(callArgs.prompt).toContain('screenshots');

    // 7. Verify: prompt contains instance-scoped ID format
    expect(callArgs.prompt).toContain('I1-UXR-');

    // 8. Verify: working directory is set to the instance directory
    expect(callArgs.cwd).toContain('instance-1');

    // 9. Verify: timeout and extra args are configured
    expect(callArgs.timeout).toBe(30 * 60 * 1000);
    expect(callArgs.extraArgs).toBeDefined();
    expect(callArgs.extraArgs).toContain('--allowedTools');

    console.log('✓ Subprocess started and received correct inputs (URL, intro, plan chunk, scope, file instructions)');
  });

  it('Verify: orchestrator detects successful completion', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'Analysis complete. Found 3 UX issues.',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const state = await spawnInstance(TEST_CONFIG);

    // Verify: state indicates completion
    expect(state.status).toBe('completed');
    expect(state.instanceNumber).toBe(1);
    expect(state.result).toBeDefined();
    expect(state.result!.success).toBe(true);
    expect(state.result!.exitCode).toBe(0);
    expect(state.error).toBeUndefined();

    console.log('✓ Orchestrator detected successful completion');
  });

  it('Verify: orchestrator detects failure (non-zero exit)', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'partial output before crash',
      stderr: 'Error: Playwright MCP connection lost',
      exitCode: 1,
      success: false,
    });

    const state = await spawnInstance(TEST_CONFIG);

    // Verify: state indicates failure with error details
    expect(state.status).toBe('failed');
    expect(state.instanceNumber).toBe(1);
    expect(state.result).toBeDefined();
    expect(state.result!.success).toBe(false);
    expect(state.error).toBe('Error: Playwright MCP connection lost');

    console.log('✓ Orchestrator detected failure (non-zero exit code with error message)');
  });

  it('Verify: orchestrator detects failure (spawn error)', async () => {
    mockRunClaude.mockRejectedValue(new Error('Failed to spawn Claude Code CLI: ENOENT: claude not found'));

    const state = await spawnInstance(TEST_CONFIG);

    // Verify: state indicates failure from spawn error
    expect(state.status).toBe('failed');
    expect(state.instanceNumber).toBe(1);
    expect(state.result).toBeUndefined();
    expect(state.error).toContain('ENOENT');
    expect(state.error).toContain('claude not found');

    console.log('✓ Orchestrator detected failure (subprocess spawn error)');
  });
});
