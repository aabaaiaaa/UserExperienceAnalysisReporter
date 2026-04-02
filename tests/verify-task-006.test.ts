/**
 * Verification script for TASK-006: Work distribution — plan splitting.
 *
 * Scenario 1: Multi-section plan with 3 instances → plan split into 3 chunks
 *             with minimal overlap and full coverage.
 * Scenario 2: Single instance → no Claude call, full plan passed through.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { distributePlan } from '../src/work-distribution.js';

vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

// Use an isolated temp directory to avoid conflicts with other test files
const ISOLATED_TEMP = resolve('.uxreview-temp-verify-006');
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
- Review main navigation bar layout and responsiveness
- Check breadcrumb trail on all sub-pages
- Test mobile hamburger menu open/close animation
- Verify active state indicators

## Dashboard
- Review card grid layout at all breakpoints
- Check loading skeleton states
- Verify empty state messaging and illustration
- Test card interaction hover effects

## Settings Page
- Review form layout and field grouping
- Check inline validation feedback on all fields
- Test save/cancel button placement and states
- Verify success/error toast notifications

## User Profile
- Review avatar upload and crop flow
- Check field validation on profile edit
- Test password change flow with strength meter
- Verify account deletion confirmation dialog`;

describe('TASK-006 Verification', () => {
  beforeEach(() => {
    mkdirSync(ISOLATED_TEMP, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(ISOLATED_TEMP)) {
      rmSync(ISOLATED_TEMP, { recursive: true, force: true });
    }
  });

  it('Scenario 1: 3 instances — plan split into 3 logical chunks with full coverage', async () => {
    // Simulate Claude splitting 4 sections into 3 chunks
    const chunk1 = `## Navigation
- Review main navigation bar layout and responsiveness
- Check breadcrumb trail on all sub-pages
- Test mobile hamburger menu open/close animation
- Verify active state indicators`;

    const chunk2 = `## Dashboard
- Review card grid layout at all breakpoints
- Check loading skeleton states
- Verify empty state messaging and illustration
- Test card interaction hover effects`;

    const chunk3 = `## Settings Page
- Review form layout and field grouping
- Check inline validation feedback on all fields
- Test save/cancel button placement and states
- Verify success/error toast notifications

## User Profile
- Review avatar upload and crop flow
- Check field validation on profile edit
- Test password change flow with strength meter
- Verify account deletion confirmation dialog`;

    mockRunClaude.mockResolvedValue({
      stdout: `${chunk1}\n\n---CHUNK---\n\n${chunk2}\n\n---CHUNK---\n\n${chunk3}`,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await distributePlan(MULTI_SECTION_PLAN, 3);

    // Verify: 3 chunks produced
    expect(result.chunks).toHaveLength(3);
    expect(result.usedClaude).toBe(true);

    // Verify: Claude was called exactly once
    expect(mockRunClaude).toHaveBeenCalledOnce();

    // Verify: full coverage — all 4 sections appear across the 3 chunks
    const allChunksText = result.chunks.join('\n');
    expect(allChunksText).toContain('Navigation');
    expect(allChunksText).toContain('Dashboard');
    expect(allChunksText).toContain('Settings Page');
    expect(allChunksText).toContain('User Profile');

    // Verify: minimal overlap — each section appears in exactly one chunk
    const navChunks = result.chunks.filter((c) => c.includes('## Navigation'));
    const dashChunks = result.chunks.filter((c) => c.includes('## Dashboard'));
    const settingsChunks = result.chunks.filter((c) => c.includes('## Settings Page'));
    const profileChunks = result.chunks.filter((c) => c.includes('## User Profile'));
    expect(navChunks).toHaveLength(1);
    expect(dashChunks).toHaveLength(1);
    expect(settingsChunks).toHaveLength(1);
    expect(profileChunks).toHaveLength(1);

    // Verify: each chunk is self-contained (non-empty)
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk).toContain('-'); // has actual plan items
    }

    // Verify: work-distribution.md written
    expect(existsSync(ISOLATED_WORK_DIST_PATH)).toBe(true);
    const mdContent = readFileSync(ISOLATED_WORK_DIST_PATH, 'utf-8');
    expect(mdContent).toContain('## Instance 1');
    expect(mdContent).toContain('## Instance 2');
    expect(mdContent).toContain('## Instance 3');

    console.log('✓ Scenario 1 PASSED: Plan split into 3 logical chunks with minimal overlap and full coverage');
  });

  it('Scenario 2: 1 instance — no Claude call, full plan passed through', async () => {
    const result = await distributePlan(MULTI_SECTION_PLAN, 1);

    // Verify: no Claude call made
    expect(result.usedClaude).toBe(false);
    expect(mockRunClaude).not.toHaveBeenCalled();

    // Verify: single chunk contains the full plan exactly
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe(MULTI_SECTION_PLAN);

    // Verify: work-distribution.md written with single-instance indicator
    expect(existsSync(ISOLATED_WORK_DIST_PATH)).toBe(true);
    const mdContent = readFileSync(ISOLATED_WORK_DIST_PATH, 'utf-8');
    expect(mdContent).toContain('Single instance');
    expect(mdContent).toContain('no Claude call');
    expect(mdContent).toContain('## Instance 1');
    expect(mdContent).not.toContain('## Instance 2');

    console.log('✓ Scenario 2 PASSED: No Claude call made — full plan passed through directly');
  });
});
