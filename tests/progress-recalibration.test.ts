import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const TEST_TEMP_DIR = resolve('.uxreview-temp-recalibration-test');

// Mock file-manager to use our test directory
vi.mock('../src/file-manager.js', () => ({
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
  getInstanceDir: (n: number) => join(TEST_TEMP_DIR, `instance-${n}`),
  getTempDir: () => TEST_TEMP_DIR,
}));

// Mock the claude-cli module
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

import { runClaude } from '../src/claude-cli.js';
import { runInstanceRounds, RoundExecutionConfig } from '../src/instance-manager.js';
import { ProgressDisplay } from '../src/progress-display.js';
import { Checkpoint } from '../src/checkpoint.js';
import { appendDiscoveryRound, DiscoveryRound, extractDiscoveryItems } from '../src/discovery.js';

const mockRunClaude = vi.mocked(runClaude);

function ensureInstanceDir(instanceNumber: number): string {
  const dir = join(TEST_TEMP_DIR, `instance-${instanceNumber}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  return dir;
}

function writeCheckpointFile(instanceNumber: number, checkpoint: Checkpoint): void {
  const dir = ensureInstanceDir(instanceNumber);
  writeFileSync(join(dir, 'checkpoint.json'), JSON.stringify(checkpoint, null, 2), 'utf-8');
}

function readCheckpointFile(instanceNumber: number): Checkpoint | null {
  const path = join(TEST_TEMP_DIR, `instance-${instanceNumber}`, 'checkpoint.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

beforeEach(() => {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEST_TEMP_DIR)) {
    rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  }
});

describe('Progress bar scale recalibration', () => {
  describe('round 1 uses plan items for progress', () => {
    it('round 1 checkpoint contains the original plan areas', async () => {
      ensureInstanceDir(1);

      mockRunClaude.mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        success: true,
      });

      const config: RoundExecutionConfig = {
        instanceNumber: 1,
        url: 'https://example.com',
        intro: 'Test app',
        planChunk: 'Review nav and dashboard',
        scope: 'Check layout',
        totalRounds: 1,
        assignedAreas: ['Navigation', 'Dashboard', 'Settings'],
      };

      // Capture the checkpoint written before the Claude call
      let round1Checkpoint: Checkpoint | null = null;
      mockRunClaude.mockImplementation(async () => {
        round1Checkpoint = readCheckpointFile(1);
        return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
      });

      await runInstanceRounds(config);

      // Round 1 checkpoint should have the plan areas
      expect(round1Checkpoint).not.toBeNull();
      expect(round1Checkpoint!.currentRound).toBe(1);
      expect(round1Checkpoint!.areas).toHaveLength(3);
      expect(round1Checkpoint!.areas.map((a) => a.name)).toEqual([
        'Navigation',
        'Dashboard',
        'Settings',
      ]);
    });

    it('progress display shows plan area count in round 1', () => {
      const display = new ProgressDisplay([1], 2);

      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Navigation', 'Dashboard', 'Settings'],
        currentRound: 1,
        areas: [
          { name: 'Navigation', status: 'complete' },
          { name: 'Dashboard', status: 'in-progress' },
          { name: 'Settings', status: 'not-started' },
        ],
        lastAction: 'Reviewing Dashboard',
        timestamp: '2026-04-02T10:00:00Z',
      });

      display.updateProgress(1, 1, 1, 3, 0);
      const p = display.getProgress(1);
      expect(p!.totalItems).toBe(3);
      expect(p!.completedItems).toBe(1);
      expect(p!.currentRound).toBe(1);
    });
  });

  describe('round 2 recalibrates to discovery doc items', () => {
    it('round 2 checkpoint contains discovery items instead of plan areas', async () => {
      ensureInstanceDir(1);

      const config: RoundExecutionConfig = {
        instanceNumber: 1,
        url: 'https://example.com',
        intro: 'Test app',
        planChunk: 'Review nav and dashboard',
        scope: 'Check layout',
        totalRounds: 2,
        assignedAreas: ['Navigation', 'Dashboard'],
      };

      let round2Checkpoint: Checkpoint | null = null;

      mockRunClaude.mockImplementation(async (opts) => {
        if (opts.prompt.includes('Current round: 1')) {
          // Simulate Claude writing a discovery doc during round 1
          const round1: DiscoveryRound = {
            roundNumber: 1,
            entries: [
              {
                area: 'Navigation',
                visitedAt: '2026-04-02T10:00:00Z',
                navigationPath: 'Home',
                elementsObserved: [
                  'Main menu links',
                  'Logo',
                  'Search bar',
                  'User dropdown',
                ],
                checked: ['Layout consistency', 'Hover states'],
              },
              {
                area: 'Dashboard',
                visitedAt: '2026-04-02T10:10:00Z',
                navigationPath: 'Nav → Dashboard',
                elementsObserved: [
                  'Card grid',
                  'Stats panel',
                  'Activity feed',
                ],
                checked: ['Spacing', 'Loading states'],
              },
            ],
          };
          appendDiscoveryRound(1, round1);
        } else if (opts.prompt.includes('Current round: 2')) {
          // Capture the checkpoint at the start of round 2
          round2Checkpoint = readCheckpointFile(1);
        }
        return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
      });

      await runInstanceRounds(config);

      // Round 2 checkpoint should have discovery items (7 items) not plan areas (2 items)
      expect(round2Checkpoint).not.toBeNull();
      expect(round2Checkpoint!.currentRound).toBe(2);
      expect(round2Checkpoint!.areas).toHaveLength(7);

      const itemNames = round2Checkpoint!.areas.map((a) => a.name);
      expect(itemNames).toContain('Navigation: Main menu links');
      expect(itemNames).toContain('Navigation: Logo');
      expect(itemNames).toContain('Navigation: Search bar');
      expect(itemNames).toContain('Navigation: User dropdown');
      expect(itemNames).toContain('Dashboard: Card grid');
      expect(itemNames).toContain('Dashboard: Stats panel');
      expect(itemNames).toContain('Dashboard: Activity feed');

      // All items should start as not-started
      expect(round2Checkpoint!.areas.every((a) => a.status === 'not-started')).toBe(true);
    });

    it('progress display shows more granular item count in round 2', () => {
      ensureInstanceDir(1);

      const display = new ProgressDisplay([1], 2);

      // Simulate round 1 state: 2 plan areas
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Navigation', 'Dashboard'],
        currentRound: 1,
        areas: [
          { name: 'Navigation', status: 'complete' },
          { name: 'Dashboard', status: 'complete' },
        ],
        lastAction: 'Round 1 done',
        timestamp: '2026-04-02T10:00:00Z',
      });

      display.updateProgress(1, 2, 0, 2, 0);
      expect(display.getProgress(1)!.totalItems).toBe(2);
      expect(display.getProgress(1)!.completedItems).toBe(2);

      // Simulate round transition: mark round complete then write round 2 checkpoint
      display.markRoundComplete(1, 60000);
      expect(display.getProgress(1)!.currentRound).toBe(2);
      expect(display.getProgress(1)!.completedItems).toBe(0);

      // Round 2 checkpoint with discovery items
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: [
          'Navigation: Main menu links',
          'Navigation: Logo',
          'Navigation: Search bar',
          'Dashboard: Card grid',
          'Dashboard: Stats panel',
          'Dashboard: Activity feed',
        ],
        currentRound: 2,
        areas: [
          { name: 'Navigation: Main menu links', status: 'not-started' },
          { name: 'Navigation: Logo', status: 'not-started' },
          { name: 'Navigation: Search bar', status: 'not-started' },
          { name: 'Dashboard: Card grid', status: 'not-started' },
          { name: 'Dashboard: Stats panel', status: 'not-started' },
          { name: 'Dashboard: Activity feed', status: 'not-started' },
        ],
        lastAction: 'Starting round 2',
        timestamp: '2026-04-02T10:05:00Z',
      });

      display.updateProgress(1, 0, 0, 6, 0);
      const p = display.getProgress(1)!;
      // Recalibrated: 6 items instead of 2
      expect(p.totalItems).toBe(6);
      expect(p.completedItems).toBe(0);
      expect(p.currentRound).toBe(2);
    });
  });

  describe('no unexpected jumps or regressions during recalibration', () => {
    it('progress advances monotonically within each round', () => {
      ensureInstanceDir(1);
      const display = new ProgressDisplay([1], 2);
      const baseTime = 1000000000;
      display.setProgress(1, { roundStartTime: baseTime, startTime: baseTime });

      // Round 1 starts at 0%
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav', 'Dashboard'],
        currentRound: 1,
        areas: [
          { name: 'Nav', status: 'not-started' },
          { name: 'Dashboard', status: 'not-started' },
        ],
        lastAction: 'Starting',
        timestamp: '2026-04-02T10:00:00Z',
      });

      display.updateProgress(1, 0, 0, 2, 0);
      const pct0 = display.getProgress(1)!.completedItems / display.getProgress(1)!.totalItems;
      expect(pct0).toBe(0);

      // Round 1: 1/2 complete → 50%
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav', 'Dashboard'],
        currentRound: 1,
        areas: [
          { name: 'Nav', status: 'complete' },
          { name: 'Dashboard', status: 'not-started' },
        ],
        lastAction: 'Completed Nav',
        timestamp: '2026-04-02T10:02:00Z',
      });

      display.updateProgress(1, 1, 0, 2, 0);
      const pct1 = display.getProgress(1)!.completedItems / display.getProgress(1)!.totalItems;
      expect(pct1).toBe(0.5);
      expect(pct1).toBeGreaterThan(pct0);

      // Round 1: 2/2 complete → 100%
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav', 'Dashboard'],
        currentRound: 1,
        areas: [
          { name: 'Nav', status: 'complete' },
          { name: 'Dashboard', status: 'complete' },
        ],
        lastAction: 'Round 1 done',
        timestamp: '2026-04-02T10:05:00Z',
      });

      display.updateProgress(1, 2, 0, 2, 0);
      const pct2 = display.getProgress(1)!.completedItems / display.getProgress(1)!.totalItems;
      expect(pct2).toBe(1);
      expect(pct2).toBeGreaterThan(pct1);

      // Transition to round 2
      display.markRoundComplete(1, 300000);
      const afterReset = display.getProgress(1)!;
      expect(afterReset.currentRound).toBe(2);
      expect(afterReset.completedItems).toBe(0);
      expect(afterReset.inProgressItems).toBe(0);

      // Round 2 checkpoint with more granular items
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav: Links', 'Nav: Logo', 'Nav: Search', 'Dashboard: Cards', 'Dashboard: Stats'],
        currentRound: 2,
        areas: [
          { name: 'Nav: Links', status: 'not-started' },
          { name: 'Nav: Logo', status: 'not-started' },
          { name: 'Nav: Search', status: 'not-started' },
          { name: 'Dashboard: Cards', status: 'not-started' },
          { name: 'Dashboard: Stats', status: 'not-started' },
        ],
        lastAction: 'Starting round 2',
        timestamp: '2026-04-02T10:05:01Z',
      });

      display.updateProgress(1, 0, 0, 5, 0);
      const pctR2_0 = display.getProgress(1)!.completedItems;
      expect(pctR2_0).toBe(0);
      expect(display.getProgress(1)!.totalItems).toBe(5);

      // Round 2: 2/5 complete → 40%
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav: Links', 'Nav: Logo', 'Nav: Search', 'Dashboard: Cards', 'Dashboard: Stats'],
        currentRound: 2,
        areas: [
          { name: 'Nav: Links', status: 'complete' },
          { name: 'Nav: Logo', status: 'complete' },
          { name: 'Nav: Search', status: 'not-started' },
          { name: 'Dashboard: Cards', status: 'not-started' },
          { name: 'Dashboard: Stats', status: 'not-started' },
        ],
        lastAction: 'Completed Nav: Logo',
        timestamp: '2026-04-02T10:07:00Z',
      });

      display.updateProgress(1, 2, 0, 5, 0);
      const pR2 = display.getProgress(1)!;
      expect(pR2.completedItems).toBe(2);
      expect(pR2.totalItems).toBe(5);
      // Percentage only goes up within the round
      expect(pR2.completedItems).toBeGreaterThan(pctR2_0);
    });

    it('round transition resets to 0% cleanly (no stale data)', () => {
      ensureInstanceDir(1);
      const display = new ProgressDisplay([1], 2);

      // End of round 1: 100%
      display.setProgress(1, {
        totalItems: 3,
        completedItems: 3,
        inProgressItems: 0,
        currentRound: 1,
      });

      // Transition
      display.markRoundComplete(1, 60000);

      const p = display.getProgress(1)!;
      expect(p.currentRound).toBe(2);
      expect(p.completedItems).toBe(0);
      expect(p.inProgressItems).toBe(0);
      // totalItems may still be stale until next updateFromFiles, but completedItems = 0
      // so the visual bar shows 0% regardless
      const pct = p.totalItems > 0 ? p.completedItems / p.totalItems : 0;
      expect(pct).toBe(0);
    });
  });

  describe('fallback when no discovery doc exists', () => {
    it('round 2 falls back to plan areas when no discovery doc was written', async () => {
      ensureInstanceDir(1);

      const config: RoundExecutionConfig = {
        instanceNumber: 1,
        url: 'https://example.com',
        intro: 'Test',
        planChunk: 'Review areas',
        scope: 'Check layout',
        totalRounds: 2,
        assignedAreas: ['Navigation', 'Dashboard'],
      };

      let round2Checkpoint: Checkpoint | null = null;

      mockRunClaude.mockImplementation(async (opts) => {
        if (opts.prompt.includes('Current round: 2')) {
          round2Checkpoint = readCheckpointFile(1);
        }
        // Don't write any discovery doc
        return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
      });

      await runInstanceRounds(config);

      // Without discovery doc, round 2 should use the same plan areas
      expect(round2Checkpoint).not.toBeNull();
      expect(round2Checkpoint!.currentRound).toBe(2);
      expect(round2Checkpoint!.areas).toHaveLength(2);
      expect(round2Checkpoint!.areas.map((a) => a.name)).toEqual(['Navigation', 'Dashboard']);
    });
  });

  describe('round 3 uses accumulated discovery from rounds 1 and 2', () => {
    it('round 3 checkpoint reflects cumulative discovery items', async () => {
      ensureInstanceDir(1);

      const config: RoundExecutionConfig = {
        instanceNumber: 1,
        url: 'https://example.com',
        intro: 'Test',
        planChunk: 'Review areas',
        scope: 'Check layout',
        totalRounds: 3,
        assignedAreas: ['Navigation'],
      };

      let round3Checkpoint: Checkpoint | null = null;

      mockRunClaude.mockImplementation(async (opts) => {
        if (opts.prompt.includes('Current round: 1')) {
          appendDiscoveryRound(1, {
            roundNumber: 1,
            entries: [
              {
                area: 'Navigation',
                visitedAt: '2026-04-02T10:00:00Z',
                navigationPath: 'Home',
                elementsObserved: ['Logo', 'Menu links'],
                checked: ['Layout'],
              },
            ],
          });
        } else if (opts.prompt.includes('Current round: 2')) {
          appendDiscoveryRound(1, {
            roundNumber: 2,
            entries: [
              {
                area: 'Navigation',
                visitedAt: '2026-04-02T11:00:00Z',
                navigationPath: 'Home',
                elementsObserved: ['Hamburger menu', 'Breadcrumbs'], // New elements
                checked: ['Accessibility'],
              },
            ],
          });
        } else if (opts.prompt.includes('Current round: 3')) {
          round3Checkpoint = readCheckpointFile(1);
        }
        return { stdout: 'ok', stderr: '', exitCode: 0, success: true };
      });

      await runInstanceRounds(config);

      // Round 3 should have all 4 unique items from rounds 1 + 2
      expect(round3Checkpoint).not.toBeNull();
      expect(round3Checkpoint!.currentRound).toBe(3);
      expect(round3Checkpoint!.areas).toHaveLength(4);

      const itemNames = round3Checkpoint!.areas.map((a) => a.name);
      expect(itemNames).toContain('Navigation: Logo');
      expect(itemNames).toContain('Navigation: Menu links');
      expect(itemNames).toContain('Navigation: Hamburger menu');
      expect(itemNames).toContain('Navigation: Breadcrumbs');
    });
  });
});
