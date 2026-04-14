import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  formatDuration,
  calculateEta,
  renderProgressBar,
  getProgressFromCheckpoint,
  formatProgressLine,
  formatConsolidationLine,
  ProgressDisplay,
  InstanceProgress,
  ConsolidationState,
  ANSI_RESET,
  ANSI_RED,
  ANSI_GREEN,
} from '../src/progress-display.js';
import { countFindings } from '../src/report.js';
import { Checkpoint } from '../src/checkpoint.js';

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
      screenshotCount: 0,
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
      screenshotCount: 0,
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
      screenshotCount: 0,
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
      screenshotCount: 0,
      startTime: now - 30000,
      roundStartTime: now - 30000,
      status: 'running',
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('[##########----------]');
  });

  it('includes screenshot count in running state when count > 0', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 2,
      inProgressItems: 1,
      findingsCount: 3,
      screenshotCount: 5,
      startTime: now - 30000,
      roundStartTime: now - 30000,
      status: 'running',
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('3 findings, 5 screenshots');
  });

  it('omits screenshot count in running state when count is 0', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 2,
      inProgressItems: 1,
      findingsCount: 3,
      screenshotCount: 0,
      startTime: now - 30000,
      roundStartTime: now - 30000,
      status: 'running',
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('3 findings');
    expect(line).not.toContain('screenshots');
  });

  it('includes screenshot count in completed state when count > 0', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 4,
      inProgressItems: 0,
      findingsCount: 6,
      screenshotCount: 8,
      startTime: now - 60000,
      roundStartTime: now - 60000,
      status: 'completed',
      completedTime: now,
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('6 findings, 8 screenshots');
    expect(line).toContain(ANSI_GREEN);
  });

  it('omits screenshot count in completed state when count is 0', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 4,
      inProgressItems: 0,
      findingsCount: 6,
      screenshotCount: 0,
      startTime: now - 60000,
      roundStartTime: now - 60000,
      status: 'completed',
      completedTime: now,
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('6 findings');
    expect(line).not.toContain('screenshots');
  });

  it('shows liveness signal when latestMtime is provided in running state', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 5,
      completedItems: 2,
      inProgressItems: 1,
      findingsCount: 3,
      screenshotCount: 7,
      startTime: now - 30000,
      roundStartTime: now - 30000,
      status: 'running',
      priorRoundDurations: [],
      latestMtime: now - 2000,
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('3 findings, 7 screenshots \u00B7 active 2s ago');
  });

  it('shows liveness signal with 0s when mtime equals now', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 2,
      inProgressItems: 0,
      findingsCount: 1,
      screenshotCount: 0,
      startTime: now - 10000,
      roundStartTime: now - 10000,
      status: 'running',
      priorRoundDurations: [],
      latestMtime: now,
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('1 findings \u00B7 active 0s ago');
  });

  it('omits liveness signal when latestMtime is undefined', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 2,
      inProgressItems: 0,
      findingsCount: 1,
      screenshotCount: 0,
      startTime: now - 10000,
      roundStartTime: now - 10000,
      status: 'running',
      priorRoundDurations: [],
    };

    const line = formatProgressLine(progress, now);
    expect(line).not.toContain('active');
    expect(line).not.toContain('\u00B7');
  });

  it('does not show liveness signal in completed state even if latestMtime is set', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 4,
      inProgressItems: 0,
      findingsCount: 3,
      screenshotCount: 2,
      startTime: now - 60000,
      roundStartTime: now - 60000,
      status: 'completed',
      completedTime: now,
      priorRoundDurations: [],
      latestMtime: now - 5000,
    };

    const line = formatProgressLine(progress, now);
    expect(line).not.toContain('active');
    expect(line).not.toContain('\u00B7');
    expect(line).toContain(ANSI_GREEN);
  });

  it('does not show liveness signal in failed state even if latestMtime is set', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 2,
      inProgressItems: 0,
      findingsCount: 1,
      screenshotCount: 0,
      startTime: now - 10000,
      roundStartTime: now - 10000,
      status: 'failed',
      error: 'Some error',
      priorRoundDurations: [],
      latestMtime: now - 3000,
    };

    const line = formatProgressLine(progress, now);
    expect(line).not.toContain('active');
    expect(line).not.toContain('\u00B7');
    expect(line).toContain(ANSI_RED);
  });

  it('clamps negative age to 0s when latestMtime is in the future', () => {
    const now = 1000000;
    const progress: InstanceProgress = {
      instanceNumber: 1,
      currentRound: 1,
      totalRounds: 1,
      totalItems: 4,
      completedItems: 2,
      inProgressItems: 0,
      findingsCount: 1,
      screenshotCount: 0,
      startTime: now - 10000,
      roundStartTime: now - 10000,
      status: 'running',
      priorRoundDurations: [],
      latestMtime: now + 5000,
    };

    const line = formatProgressLine(progress, now);
    expect(line).toContain('active 0s ago');
  });
});

