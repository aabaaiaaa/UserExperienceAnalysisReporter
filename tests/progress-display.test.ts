import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const TEST_TEMP_DIR = resolve('.uxreview-temp-progress-test');

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

import {
  formatDuration,
  calculateEta,
  renderProgressBar,
  countFindings,
  getProgressFromCheckpoint,
  formatProgressLine,
  ProgressDisplay,
  InstanceProgress,
} from '../src/progress-display.js';
import { Checkpoint } from '../src/checkpoint.js';

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

function writeReportFile(instanceNumber: number, content: string): void {
  const dir = ensureInstanceDir(instanceNumber);
  writeFileSync(join(dir, 'report.md'), content, 'utf-8');
}

beforeEach(() => {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_TEMP_DIR)) {
    rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  }
});

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(45000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m00s');
    expect(formatDuration(90000)).toBe('1m30s');
    expect(formatDuration(125000)).toBe('2m05s');
  });

  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('handles large values', () => {
    expect(formatDuration(3600000)).toBe('60m00s');
  });
});

describe('renderProgressBar', () => {
  it('renders 0% as all empty', () => {
    expect(renderProgressBar(0)).toBe('[--------------------]');
  });

  it('renders 100% as all filled', () => {
    expect(renderProgressBar(100)).toBe('[####################]');
  });

  it('renders 50% as half filled', () => {
    expect(renderProgressBar(50)).toBe('[##########----------]');
  });

  it('clamps values above 100', () => {
    expect(renderProgressBar(150)).toBe('[####################]');
  });

  it('clamps values below 0', () => {
    expect(renderProgressBar(-10)).toBe('[--------------------]');
  });

  it('rounds fractional percentages', () => {
    // 25% of 20 = 5 bars
    expect(renderProgressBar(25)).toBe('[#####---------------]');
  });
});

describe('countFindings', () => {
  it('returns 0 for empty content', () => {
    expect(countFindings('')).toBe(0);
  });

  it('counts findings in a report', () => {
    const report = `# UX Report - Instance 1

## I1-UXR-001: First finding
- **UI Area**: Navigation

## I1-UXR-002: Second finding
- **UI Area**: Dashboard

## I1-UXR-003: Third finding
- **UI Area**: Settings
`;
    expect(countFindings(report)).toBe(3);
  });

  it('does not count non-finding headings', () => {
    const report = `# UX Report - Instance 1

## Summary of findings

## I1-UXR-001: First finding
- **UI Area**: Navigation
`;
    expect(countFindings(report)).toBe(1);
  });
});

describe('getProgressFromCheckpoint', () => {
  it('extracts completed, in-progress, and total counts', () => {
    const checkpoint: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Nav', 'Dashboard', 'Settings', 'Profile'],
      currentRound: 1,
      areas: [
        { name: 'Nav', status: 'complete' },
        { name: 'Dashboard', status: 'complete' },
        { name: 'Settings', status: 'in-progress' },
        { name: 'Profile', status: 'not-started' },
      ],
      lastAction: 'Checking settings layout',
      timestamp: '2026-04-02T10:00:00Z',
    };

    const result = getProgressFromCheckpoint(checkpoint);
    expect(result.completed).toBe(2);
    expect(result.inProgress).toBe(1);
    expect(result.total).toBe(4);
  });

  it('handles all complete', () => {
    const checkpoint: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Nav', 'Dashboard'],
      currentRound: 1,
      areas: [
        { name: 'Nav', status: 'complete' },
        { name: 'Dashboard', status: 'complete' },
      ],
      lastAction: 'Done',
      timestamp: '2026-04-02T10:00:00Z',
    };

    const result = getProgressFromCheckpoint(checkpoint);
    expect(result.completed).toBe(2);
    expect(result.inProgress).toBe(0);
    expect(result.total).toBe(2);
  });

  it('handles none started', () => {
    const checkpoint: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Nav', 'Dashboard'],
      currentRound: 1,
      areas: [
        { name: 'Nav', status: 'not-started' },
        { name: 'Dashboard', status: 'not-started' },
      ],
      lastAction: 'Starting review',
      timestamp: '2026-04-02T10:00:00Z',
    };

    const result = getProgressFromCheckpoint(checkpoint);
    expect(result.completed).toBe(0);
    expect(result.inProgress).toBe(0);
    expect(result.total).toBe(2);
  });
});

