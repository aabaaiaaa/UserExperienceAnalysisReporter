import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import {
  buildInstancePrompt,
  runInstanceRounds,
  RoundExecutionConfig,
  InstanceConfig,
} from '../src/instance-manager.js';

const TEST_TEMP_DIR = resolve('.uxreview-temp-round-test');

// Mock the claude-cli module
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

// Mock file-manager to return deterministic paths within our test temp dir
vi.mock('../src/file-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/file-manager.js')>();
  return {
    ...original,
    getInstancePaths: (n: number) => {
      const dir = join(TEST_TEMP_DIR, `instance-${n}`);
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

const BASE_ROUND_CONFIG: RoundExecutionConfig = {
  instanceNumber: 1,
  url: 'https://example.com/app',
  intro: 'This is a test app for reviewing UX.',
  planChunk: '## Navigation\n- Review main nav bar\n- Check breadcrumb trail',
  scope: '## Layout\n- Check spacing consistency\n- Review alignment',
  totalRounds: 2,
  assignedAreas: ['Navigation', 'Dashboard'],
};

describe('buildInstancePrompt - round awareness', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_TEMP_DIR, 'instance-1'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  it('round 1 prompt includes plan chunk and scope but no discovery context', () => {
    const config: InstanceConfig = {
      instanceNumber: 1,
      url: 'https://example.com/app',
      intro: 'Test app context.',
      planChunk: '## Navigation\n- Review main nav bar',
      scope: '## Layout\n- Check spacing consistency',
      round: 1,
    };

    const prompt = buildInstancePrompt(config);

    // Includes plan chunk
    expect(prompt).toContain('## Navigation');
    expect(prompt).toContain('Review main nav bar');

    // Includes scope
    expect(prompt).toContain('## Layout');
    expect(prompt).toContain('Check spacing consistency');

    // Shows round 1
    expect(prompt).toContain('Current round: 1');

    // Does NOT include discovery context since it's round 1
    expect(prompt).not.toContain('Previous Discovery');
    expect(prompt).not.toContain('already been explored');
  });

  it('round 2 prompt includes plan chunk, scope, AND discovery doc', () => {
    // Write a mock discovery doc as if round 1 already ran
    const discoveryPath = join(TEST_TEMP_DIR, 'instance-1', 'discovery.md');
    const discoveryContent = `# Discovery Document - Instance 1

## Round 1

### Navigation Bar
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home
- **Elements Observed**:
  - Main menu links
  - Logo
- **Checked**:
  - Layout consistency
`;
    writeFileSync(discoveryPath, discoveryContent, 'utf-8');

    const config: InstanceConfig = {
      instanceNumber: 1,
      url: 'https://example.com/app',
      intro: 'Test app context.',
      planChunk: '## Navigation\n- Review main nav bar',
      scope: '## Layout\n- Check spacing consistency',
      round: 2,
    };

    const prompt = buildInstancePrompt(config);

    // Includes plan chunk
    expect(prompt).toContain('## Navigation');
    expect(prompt).toContain('Review main nav bar');

    // Includes scope
    expect(prompt).toContain('## Layout');
    expect(prompt).toContain('Check spacing consistency');

    // Shows round 2
    expect(prompt).toContain('Current round: 2');

    // Includes discovery context from round 1
    expect(prompt).toContain('Previous Discovery');
    expect(prompt).toContain('Navigation Bar');
    expect(prompt).toContain('Main menu links');
    expect(prompt).toContain('focus on');
  });

  it('round 2 prompt without existing discovery doc omits discovery context', () => {
    // No discovery file exists
    const config: InstanceConfig = {
      instanceNumber: 1,
      url: 'https://example.com/app',
      intro: 'Test app context.',
      planChunk: '## Navigation\n- Review main nav bar',
      scope: '## Layout\n- Check spacing consistency',
      round: 2,
    };

    const prompt = buildInstancePrompt(config);

    // Still includes plan and scope
    expect(prompt).toContain('## Navigation');
    expect(prompt).toContain('Check spacing consistency');
    expect(prompt).toContain('Current round: 2');

    // No discovery context since file doesn't exist
    expect(prompt).not.toContain('Previous Discovery');
  });
});

describe('runInstanceRounds', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_TEMP_DIR, 'instance-1'), { recursive: true });
    mkdirSync(join(TEST_TEMP_DIR, 'instance-1', 'screenshots'), { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(TEST_TEMP_DIR)) {
      rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
    }
  });

  it('executes rounds sequentially and returns completed status', async () => {
    // Both rounds succeed
    mockRunClaude.mockResolvedValue({
      stdout: 'Analysis complete',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await runInstanceRounds(BASE_ROUND_CONFIG);

    expect(result.instanceNumber).toBe(1);
    expect(result.status).toBe('completed');
    expect(result.completedRounds).toBe(2);
    expect(result.roundResults).toHaveLength(2);
    expect(result.roundResults[0].status).toBe('completed');
    expect(result.roundResults[1].status).toBe('completed');
    expect(result.error).toBeUndefined();
  });

  it('calls runClaude once per round', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await runInstanceRounds(BASE_ROUND_CONFIG);

    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });

  it('round 1 prompt includes plan chunk and scope', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await runInstanceRounds(BASE_ROUND_CONFIG);

    const round1Call = mockRunClaude.mock.calls[0][0];
    expect(round1Call.prompt).toContain('## Navigation');
    expect(round1Call.prompt).toContain('Review main nav bar');
    expect(round1Call.prompt).toContain('## Layout');
    expect(round1Call.prompt).toContain('Check spacing consistency');
    expect(round1Call.prompt).toContain('Current round: 1');
    // Round 1 should NOT have discovery context
    expect(round1Call.prompt).not.toContain('Previous Discovery');
  });

  it('round 2 prompt includes plan chunk, scope, and discovery doc from round 1', async () => {
    const discoveryContent = `# Discovery Document - Instance 1

## Round 1

### Navigation Bar
- **Visited**: 2026-04-02T10:00:00.000Z
- **Navigation Path**: Home
- **Elements Observed**:
  - Main menu links
  - Breadcrumb trail
- **Checked**:
  - Layout consistency
  - Navigation flow
`;

    // Round 1: succeed and write a discovery doc
    mockRunClaude.mockImplementation(async (opts) => {
      if (opts.prompt.includes('Current round: 1')) {
        // Simulate Claude writing the discovery doc during round 1
        const discoveryPath = join(TEST_TEMP_DIR, 'instance-1', 'discovery.md');
        writeFileSync(discoveryPath, discoveryContent, 'utf-8');
      }
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    await runInstanceRounds(BASE_ROUND_CONFIG);

    // Round 2 should include the discovery content
    const round2Call = mockRunClaude.mock.calls[1][0];
    expect(round2Call.prompt).toContain('Current round: 2');
    expect(round2Call.prompt).toContain('## Navigation');
    expect(round2Call.prompt).toContain('Check spacing consistency');
    expect(round2Call.prompt).toContain('Previous Discovery');
    expect(round2Call.prompt).toContain('Navigation Bar');
    expect(round2Call.prompt).toContain('Main menu links');
  });

  it('checkpoint advances round number between rounds', async () => {
    const checkpointPath = join(TEST_TEMP_DIR, 'instance-1', 'checkpoint.json');
    const checkpointSnapshots: Array<{ round: number; calledAt: number }> = [];

    mockRunClaude.mockImplementation(async () => {
      // Read checkpoint at the time this round starts
      if (existsSync(checkpointPath)) {
        const raw = readFileSync(checkpointPath, 'utf-8');
        const cp = JSON.parse(raw);
        checkpointSnapshots.push({ round: cp.currentRound, calledAt: checkpointSnapshots.length + 1 });
      }
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    await runInstanceRounds(BASE_ROUND_CONFIG);

    // Round 1 checkpoint should have currentRound=1
    expect(checkpointSnapshots[0].round).toBe(1);
    // Round 2 checkpoint should have currentRound=2
    expect(checkpointSnapshots[1].round).toBe(2);
  });

  it('checkpoint includes assigned areas', async () => {
    const checkpointPath = join(TEST_TEMP_DIR, 'instance-1', 'checkpoint.json');

    mockRunClaude.mockImplementation(async () => {
      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    await runInstanceRounds(BASE_ROUND_CONFIG);

    // Read the final checkpoint
    const raw = readFileSync(checkpointPath, 'utf-8');
    const cp = JSON.parse(raw);
    expect(cp.assignedAreas).toEqual(['Navigation', 'Dashboard']);
    expect(cp.instanceId).toBe(1);
  });

  it('stops on first failed round and reports error', async () => {
    // Round 1 fails
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'MCP connection error',
      exitCode: 1,
      success: false,
    });

    const result = await runInstanceRounds(BASE_ROUND_CONFIG);

    expect(result.status).toBe('failed');
    expect(result.completedRounds).toBe(0);
    expect(result.roundResults).toHaveLength(1);
    expect(result.roundResults[0].status).toBe('failed');
    expect(result.error).toBe('MCP connection error');
    // Should not have attempted round 2
    expect(mockRunClaude).toHaveBeenCalledTimes(1);
  });

  it('stops if round 2 fails after round 1 succeeds', async () => {
    mockRunClaude
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0, success: true })
      .mockResolvedValueOnce({ stdout: '', stderr: 'Timeout', exitCode: 1, success: false });

    const config: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      totalRounds: 3,
    };

    const result = await runInstanceRounds(config);

    expect(result.status).toBe('failed');
    expect(result.completedRounds).toBe(1);
    expect(result.roundResults).toHaveLength(2);
    expect(result.roundResults[0].status).toBe('completed');
    expect(result.roundResults[1].status).toBe('failed');
    expect(result.error).toBe('Timeout');
    // Should not have attempted round 3
    expect(mockRunClaude).toHaveBeenCalledTimes(2);
  });

  it('handles single round execution', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const config: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      totalRounds: 1,
    };

    const result = await runInstanceRounds(config);

    expect(result.status).toBe('completed');
    expect(result.completedRounds).toBe(1);
    expect(result.roundResults).toHaveLength(1);
    expect(mockRunClaude).toHaveBeenCalledTimes(1);
  });

  it('handles 3 rounds with accumulating discovery', async () => {
    let callCount = 0;

    mockRunClaude.mockImplementation(async (opts) => {
      callCount++;
      const discoveryPath = join(TEST_TEMP_DIR, 'instance-1', 'discovery.md');

      if (opts.prompt.includes('Current round: 1')) {
        writeFileSync(discoveryPath, `# Discovery Document - Instance 1\n\n## Round 1\n\n### Area A\n- **Visited**: 2026-04-02T10:00:00Z\n- **Navigation Path**: Home\n- **Elements Observed**:\n  - Button A\n- **Checked**:\n  - Layout\n`, 'utf-8');
      } else if (opts.prompt.includes('Current round: 2')) {
        // Append round 2 entries
        const existing = readFileSync(discoveryPath, 'utf-8');
        writeFileSync(discoveryPath, existing + `\n## Round 2\n\n### Area B\n- **Visited**: 2026-04-02T10:05:00Z\n- **Navigation Path**: Home → Settings\n- **Elements Observed**:\n  - Form fields\n- **Checked**:\n  - Form usability\n`, 'utf-8');
      }

      return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
    });

    const config: RoundExecutionConfig = {
      ...BASE_ROUND_CONFIG,
      totalRounds: 3,
    };

    const result = await runInstanceRounds(config);

    expect(result.status).toBe('completed');
    expect(result.completedRounds).toBe(3);
    expect(mockRunClaude).toHaveBeenCalledTimes(3);

    // Round 3 prompt should include discovery from rounds 1 and 2
    const round3Call = mockRunClaude.mock.calls[2][0];
    expect(round3Call.prompt).toContain('Current round: 3');
    expect(round3Call.prompt).toContain('Previous Discovery');
    expect(round3Call.prompt).toContain('Area A');
    expect(round3Call.prompt).toContain('Area B');
    expect(round3Call.prompt).toContain('Form fields');
  });

  it('defaults assignedAreas to empty when not provided', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const config: RoundExecutionConfig = {
      instanceNumber: 1,
      url: 'https://example.com',
      intro: 'Test',
      planChunk: 'Test plan',
      scope: 'Test scope',
      totalRounds: 1,
    };

    const result = await runInstanceRounds(config);

    expect(result.status).toBe('completed');

    // Checkpoint should have empty assigned areas
    const checkpointPath = join(TEST_TEMP_DIR, 'instance-1', 'checkpoint.json');
    const raw = readFileSync(checkpointPath, 'utf-8');
    const cp = JSON.parse(raw);
    expect(cp.assignedAreas).toEqual([]);
  });
});