describe('formatConsolidationLine', () => {
  it('returns null for idle state', () => {
    const state: ConsolidationState = { status: 'idle', spinnerFrame: 0 };
    expect(formatConsolidationLine(state)).toBeNull();
  });

  it('shows spinner with message for running state', () => {
    const state: ConsolidationState = { status: 'running', spinnerFrame: 0 };
    const line = formatConsolidationLine(state);
    expect(line).toBe('| Consolidating reports...');
  });

  it('cycles spinner frames', () => {
    const frames = ['|', '/', '-', '\\'];
    for (let i = 0; i < frames.length; i++) {
      const state: ConsolidationState = { status: 'running', spinnerFrame: i };
      const line = formatConsolidationLine(state);
      expect(line).toBe(`${frames[i]} Consolidating reports...`);
    }
  });

  it('wraps spinner frames around', () => {
    const state: ConsolidationState = { status: 'running', spinnerFrame: 4 };
    const line = formatConsolidationLine(state);
    // Frame 4 % 4 = 0 → '|'
    expect(line).toBe('| Consolidating reports...');
  });

  it('shows green checkmark and paths for completed state', () => {
    const state: ConsolidationState = {
      status: 'completed',
      reportPath: '/output/report.md',
      discoveryPath: '/output/discovery.md',
      spinnerFrame: 0,
    };
    const line = formatConsolidationLine(state)!;
    expect(line).toContain(`${ANSI_GREEN}✓ Consolidation complete${ANSI_RESET}`);
    expect(line).toContain('Report:    /output/report.md');
    expect(line).toContain('Discovery: /output/discovery.md');
  });

  it('handles completed state without paths', () => {
    const state: ConsolidationState = { status: 'completed', spinnerFrame: 0 };
    const line = formatConsolidationLine(state)!;
    expect(line).toContain('✓ Consolidation complete');
    expect(line).not.toContain('Report:');
    expect(line).not.toContain('Discovery:');
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
    it('advances round and resets items on non-final round', () => {
      const display = new ProgressDisplay([1], 3);
      display.setProgress(1, { completedItems: 5, inProgressItems: 0, totalItems: 5 });

      display.markRoundComplete(1, 30000);

      const p = display.getProgress(1);
      expect(p!.currentRound).toBe(2);
      expect(p!.completedItems).toBe(0);
      expect(p!.inProgressItems).toBe(0);
      expect(p!.priorRoundDurations).toEqual([30000]);
    });

    it('preserves round and items on final round (single round)', () => {
      const display = new ProgressDisplay([1], 1);
      display.updateProgress(1, 5, 0, 5, 3);

      display.markRoundComplete(1, 25000);

      const p = display.getProgress(1);
      expect(p!.currentRound).toBe(1);
      expect(p!.completedItems).toBe(5);
      expect(p!.inProgressItems).toBe(0);
      expect(p!.findingsCount).toBe(3);
      expect(p!.priorRoundDurations).toEqual([25000]);
    });

    it('preserves round and items on final round (multi-round)', () => {
      const display = new ProgressDisplay([1], 2);
      display.updateProgress(1, 3, 0, 3, 2);

      // Round 1 -> round 2: advances and resets
      display.markRoundComplete(1, 10000);
      expect(display.getProgress(1)!.currentRound).toBe(2);
      expect(display.getProgress(1)!.completedItems).toBe(0);

      // Set up round 2 progress
      display.updateProgress(1, 4, 0, 4, 5);

      // Round 2 (final): preserves
      display.markRoundComplete(1, 20000);
      const p = display.getProgress(1);
      expect(p!.currentRound).toBe(2);
      expect(p!.completedItems).toBe(4);
      expect(p!.findingsCount).toBe(5);
      expect(p!.priorRoundDurations).toEqual([10000, 20000]);
    });

    it('completed line shows correct round and areas after final round', () => {
      const display = new ProgressDisplay([1], 1);
      display.updateProgress(1, 5, 0, 5, 3);
      display.markRoundComplete(1, 30000);
      display.markCompleted(1);

      const lines = display.renderLines();
      expect(lines[0]).toContain('R1/1');
      expect(lines[0]).toContain('5/5 areas');
      expect(lines[0]).toContain('3 findings');
      // Green color for completed
      expect(lines[0]).toContain('\x1B[32m');
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

  describe('updateProgress', () => {
    it('updates progress data for an existing instance', () => {
      const display = new ProgressDisplay([1], 2);

      display.updateProgress(1, 2, 1, 4, 3);

      const p = display.getProgress(1);
      expect(p!.completedItems).toBe(2);
      expect(p!.inProgressItems).toBe(1);
      expect(p!.totalItems).toBe(4);
      expect(p!.findingsCount).toBe(3);
    });

    it('ignores updates for non-existent instances', () => {
      const display = new ProgressDisplay([1], 1);
      display.updateProgress(99, 1, 0, 3, 1);
      expect(display.getProgress(99)).toBeUndefined();
    });

    it('overwrites previous progress values on subsequent calls', () => {
      const display = new ProgressDisplay([1], 1);

      display.updateProgress(1, 1, 1, 3, 1);
      expect(display.getProgress(1)!.completedItems).toBe(1);

      display.updateProgress(1, 3, 0, 3, 5);
      const p = display.getProgress(1);
      expect(p!.completedItems).toBe(3);
      expect(p!.inProgressItems).toBe(0);
      expect(p!.totalItems).toBe(3);
      expect(p!.findingsCount).toBe(5);
    });

    it('does not affect other instance fields like status or round', () => {
      const display = new ProgressDisplay([1], 2);
      display.setProgress(1, { currentRound: 2, status: 'running' });

      display.updateProgress(1, 3, 1, 5, 2);

      const p = display.getProgress(1);
      expect(p!.currentRound).toBe(2);
      expect(p!.status).toBe('running');
      expect(p!.completedItems).toBe(3);
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
    it('starts and stops rendering without errors', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const display = new ProgressDisplay([1], 1);

      display.start(100);
      display.stop();

      stderrSpy.mockRestore();
    });
  });

  describe('verification: 2 mock instances with advancing progress via updateProgress', () => {
    it('each instance has its own progress bar that updates as progress events arrive', () => {
      const display = new ProgressDisplay([1, 2], 2);
      const baseTime = 1000000000;

      display.setProgress(1, { roundStartTime: baseTime - 60000, startTime: baseTime - 60000 });
      display.setProgress(2, { roundStartTime: baseTime - 45000, startTime: baseTime - 45000 });

      // Step 1: Initial state — no progress updates yet
      const lines0 = display.renderLines(baseTime);
      expect(lines0).toHaveLength(2);
      expect(lines0[0]).toContain('I1');
      expect(lines0[0]).toContain('0%');
      expect(lines0[1]).toContain('I2');
      expect(lines0[1]).toContain('0%');

      // Step 2: Push initial progress (nothing complete yet)
      display.updateProgress(1, 0, 0, 4, 0);
      display.updateProgress(2, 0, 0, 3, 0);

      const lines1 = display.renderLines(baseTime);
      expect(lines1[0]).toContain('0/4 areas');
      expect(lines1[0]).toContain('0%');
      expect(lines1[1]).toContain('0/3 areas');
      expect(lines1[1]).toContain('0%');

      // Step 3: Instance 1 completes 1 area, Instance 2 completes 2 areas
      display.updateProgress(1, 1, 1, 4, 1);
      display.updateProgress(2, 2, 1, 3, 2);

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
      display.updateProgress(1, 3, 1, 4, 1);
      display.updateProgress(2, 3, 0, 3, 2);

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

      // Push progress via updateProgress
      display.updateProgress(1, 2, 0, 4, 3);
      display.updateProgress(2, 1, 1, 2, 1);

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

  describe('color states', () => {
    describe('formatProgressLine color output', () => {
      const baseProgress: InstanceProgress = {
        instanceNumber: 1,
        currentRound: 1,
        totalRounds: 2,
        totalItems: 6,
        completedItems: 3,
        inProgressItems: 1,
        findingsCount: 2,
        screenshotCount: 0,
        startTime: 900000,
        roundStartTime: 900000,
        status: 'running',
        priorRoundDurations: [],
      };

      it('renders running state without color codes (white/default)', () => {
        const line = formatProgressLine(baseProgress, 960000);
        expect(line).not.toContain(ANSI_RED);
        expect(line).not.toContain(ANSI_GREEN);
        expect(line).not.toContain(ANSI_RESET);
        expect(line).toContain('I1');
        expect(line).toContain('50%');
        expect(line).toContain('3/6 areas');
      });

      it('renders failed state in red with error description', () => {
        const failed: InstanceProgress = {
          ...baseProgress,
          status: 'failed',
          error: 'Process crashed unexpectedly',
        };
        const line = formatProgressLine(failed, 960000);
        expect(line).toContain(ANSI_RED);
        expect(line).toContain(ANSI_RESET);
        expect(line).toContain('ERROR: Process crashed unexpectedly');
        expect(line).not.toContain(ANSI_GREEN);
      });

      it('renders failed state with default error when error is missing', () => {
        const failed: InstanceProgress = {
          ...baseProgress,
          status: 'failed',
        };
        const line = formatProgressLine(failed, 960000);
        expect(line).toContain(ANSI_RED);
        expect(line).toContain('ERROR: Unknown error');
      });

      it('renders retrying state in red with attempt info', () => {
        const retrying: InstanceProgress = {
          ...baseProgress,
          status: 'retrying',
          retryAttempt: 2,
          maxRetries: 3,
        };
        const line = formatProgressLine(retrying, 960000);
        expect(line).toContain(ANSI_RED);
        expect(line).toContain(ANSI_RESET);
        expect(line).toContain('Retrying (attempt 2/3)...');
        expect(line).not.toContain(ANSI_GREEN);
      });

      it('renders retrying state with defaults when attempt/max missing', () => {
        const retrying: InstanceProgress = {
          ...baseProgress,
          status: 'retrying',
        };
        const line = formatProgressLine(retrying, 960000);
        expect(line).toContain(ANSI_RED);
        expect(line).toContain('Retrying (attempt 1/3)...');
      });

      it('renders completed state in green with stats', () => {
        const completed: InstanceProgress = {
          ...baseProgress,
          status: 'completed',
          completedItems: 6,
          totalItems: 6,
        };
        const line = formatProgressLine(completed, 960000);
        expect(line).toContain(ANSI_GREEN);
        expect(line).toContain(ANSI_RESET);
        expect(line).toContain('6/6 areas');
        expect(line).toContain('2 findings');
        expect(line).not.toContain(ANSI_RED);
        // Completed state should not have ETA
        expect(line).not.toContain('ETA');
      });

      it('renders permanently failed state in red with retries exhausted message', () => {
        const permFailed: InstanceProgress = {
          ...baseProgress,
          status: 'failed',
          error: 'Timeout after 30 minutes',
          permanentlyFailed: true,
        };
        const line = formatProgressLine(permFailed, 960000);
        expect(line).toContain(ANSI_RED);
        expect(line).toContain(ANSI_RESET);
        expect(line).toContain('FAILED: Timeout after 30 minutes (retries exhausted)');
        expect(line).not.toContain(ANSI_GREEN);
      });

      it('permanently failed takes precedence over regular failed', () => {
        const permFailed: InstanceProgress = {
          ...baseProgress,
          status: 'failed',
          error: 'Some error',
          permanentlyFailed: true,
        };
        const line = formatProgressLine(permFailed, 960000);
        // Should show "FAILED:" not "ERROR:"
        expect(line).toContain('FAILED:');
        expect(line).toContain('(retries exhausted)');
        expect(line).not.toContain('ERROR:');
      });
    });

    describe('ProgressDisplay state transition methods', () => {
      it('markRetrying sets retrying state with attempt info', () => {
        const display = new ProgressDisplay([1], 2);
        display.markRetrying(1, 1, 3);

        const p = display.getProgress(1)!;
        expect(p.status).toBe('retrying');
        expect(p.retryAttempt).toBe(1);
        expect(p.maxRetries).toBe(3);
      });

      it('markRunning clears error and retry state', () => {
        const display = new ProgressDisplay([1], 2);
        display.markFailed(1, 'Crash');
        display.markRunning(1);

        const p = display.getProgress(1)!;
        expect(p.status).toBe('running');
        expect(p.error).toBeUndefined();
        expect(p.retryAttempt).toBeUndefined();
        expect(p.maxRetries).toBeUndefined();
      });

      it('markPermanentlyFailed sets failed status with permanentlyFailed flag', () => {
        const display = new ProgressDisplay([1], 2);
        display.markPermanentlyFailed(1, 'Max retries exceeded');

        const p = display.getProgress(1)!;
        expect(p.status).toBe('failed');
        expect(p.error).toBe('Max retries exceeded');
        expect(p.permanentlyFailed).toBe(true);
      });

      it('markRetrying on non-existent instance is a no-op', () => {
        const display = new ProgressDisplay([1], 1);
        display.markRetrying(99, 1, 3);
        expect(display.getProgress(99)).toBeUndefined();
      });

      it('markRunning on non-existent instance is a no-op', () => {
        const display = new ProgressDisplay([1], 1);
        display.markRunning(99);
        expect(display.getProgress(99)).toBeUndefined();
      });

      it('markPermanentlyFailed on non-existent instance is a no-op', () => {
        const display = new ProgressDisplay([1], 1);
        display.markPermanentlyFailed(99, 'error');
        expect(display.getProgress(99)).toBeUndefined();
      });
    });

    describe('consolidation state methods', () => {
      it('startConsolidation sets running state', () => {
        const display = new ProgressDisplay([1], 1);
        display.startConsolidation();
        const state = display.getConsolidationState();
        expect(state.status).toBe('running');
        expect(state.spinnerFrame).toBe(0);
      });

      it('completeConsolidation sets completed state with paths', () => {
        const display = new ProgressDisplay([1], 1);
        display.completeConsolidation('/output/report.md', '/output/discovery.md');
        const state = display.getConsolidationState();
        expect(state.status).toBe('completed');
        expect(state.reportPath).toBe('/output/report.md');
        expect(state.discoveryPath).toBe('/output/discovery.md');
      });

      it('getConsolidationState returns idle by default', () => {
        const display = new ProgressDisplay([1], 1);
        const state = display.getConsolidationState();
        expect(state.status).toBe('idle');
      });
    });

    describe('full color state lifecycle simulation', () => {
      it('simulates: running (white) → failure (red) → retry (red) → running (white) → completed (green)', () => {
        const display = new ProgressDisplay([1], 2);
        const baseTime = 5000000;

        // Step 1: Running state — white (no color codes)
        display.setProgress(1, {
          totalItems: 4,
          completedItems: 2,
          findingsCount: 1,
          roundStartTime: baseTime - 30000,
        });

        let lines = display.renderLines(baseTime);
        expect(lines[0]).not.toContain(ANSI_RED);
        expect(lines[0]).not.toContain(ANSI_GREEN);
        expect(lines[0]).toContain('50%');
        expect(lines[0]).toContain('2/4 areas');

        // Step 2: Failure detected — red with error
        display.markFailed(1, 'Claude process timed out');

        lines = display.renderLines(baseTime);
        expect(lines[0]).toContain(ANSI_RED);
        expect(lines[0]).toContain('ERROR: Claude process timed out');
        expect(lines[0]).toContain(ANSI_RESET);

        // Step 3: Retry begins — red with retry info
        display.markRetrying(1, 1, 3);

        lines = display.renderLines(baseTime);
        expect(lines[0]).toContain(ANSI_RED);
        expect(lines[0]).toContain('Retrying (attempt 1/3)...');
        expect(lines[0]).toContain(ANSI_RESET);

        // Step 4: Retry succeeds, back to running — white
        display.markRunning(1);

        lines = display.renderLines(baseTime);
        expect(lines[0]).not.toContain(ANSI_RED);
        expect(lines[0]).not.toContain(ANSI_GREEN);
        expect(lines[0]).toContain('2/4 areas');

        // Step 5: Instance completes all rounds — green
        display.setProgress(1, {
          completedItems: 4,
          totalItems: 4,
          findingsCount: 3,
        });
        display.markCompleted(1);

        lines = display.renderLines(baseTime);
        expect(lines[0]).toContain(ANSI_GREEN);
        expect(lines[0]).toContain('4/4 areas');
        expect(lines[0]).toContain('3 findings');
        expect(lines[0]).toContain(ANSI_RESET);
        expect(lines[0]).not.toContain(ANSI_RED);
      });

      it('simulates: running → failure → retry exhausted → permanently failed (stays red)', () => {
        const display = new ProgressDisplay([1], 1);
        const baseTime = 5000000;

        // Step 1: Running
        display.setProgress(1, {
          totalItems: 4,
          completedItems: 1,
          roundStartTime: baseTime - 20000,
        });

        let lines = display.renderLines(baseTime);
        expect(lines[0]).not.toContain(ANSI_RED);
        expect(lines[0]).not.toContain(ANSI_GREEN);

        // Step 2: First failure
        display.markFailed(1, 'Connection reset');

        lines = display.renderLines(baseTime);
        expect(lines[0]).toContain(ANSI_RED);
        expect(lines[0]).toContain('ERROR: Connection reset');

        // Step 3: Retry attempt 1
        display.markRetrying(1, 1, 3);
        lines = display.renderLines(baseTime);
        expect(lines[0]).toContain('Retrying (attempt 1/3)...');

        // Step 4: Retry 1 fails
        display.markFailed(1, 'Connection reset again');
        lines = display.renderLines(baseTime);
        expect(lines[0]).toContain('ERROR: Connection reset again');

        // Step 5: Retry attempt 2
        display.markRetrying(1, 2, 3);
        lines = display.renderLines(baseTime);
        expect(lines[0]).toContain('Retrying (attempt 2/3)...');

        // Step 6: Retry 2 fails
        display.markFailed(1, 'Still failing');

        // Step 7: Retry attempt 3
        display.markRetrying(1, 3, 3);
        lines = display.renderLines(baseTime);
        expect(lines[0]).toContain('Retrying (attempt 3/3)...');

        // Step 8: Retry 3 fails — permanently failed
        display.markPermanentlyFailed(1, 'Connection reset after 3 retries');

        lines = display.renderLines(baseTime);
        expect(lines[0]).toContain(ANSI_RED);
        expect(lines[0]).toContain('FAILED: Connection reset after 3 retries (retries exhausted)');
        expect(lines[0]).toContain(ANSI_RESET);
        expect(lines[0]).not.toContain(ANSI_GREEN);

        // Step 9: Verify it stays red — rendering again produces same result
        lines = display.renderLines(baseTime + 60000);
        expect(lines[0]).toContain(ANSI_RED);
        expect(lines[0]).toContain('FAILED:');
        expect(lines[0]).toContain('(retries exhausted)');
      });

      it('multiple instances show independent color states', () => {
        const display = new ProgressDisplay([1, 2, 3], 1);
        const baseTime = 5000000;

        display.setProgress(1, { totalItems: 4, completedItems: 2, roundStartTime: baseTime - 30000 });
        display.setProgress(2, { totalItems: 3, completedItems: 3, roundStartTime: baseTime - 60000 });
        display.setProgress(3, { totalItems: 5, completedItems: 1, roundStartTime: baseTime - 10000 });

        // Instance 1: running (white), Instance 2: completed (green), Instance 3: failed (red)
        display.markCompleted(2);
        display.markFailed(3, 'Playwright timeout');

        const lines = display.renderLines(baseTime);

        // Instance 1: running — no color
        expect(lines[0]).not.toContain(ANSI_RED);
        expect(lines[0]).not.toContain(ANSI_GREEN);
        expect(lines[0]).toContain('I1');

        // Instance 2: completed — green
        expect(lines[1]).toContain(ANSI_GREEN);
        expect(lines[1]).not.toContain(ANSI_RED);
        expect(lines[1]).toContain('I2');

        // Instance 3: failed — red
        expect(lines[2]).toContain(ANSI_RED);
        expect(lines[2]).not.toContain(ANSI_GREEN);
        expect(lines[2]).toContain('I3');
        expect(lines[2]).toContain('ERROR: Playwright timeout');
      });
    });
  });

  describe('consolidation phase indicator', () => {
    it('renderLines does not include consolidation line when idle', () => {
      const display = new ProgressDisplay([1], 1);
      const lines = display.renderLines();
      expect(lines).toHaveLength(1); // just the instance line
    });

    it('renderLines includes consolidation spinner when running', () => {
      const display = new ProgressDisplay([1], 1);
      display.markCompleted(1);
      display.startConsolidation();

      const lines = display.renderLines();
      // Instance line + consolidation line
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('Consolidating reports...');
    });

    it('renderLines includes completion info with paths when done', () => {
      const display = new ProgressDisplay([1, 2], 1);
      display.markCompleted(1);
      display.markCompleted(2);
      display.completeConsolidation('/out/report.md', '/out/discovery.md');

      const lines = display.renderLines();
      // 2 instance lines + 3 consolidation lines (checkmark, report path, discovery path)
      expect(lines).toHaveLength(5);
      expect(lines[2]).toContain('✓ Consolidation complete');
      expect(lines[3]).toContain('Report:    /out/report.md');
      expect(lines[4]).toContain('Discovery: /out/discovery.md');
    });

    it('renderToTerminal advances the spinner frame', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const display = new ProgressDisplay([1], 1);
      display.markCompleted(1);
      display.startConsolidation();

      expect(display.getConsolidationState().spinnerFrame).toBe(0);

      display.renderToTerminal();
      expect(display.getConsolidationState().spinnerFrame).toBe(1);

      display.renderToTerminal();
      expect(display.getConsolidationState().spinnerFrame).toBe(2);

      stderrSpy.mockRestore();
    });

    it('renderToTerminal does not advance spinner after completion', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const display = new ProgressDisplay([1], 1);
      display.completeConsolidation('/out/report.md', '/out/discovery.md');

      display.renderToTerminal();
      display.renderToTerminal();
      expect(display.getConsolidationState().spinnerFrame).toBe(0);

      stderrSpy.mockRestore();
    });

    it('full lifecycle: instances complete → consolidation running → consolidation done', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const display = new ProgressDisplay([1, 2], 1);
      const baseTime = 8000000;

      // Step 1: All instances complete
      display.setProgress(1, { totalItems: 3, completedItems: 3, findingsCount: 2, roundStartTime: baseTime - 60000 });
      display.setProgress(2, { totalItems: 4, completedItems: 4, findingsCount: 3, roundStartTime: baseTime - 90000 });
      display.markCompleted(1);
      display.markCompleted(2);

      let lines = display.renderLines(baseTime);
      expect(lines).toHaveLength(2); // no consolidation yet
      expect(lines[0]).toContain(ANSI_GREEN);
      expect(lines[1]).toContain(ANSI_GREEN);

      // Step 2: Start consolidation
      display.startConsolidation();

      lines = display.renderLines(baseTime);
      expect(lines).toHaveLength(3);
      expect(lines[2]).toContain('Consolidating reports...');

      // Step 3: Complete consolidation
      display.completeConsolidation('/output/report.md', '/output/discovery.md');

      lines = display.renderLines(baseTime);
      expect(lines).toHaveLength(5); // 2 instances + checkmark + report + discovery
      expect(lines[2]).toContain('✓ Consolidation complete');
      expect(lines[3]).toContain('Report:    /output/report.md');
      expect(lines[4]).toContain('Discovery: /output/discovery.md');

      stderrSpy.mockRestore();
    });

    it('works with mixed completed and permanently failed instances', () => {
      const display = new ProgressDisplay([1, 2, 3], 1);
      const baseTime = 8000000;

      display.setProgress(1, { totalItems: 3, completedItems: 3, findingsCount: 2, roundStartTime: baseTime - 60000 });
      display.setProgress(2, { totalItems: 4, completedItems: 1, roundStartTime: baseTime - 90000 });
      display.setProgress(3, { totalItems: 5, completedItems: 5, findingsCount: 4, roundStartTime: baseTime - 120000 });
      display.markCompleted(1);
      display.markPermanentlyFailed(2, 'API rate limit');
      display.markCompleted(3);

      display.startConsolidation();

      let lines = display.renderLines(baseTime);
      expect(lines).toHaveLength(4); // 3 instances + consolidation spinner
      expect(lines[0]).toContain(ANSI_GREEN); // I1 completed
      expect(lines[1]).toContain(ANSI_RED); // I2 permanently failed
      expect(lines[1]).toContain('FAILED:');
      expect(lines[2]).toContain(ANSI_GREEN); // I3 completed
      expect(lines[3]).toContain('Consolidating reports...');

      display.completeConsolidation('/out/report.md', '/out/discovery.md');

      lines = display.renderLines(baseTime);
      expect(lines).toHaveLength(6); // 3 instances + 3 consolidation lines
      expect(lines[3]).toContain('✓ Consolidation complete');
      expect(lines[4]).toContain('/out/report.md');
      expect(lines[5]).toContain('/out/discovery.md');
    });
  });
});

describe('safeStatMtimeMs debug logging', () => {
  it('returns null and calls debug when statSync throws', () => {
    const display = new ProgressDisplay([1], 1);
    // Access private method via type cast
    const result = (display as any).safeStatMtimeMs('/nonexistent/path/to/file');
    expect(result).toBeNull();
  });
});

describe('ProgressDisplay start() timer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates interval that calls pollCheckpoints and renderToTerminal on each tick', () => {
    vi.useFakeTimers();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const display = new ProgressDisplay([1], 1);
    const pollSpy = vi.spyOn(display, 'pollCheckpoints').mockImplementation(() => {});
    const renderSpy = vi.spyOn(display, 'renderToTerminal').mockImplementation(() => {});

    display.start(500);

    // start() calls pollCheckpoints and renderToTerminal once immediately
    expect(pollSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Advance past the first interval tick
    vi.advanceTimersByTime(500);
    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(renderSpy).toHaveBeenCalledTimes(2);

    // Advance past a second interval tick
    vi.advanceTimersByTime(500);
    expect(pollSpy).toHaveBeenCalledTimes(3);
    expect(renderSpy).toHaveBeenCalledTimes(3);

    // Stop clears the interval — no more ticks after stop
    display.stop();
    vi.advanceTimersByTime(1000);
    // stop() itself calls renderToTerminal once, so count is 4
    expect(renderSpy).toHaveBeenCalledTimes(4);
    // pollCheckpoints is NOT called by stop(), so stays at 3
    expect(pollSpy).toHaveBeenCalledTimes(3);

    stderrSpy.mockRestore();
  });
});