describe('calculateEta', () => {
  it('returns null when no items completed', () => {
    expect(calculateEta(5000, 0, 10, 1, 1, [])).toBeNull();
  });

  it('returns null when total items is 0', () => {
    expect(calculateEta(5000, 3, 0, 1, 1, [])).toBeNull();
  });

  it('calculates ETA for current round', () => {
    // 10s elapsed, 2 of 4 items done => 5s per item => 10s remaining
    const eta = calculateEta(10000, 2, 4, 1, 1, []);
    expect(eta).toBe('10s');
  });

  it('includes future rounds in ETA', () => {
    // 10s elapsed, 5 of 5 items done on round 1/3
    // Current round remaining: 0
    // No prior durations, estimate from pace: 5 items * 2s/item = 10s per round
    // 2 remaining rounds * 10s = 20s
    const eta = calculateEta(10000, 5, 5, 1, 3, []);
    // completedItems = totalItems, so currentRoundRemainingMs = 0
    // remainingRounds = 2, msPerItem = 2000, currentRoundEstimate = 10000, futureRoundsMs = 20000
    expect(eta).toBe('20s');
  });

  it('uses prior round durations for future round estimates', () => {
    // 5s elapsed on round 2, 1 of 2 items done
    // Current round remaining: 5s
    // Prior round took 12s, 1 remaining round => 12s
    // Total: 17s
    const eta = calculateEta(5000, 1, 2, 2, 3, [12000]);
    expect(eta).toBe('17s');
  });

  it('returns null when all items are complete and no remaining rounds', () => {
    const eta = calculateEta(10000, 5, 5, 1, 1, []);
    expect(eta).toBeNull();
  });
});

describe('formatProgressLine', () => {
  it('formats a progress line with all fields', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 2,
      totalItems: 6,
      completedItems: 3,
      inProgressItems: 1,
      findingsCount: 2,
      startTime: now - 60000,
      roundStartTime: now - 60000,
      status: 'running',
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('I1');
    expect(line).toContain('R1/2');
    expect(line).toContain('50%');
    expect(line).toContain('3/6 areas');
    expect(line).toContain('2 findings');
    expect(line).toContain('1m00s');
    expect(line).toContain('ETA');
  });

  it('shows 0% when no items', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 2,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 0,
      completedItems: 0,
      inProgressItems: 0,
      findingsCount: 0,
      startTime: now,
      roundStartTime: now,
      status: 'running',
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('I2');
    expect(line).toContain('R1/1');
    expect(line).toContain('0%');
    expect(line).toContain('0/0 areas');
    expect(line).toContain('0 findings');
    expect(line).not.toContain('ETA');
  });

  it('omits ETA when no completed items', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 5,
      completedItems: 0,
      inProgressItems: 1,
      findingsCount: 0,
      startTime: now - 10000,
      roundStartTime: now - 10000,
      status: 'running',
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('0%');
    expect(line).not.toContain('ETA');
  });

  it('includes progress bar characters', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 2,
      inProgressItems: 0,
      findingsCount: 1,
      startTime: now - 30000,
      roundStartTime: now - 30000,
      status: 'running',
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('[##########----------]');
  });
});

