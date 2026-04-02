import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  distributePlan,
  buildDistributionPrompt,
  parseDistributionResponse,
} from '../src/work-distribution.js';

// Mock the claude-cli module so we never actually call the CLI
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

// Use an isolated temp directory to avoid conflicts with other test files
const ISOLATED_TEMP = resolve('.uxreview-temp-work-dist-test');
const ISOLATED_WORK_DIST_PATH = join(ISOLATED_TEMP, 'work-distribution.md');

vi.mock('../src/file-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/file-manager.js')>();
  return {
    ...original,
    getWorkDistributionPath: () => ISOLATED_WORK_DIST_PATH,
  };
});

import { runClaude } from '../src/claude-cli.js';
const mockRunClaude = vi.mocked(runClaude);

const MULTI_SECTION_PLAN = `## Navigation
- Review main nav bar
- Check breadcrumb trail
- Test mobile hamburger menu

## Dashboard
- Review card grid layout
- Check loading states
- Verify empty state handling

## Settings
- Review form layout and validation
- Check save/cancel button placement
- Test error messages

## User Profile
- Review avatar upload flow
- Check field validation
- Test password change flow`;

describe('buildDistributionPrompt', () => {
  it('includes the instance count in the prompt', () => {
    const prompt = buildDistributionPrompt('Some plan', 3);
    expect(prompt).toContain('3 self-contained chunks');
    expect(prompt).toContain('3 chunks');
  });

  it('includes the full plan text', () => {
    const prompt = buildDistributionPrompt(MULTI_SECTION_PLAN, 2);
    expect(prompt).toContain('## Navigation');
    expect(prompt).toContain('## Dashboard');
    expect(prompt).toContain('## Settings');
    expect(prompt).toContain('## User Profile');
  });

  it('specifies the chunk delimiter format', () => {
    const prompt = buildDistributionPrompt('plan', 2);
    expect(prompt).toContain('---CHUNK---');
  });
});

describe('parseDistributionResponse', () => {
  it('parses chunks separated by the delimiter', () => {
    const response = `## Navigation
- Review main nav bar

---CHUNK---

## Dashboard
- Review card grid layout

---CHUNK---

## Settings
- Review form layout`;

    const chunks = parseDistributionResponse(response, 3);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain('Navigation');
    expect(chunks[1]).toContain('Dashboard');
    expect(chunks[2]).toContain('Settings');
  });

  it('trims whitespace from chunks', () => {
    const response = `  chunk one  \n\n---CHUNK---\n\n  chunk two  `;
    const chunks = parseDistributionResponse(response, 2);
    expect(chunks[0]).toBe('chunk one');
    expect(chunks[1]).toBe('chunk two');
  });

  it('throws when chunk count does not match expected', () => {
    const response = `chunk one\n---CHUNK---\nchunk two`;
    expect(() => parseDistributionResponse(response, 3)).toThrow(
      'expected 3 chunks but got 2',
    );
  });

  it('throws when response has no delimiters but expects multiple', () => {
    const response = 'just one block of text';
    expect(() => parseDistributionResponse(response, 2)).toThrow(
      'expected 2 chunks but got 1',
    );
  });

  it('filters out empty chunks from extra delimiters', () => {
    const response = `chunk one\n---CHUNK---\n\n---CHUNK---\nchunk two`;
    // This produces 2 non-empty chunks, not 3
    const chunks = parseDistributionResponse(response, 2);
    expect(chunks).toHaveLength(2);
  });
});