describe('ProgressDisplay', () => {
  describe('constructor and getProgress', () => {
    it('initializes progress for each instance', () => {
      const display = new ProgressDisplay([1, 2], 3);

      const p1 = display.getProgress(1);
      expect(p1).toBeDefined();
      expect(p1!.instanceNumber).toBe(1);
      expect(p1!.totalRounds).toBe(3);
      expect(p1!.currentRound).toBe(1);
      expect(p1!.status).toBe('running');

      const p2 = display.getProgress(2);
      expect(p2).toBeDefined();
      expect(p2!.instanceNumber).toBe(2);

      expect(display.getProgress(99)).toBeUndefined();
    });
  });

  describe('setProgress', () => {
    it('updates specific fields on an instance', () => {
      const display = new ProgressDisplay([1], 1);
      display.setProgress(1, { completedItems: 5, findingsCount: 3 });

      const p = display.getProgress(1);
      expect(p!.completedItems).toBe(5);
      expect(p!.findingsCount).toBe(3);
      expect(p!.status).toBe('running');
    });

    it('ignores updates for non-existent instances', () => {
      const display = new ProgressDisplay([1], 1);
      display.setProgress(99, { completedItems: 5 });
      expect(display.getProgress(99)).toBeUndefined();
    });
  });

  describe('markRoundComplete', () => {
    it('advances round and resets items', () => {
      const display = new ProgressDisplay([1], 3);
      display.setProgress(1, { completedItems: 5, inProgressItems: 0, totalItems: 5 });

      display.markRoundComplete(1, 30000);

      const p = display.getProgress(1);
      expect(p!.currentRound).toBe(2);
      expect(p!.completedItems).toBe(0);
      expect(p!.inProgressItems).toBe(0);
      expect(p!.priorRoundDurations).toEqual([30000]);
    });
  });

  describe('markCompleted / markFailed', () => {
    it('marks an instance as completed', () => {
      const display = new ProgressDisplay([1], 1);
      display.markCompleted(1);
      expect(display.getProgress(1)!.status).toBe('completed');
    });

    it('marks an instance as failed with error', () => {
      const display = new ProgressDisplay([1], 1);
      display.markFailed(1, 'Process crashed');
      const p = display.getProgress(1);
      expect(p!.status).toBe('failed');
      expect(p!.error).toBe('Process crashed');
    });
  });

  describe('updateFromFiles', () => {
    it('reads checkpoint and report files to update progress', () => {
      const display = new ProgressDisplay([1], 2);

      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav', 'Dashboard', 'Settings'],
        currentRound: 1,
        areas: [
          { name: 'Nav', status: 'complete' },
          { name: 'Dashboard', status: 'in-progress' },
          { name: 'Settings', status: 'not-started' },
        ],
        lastAction: 'Checking dashboard layout',
        timestamp: '2026-04-02T10:05:00Z',
      });

      writeReportFile(
        1,
        `# UX Report - Instance 1

## I1-UXR-001: Nav hover states inconsistent
- **UI Area**: Navigation
- **Severity**: minor
- **Description**: Hover states differ
- **Suggestion**: Standardize
- **Screenshot**: I1-UXR-001.png

## I1-UXR-002: Nav breadcrumb missing
- **UI Area**: Navigation
- **Severity**: major
- **Description**: No breadcrumbs
- **Suggestion**: Add breadcrumbs
- **Screenshot**: I1-UXR-002.png
`,
      );

      display.updateFromFiles(1);

      const p = display.getProgress(1);
      expect(p!.completedItems).toBe(1);
      expect(p!.inProgressItems).toBe(1);
      expect(p!.totalItems).toBe(3);
      expect(p!.findingsCount).toBe(2);
      expect(p!.currentRound).toBe(1);
    });

    it('skips update for completed instances', () => {
      const display = new ProgressDisplay([1], 1);
      display.markCompleted(1);
      display.setProgress(1, { completedItems: 5 });

      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav'],
        currentRound: 1,
        areas: [{ name: 'Nav', status: 'not-started' }],
        lastAction: 'Starting',
        timestamp: '2026-04-02T10:00:00Z',
      });

      display.updateFromFiles(1);

      // Should not have updated from checkpoint
      expect(display.getProgress(1)!.completedItems).toBe(5);
    });

    it('skips update for failed instances', () => {
      const display = new ProgressDisplay([1], 1);
      display.markFailed(1, 'Crash');
      display.setProgress(1, { completedItems: 3 });

      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav'],
        currentRound: 1,
        areas: [{ name: 'Nav', status: 'not-started' }],
        lastAction: 'Starting',
        timestamp: '2026-04-02T10:00:00Z',
      });

      display.updateFromFiles(1);

      expect(display.getProgress(1)!.completedItems).toBe(3);
    });

    it('handles missing checkpoint gracefully', () => {
      ensureInstanceDir(1);
      const display = new ProgressDisplay([1], 1);
      display.updateFromFiles(1);

      const p = display.getProgress(1);
      expect(p!.completedItems).toBe(0);
      expect(p!.totalItems).toBe(0);
    });

    it('handles missing report gracefully', () => {
      const display = new ProgressDisplay([1], 1);

      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav'],
        currentRound: 1,
        areas: [{ name: 'Nav', status: 'complete' }],
        lastAction: 'Done',
        timestamp: '2026-04-02T10:00:00Z',
      });

      display.updateFromFiles(1);

      const p = display.getProgress(1);
      expect(p!.completedItems).toBe(1);
      expect(p!.findingsCount).toBe(0);
    });
  });

  describe('updateAllFromFiles', () => {
    it('updates all instances from files', () => {
      const display = new ProgressDisplay([1, 2], 1);

      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav', 'Dashboard'],
        currentRound: 1,
        areas: [
          { name: 'Nav', status: 'complete' },
          { name: 'Dashboard', status: 'not-started' },
        ],
        lastAction: 'Completed Nav',
        timestamp: '2026-04-02T10:00:00Z',
      });

      writeCheckpointFile(2, {
        instanceId: 2,
        assignedAreas: ['Settings', 'Profile', 'Help'],
        currentRound: 1,
        areas: [
          { name: 'Settings', status: 'complete' },
          { name: 'Profile', status: 'complete' },
          { name: 'Help', status: 'in-progress' },
        ],
        lastAction: 'Checking Help page',
        timestamp: '2026-04-02T10:00:00Z',
      });

      writeReportFile(
        1,
        `# UX Report - Instance 1

## I1-UXR-001: Finding one
- **UI Area**: Nav
`,
      );

      writeReportFile(
        2,
        `# UX Report - Instance 2

## I2-UXR-001: Finding one
- **UI Area**: Settings

## I2-UXR-002: Finding two
- **UI Area**: Profile

## I2-UXR-003: Finding three
- **UI Area**: Profile
`,
      );

      display.updateAllFromFiles();

      const p1 = display.getProgress(1);
      expect(p1!.completedItems).toBe(1);
      expect(p1!.totalItems).toBe(2);
      expect(p1!.findingsCount).toBe(1);

      const p2 = display.getProgress(2);
      expect(p2!.completedItems).toBe(2);
      expect(p2!.totalItems).toBe(3);
      expect(p2!.findingsCount).toBe(3);
    });
  });

  describe('renderLines', () => {
    it('renders one line per instance', () => {
      const display = new ProgressDisplay([1, 2], 2);
      const now = Date.now();
      const lines = display.renderLines(now);

      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('I1');
      expect(lines[1]).toContain('I2');
    });

    it('reflects updated progress in rendered output', () => {
      const display = new ProgressDisplay([1, 2], 1);
      const now = Date.now();

      display.setProgress(1, {
        totalItems: 4,
        completedItems: 2,
        findingsCount: 1,
        roundStartTime: now - 30000,
      });

      display.setProgress(2, {
        totalItems: 6,
        completedItems: 6,
        findingsCount: 5,
        roundStartTime: now - 120000,
      });

      const lines = display.renderLines(now);

      // Instance 1: 2/4 = 50%
      expect(lines[0]).toContain('50%');
      expect(lines[0]).toContain('2/4 areas');
      expect(lines[0]).toContain('1 findings');

      // Instance 2: 6/6 = 100%
      expect(lines[1]).toContain('100%');
      expect(lines[1]).toContain('6/6 areas');
      expect(lines[1]).toContain('5 findings');
    });
  });

  describe('start and stop', () => {
    it('starts and stops polling without errors', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const display = new ProgressDisplay([1], 1);
      ensureInstanceDir(1);

      display.start(100);
      display.stop();

      stderrSpy.mockRestore();
    });
  });

  describe('verification: 2 mock instances with advancing progress', () => {
    it('each instance has its own progress bar that updates as checkpoints advance', () => {
      const display = new ProgressDisplay([1, 2], 2);
      const baseTime = 1000000000;

      display.setProgress(1, { roundStartTime: baseTime - 60000, startTime: baseTime - 60000 });
      display.setProgress(2, { roundStartTime: baseTime - 45000, startTime: baseTime - 45000 });

      // Step 1: Initial state — no checkpoint files yet
      const lines0 = display.renderLines(baseTime);
      expect(lines0).toHaveLength(2);
      expect(lines0[0]).toContain('I1');
      expect(lines0[0]).toContain('0%');
      expect(lines0[1]).toContain('I2');
      expect(lines0[1]).toContain('0%');

      // Step 2: Write initial checkpoints (nothing complete yet)
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav', 'Dashboard', 'Settings', 'Profile'],
        currentRound: 1,
        areas: [
          { name: 'Nav', status: 'not-started' },
          { name: 'Dashboard', status: 'not-started' },
          { name: 'Settings', status: 'not-started' },
          { name: 'Profile', status: 'not-started' },
        ],
        lastAction: 'Starting review',
        timestamp: '2026-04-02T10:00:00Z',
      });

      writeCheckpointFile(2, {
        instanceId: 2,
        assignedAreas: ['Help', 'Account', 'Billing'],
        currentRound: 1,
        areas: [
          { name: 'Help', status: 'not-started' },
          { name: 'Account', status: 'not-started' },
          { name: 'Billing', status: 'not-started' },
        ],
        lastAction: 'Starting review',
        timestamp: '2026-04-02T10:00:00Z',
      });

      display.updateAllFromFiles();
      const lines1 = display.renderLines(baseTime);
      expect(lines1[0]).toContain('0/4 areas');
      expect(lines1[0]).toContain('0%');
      expect(lines1[1]).toContain('0/3 areas');
      expect(lines1[1]).toContain('0%');

      // Step 3: Instance 1 completes 1 area, Instance 2 completes 2 areas
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav', 'Dashboard', 'Settings', 'Profile'],
        currentRound: 1,
        areas: [
          { name: 'Nav', status: 'complete' },
          { name: 'Dashboard', status: 'in-progress' },
          { name: 'Settings', status: 'not-started' },
          { name: 'Profile', status: 'not-started' },
        ],
        lastAction: 'Checking Dashboard layout',
        timestamp: '2026-04-02T10:02:00Z',
      });

      writeReportFile(
        1,
        `# UX Report - Instance 1

## I1-UXR-001: Nav inconsistent hover
- **UI Area**: Navigation
`,
      );

      writeCheckpointFile(2, {
        instanceId: 2,
        assignedAreas: ['Help', 'Account', 'Billing'],
        currentRound: 1,
        areas: [
          { name: 'Help', status: 'complete' },
          { name: 'Account', status: 'complete' },
          { name: 'Billing', status: 'in-progress' },
        ],
        lastAction: 'Checking Billing forms',
        timestamp: '2026-04-02T10:03:00Z',
      });

      writeReportFile(
        2,
        `# UX Report - Instance 2

## I2-UXR-001: Help page missing search
- **UI Area**: Help

## I2-UXR-002: Account form no validation
- **UI Area**: Account
`,
      );

      display.updateAllFromFiles();
      const lines2 = display.renderLines(baseTime + 120000);

      // Instance 1: 1/4 = 25%
      expect(lines2[0]).toContain('25%');
      expect(lines2[0]).toContain('1/4 areas');
      expect(lines2[0]).toContain('1 findings');
      expect(lines2[0]).toContain('R1/2');
      // Should have ETA since we have completed items
      expect(lines2[0]).toContain('ETA');

      // Instance 2: 2/3 ≈ 67%
      expect(lines2[1]).toContain('67%');
      expect(lines2[1]).toContain('2/3 areas');
      expect(lines2[1]).toContain('2 findings');
      expect(lines2[1]).toContain('ETA');

      // Step 4: Instance 1 completes 3 areas, Instance 2 completes all
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['Nav', 'Dashboard', 'Settings', 'Profile'],
        currentRound: 1,
        areas: [
          { name: 'Nav', status: 'complete' },
          { name: 'Dashboard', status: 'complete' },
          { name: 'Settings', status: 'complete' },
          { name: 'Profile', status: 'in-progress' },
        ],
        lastAction: 'Checking Profile forms',
        timestamp: '2026-04-02T10:05:00Z',
      });

      writeCheckpointFile(2, {
        instanceId: 2,
        assignedAreas: ['Help', 'Account', 'Billing'],
        currentRound: 1,
        areas: [
          { name: 'Help', status: 'complete' },
          { name: 'Account', status: 'complete' },
          { name: 'Billing', status: 'complete' },
        ],
        lastAction: 'Round 1 complete',
        timestamp: '2026-04-02T10:04:00Z',
      });

      display.updateAllFromFiles();
      const lines3 = display.renderLines(baseTime + 300000);

      // Instance 1: 3/4 = 75%
      expect(lines3[0]).toContain('75%');
      expect(lines3[0]).toContain('3/4 areas');

      // Instance 2: 3/3 = 100%
      expect(lines3[1]).toContain('100%');
      expect(lines3[1]).toContain('3/3 areas');
    });

    it('displays stats and ETA correctly across updates', () => {
      const display = new ProgressDisplay([1, 2], 1);
      const baseTime = 2000000000;

      // Set start times so elapsed time is calculable
      display.setProgress(1, { roundStartTime: baseTime - 20000, startTime: baseTime - 20000 });
      display.setProgress(2, { roundStartTime: baseTime - 40000, startTime: baseTime - 40000 });

      // Write checkpoints with some progress
      writeCheckpointFile(1, {
        instanceId: 1,
        assignedAreas: ['A', 'B', 'C', 'D'],
        currentRound: 1,
        areas: [
          { name: 'A', status: 'complete' },
          { name: 'B', status: 'complete' },
          { name: 'C', status: 'not-started' },
          { name: 'D', status: 'not-started' },
        ],
        lastAction: 'Completed B',
        timestamp: '2026-04-02T10:00:00Z',
      });

      writeReportFile(
        1,
        `# UX Report - Instance 1

## I1-UXR-001: Finding A
- **UI Area**: A

## I1-UXR-002: Finding B1
- **UI Area**: B

## I1-UXR-003: Finding B2
- **UI Area**: B
`,
      );

      writeCheckpointFile(2, {
        instanceId: 2,
        assignedAreas: ['X', 'Y'],
        currentRound: 1,
        areas: [
          { name: 'X', status: 'complete' },
          { name: 'Y', status: 'in-progress' },
        ],
        lastAction: 'Checking Y forms',
        timestamp: '2026-04-02T10:00:00Z',
      });

      writeReportFile(
        2,
        `# UX Report - Instance 2

## I2-UXR-001: Finding X
- **UI Area**: X
`,
      );

      display.updateAllFromFiles();
      const lines = display.renderLines(baseTime);

      // Instance 1: 2/4 done in 20s => 10s per area => 20s remaining
      expect(lines[0]).toContain('2/4 areas');
      expect(lines[0]).toContain('3 findings');
      expect(lines[0]).toContain('20s'); // elapsed
      expect(lines[0]).toContain('ETA ~20s'); // remaining

      // Instance 2: 1/2 done in 40s => 40s per area => 40s remaining
      expect(lines[1]).toContain('1/2 areas');
      expect(lines[1]).toContain('1 findings');
      expect(lines[1]).toContain('40s'); // elapsed
      expect(lines[1]).toContain('ETA ~40s'); // remaining
    });
  });
});