describe('distributePlan', () => {
  beforeEach(() => {
    mkdirSync(ISOLATED_TEMP, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(ISOLATED_TEMP)) {
      rmSync(ISOLATED_TEMP, { recursive: true, force: true });
    }
  });

  it('returns the full plan directly when instanceCount is 1', async () => {
    const result = await distributePlan(MULTI_SECTION_PLAN, 1);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe(MULTI_SECTION_PLAN);
    expect(result.usedClaude).toBe(false);
    expect(mockRunClaude).not.toHaveBeenCalled();
  });

  it('writes work-distribution.md for single instance', async () => {
    await distributePlan(MULTI_SECTION_PLAN, 1);

    expect(existsSync(ISOLATED_WORK_DIST_PATH)).toBe(true);
    const content = readFileSync(ISOLATED_WORK_DIST_PATH, 'utf-8');
    expect(content).toContain('# Work Distribution');
    expect(content).toContain('Single instance');
    expect(content).toContain('no Claude call');
    expect(content).toContain('## Instance 1');
  });

  it('calls Claude to split plan when instanceCount > 1', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: `## Navigation\n- Review main nav bar\n- Check breadcrumb trail\n- Test mobile hamburger menu\n\n---CHUNK---\n\n## Dashboard\n- Review card grid layout\n- Check loading states\n- Verify empty state handling\n\n---CHUNK---\n\n## Settings & User Profile\n- Review form layout and validation\n- Check save/cancel button placement\n- Test error messages\n- Review avatar upload flow\n- Check field validation\n- Test password change flow`,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await distributePlan(MULTI_SECTION_PLAN, 3);

    expect(result.usedClaude).toBe(true);
    expect(result.chunks).toHaveLength(3);
    expect(mockRunClaude).toHaveBeenCalledOnce();

    // Verify the prompt was built correctly
    const callArgs = mockRunClaude.mock.calls[0][0];
    expect(callArgs.prompt).toContain('3 self-contained chunks');
    expect(callArgs.prompt).toContain(MULTI_SECTION_PLAN);
  });

  it('writes work-distribution.md for multiple instances', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: `Chunk A\n---CHUNK---\nChunk B\n---CHUNK---\nChunk C`,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await distributePlan('the plan', 3);

    expect(existsSync(ISOLATED_WORK_DIST_PATH)).toBe(true);
    const content = readFileSync(ISOLATED_WORK_DIST_PATH, 'utf-8');
    expect(content).toContain('# Work Distribution');
    expect(content).toContain('split into 3 chunks via Claude');
    expect(content).toContain('## Instance 1');
    expect(content).toContain('## Instance 2');
    expect(content).toContain('## Instance 3');
    expect(content).toContain('Chunk A');
    expect(content).toContain('Chunk B');
    expect(content).toContain('Chunk C');
  });

  it('returns chunks with correct content', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: `## Navigation\n- nav items\n\n---CHUNK---\n\n## Dashboard\n- dashboard items`,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await distributePlan('plan', 2);

    expect(result.chunks[0]).toContain('Navigation');
    expect(result.chunks[0]).toContain('nav items');
    expect(result.chunks[1]).toContain('Dashboard');
    expect(result.chunks[1]).toContain('dashboard items');
  });

  it('throws when Claude CLI fails', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'API rate limit exceeded',
      exitCode: 1,
      success: false,
    });

    await expect(distributePlan('plan', 3)).rejects.toThrow(
      'Claude CLI failed during work distribution',
    );
    await expect(distributePlan('plan', 3)).rejects.toThrow(
      'API rate limit exceeded',
    );
  });

  it('throws when Claude returns wrong number of chunks', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: `Chunk A\n---CHUNK---\nChunk B`,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    await expect(distributePlan('plan', 3)).rejects.toThrow(
      'expected 3 chunks but got 2',
    );
  });

  it('throws when instanceCount is less than 1', async () => {
    await expect(distributePlan('plan', 0)).rejects.toThrow(
      'Instance count must be at least 1',
    );
  });

  it('handles plan with 2 instances', async () => {
    mockRunClaude.mockResolvedValue({
      stdout: `## Part 1\nFirst half\n\n---CHUNK---\n\n## Part 2\nSecond half`,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await distributePlan('full plan', 2);

    expect(result.chunks).toHaveLength(2);
    expect(result.usedClaude).toBe(true);
  });

  it('preserves original plan text in chunks', async () => {
    const originalSection = '## Navigation\n- Review main nav bar\n- Check breadcrumb trail';
    mockRunClaude.mockResolvedValue({
      stdout: `${originalSection}\n\n---CHUNK---\n\n## Dashboard\n- Cards`,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await distributePlan('plan', 2);

    expect(result.chunks[0]).toBe(originalSection);
  });
});
