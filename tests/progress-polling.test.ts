import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock checkpoint module
vi.mock('../src/checkpoint.js', () => ({
  readCheckpoint: vi.fn(),
}));

// Mock report module
vi.mock('../src/report.js', () => ({
  readReportContent: vi.fn(),
  countFindings: vi.fn(),
}));

// Mock screenshots module
vi.mock('../src/screenshots.js', () => ({
  listScreenshots: vi.fn(() => []),
}));

import { ProgressDisplay } from '../src/progress-display.js';
import { readCheckpoint } from '../src/checkpoint.js';
import { readReportContent, countFindings } from '../src/report.js';
import { listScreenshots } from '../src/screenshots.js';

const mockReadCheckpoint = vi.mocked(readCheckpoint);
const mockReadReportContent = vi.mocked(readReportContent);
const mockCountFindings = vi.mocked(countFindings);
const mockListScreenshots = vi.mocked(listScreenshots);

describe('ProgressDisplay.pollCheckpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates running instances from checkpoint and report files', () => {
    const display = new ProgressDisplay([1, 2], 1);

    mockReadCheckpoint.mockImplementation((num) => {
      if (num === 1) {
        return {
          instanceId: 1,
          assignedAreas: ['Nav', 'Dashboard', 'Settings', 'Profile'],
          currentRound: 1,
          areas: [
            { name: 'Nav', status: 'complete' },
            { name: 'Dashboard', status: 'complete' },
            { name: 'Settings', status: 'in-progress' },
            { name: 'Profile', status: 'not-started' },
          ],
          lastAction: 'Reviewing settings page',
          timestamp: new Date().toISOString(),
        };
      }
      if (num === 2) {
        return {
          instanceId: 2,
          assignedAreas: ['Forms', 'Tables', 'Charts'],
          currentRound: 1,
          areas: [
            { name: 'Forms', status: 'not-started' },
            { name: 'Tables', status: 'in-progress' },
            { name: 'Charts', status: 'not-started' },
          ],
          lastAction: 'Starting tables review',
          timestamp: new Date().toISOString(),
        };
      }
      return null;
    });

    mockReadReportContent.mockImplementation((num) => {
      if (num === 1) return '## I1-UXR-001: Bug\n## I1-UXR-002: Bug\n## I1-UXR-003: Bug';
      return null;
    });
    mockCountFindings.mockImplementation((content) => {
      const matches = content.match(/^## I\d+-UXR-\d+:/gm);
      return matches ? matches.length : 0;
    });

    display.pollCheckpoints();

    const p1 = display.getProgress(1)!;
    expect(p1.completedItems).toBe(2);
    expect(p1.inProgressItems).toBe(1);
    expect(p1.totalItems).toBe(4);
    expect(p1.findingsCount).toBe(3);

    const p2 = display.getProgress(2)!;
    expect(p2.completedItems).toBe(0);
    expect(p2.inProgressItems).toBe(1);
    expect(p2.totalItems).toBe(3);
    expect(p2.findingsCount).toBe(0);
  });

  it('skips non-running instances', () => {
    const display = new ProgressDisplay([1], 1);
    display.markCompleted(1);

    display.pollCheckpoints();

    expect(mockReadCheckpoint).not.toHaveBeenCalled();
  });

  it('handles null checkpoint gracefully', () => {
    const display = new ProgressDisplay([1], 1);
    mockReadCheckpoint.mockReturnValue(null);
    mockReadReportContent.mockReturnValue(null);

    display.pollCheckpoints();

    const p = display.getProgress(1)!;
    expect(p.completedItems).toBe(0);
    expect(p.totalItems).toBe(0);
    expect(p.findingsCount).toBe(0);
  });

  it('updates area progress even when report is null', () => {
    const display = new ProgressDisplay([1], 1);
    mockReadCheckpoint.mockReturnValue({
      instanceId: 1,
      assignedAreas: ['A', 'B'],
      currentRound: 1,
      areas: [
        { name: 'A', status: 'complete' },
        { name: 'B', status: 'not-started' },
      ],
      lastAction: 'Done with A',
      timestamp: new Date().toISOString(),
    });
    mockReadReportContent.mockReturnValue(null);

    display.pollCheckpoints();

    const p = display.getProgress(1)!;
    expect(p.completedItems).toBe(1);
    expect(p.totalItems).toBe(2);
    expect(p.findingsCount).toBe(0);
  });

  it('does not overwrite completed instance data', () => {
    const display = new ProgressDisplay([1], 1);
    display.updateProgress(1, 5, 0, 5, 10);
    display.markCompleted(1);

    mockReadCheckpoint.mockReturnValue({
      instanceId: 1,
      assignedAreas: ['A'],
      currentRound: 1,
      areas: [{ name: 'A', status: 'not-started' }],
      lastAction: 'stale',
      timestamp: new Date().toISOString(),
    });

    display.pollCheckpoints();

    const p = display.getProgress(1)!;
    expect(p.status).toBe('completed');
    expect(p.completedItems).toBe(5);
    expect(p.findingsCount).toBe(10);
  });

  it('does not overwrite failed instance data', () => {
    const display = new ProgressDisplay([1], 1);
    display.markFailed(1, 'crash');

    display.pollCheckpoints();

    expect(mockReadCheckpoint).not.toHaveBeenCalled();
    expect(display.getProgress(1)!.status).toBe('failed');
  });

  it('updates screenshot count from listScreenshots', () => {
    const display = new ProgressDisplay([1], 1);
    mockReadCheckpoint.mockReturnValue(null);
    mockReadReportContent.mockReturnValue(null);
    mockListScreenshots.mockReturnValue(['I1-UXR-001.png', 'I1-UXR-002.png', 'I1-UXR-002-a.png']);

    display.pollCheckpoints();

    const p = display.getProgress(1)!;
    expect(p.screenshotCount).toBe(3);
  });

  it('sets screenshot count to 0 when no screenshots exist', () => {
    const display = new ProgressDisplay([1], 1);
    mockReadCheckpoint.mockReturnValue(null);
    mockReadReportContent.mockReturnValue(null);
    mockListScreenshots.mockReturnValue([]);

    display.pollCheckpoints();

    const p = display.getProgress(1)!;
    expect(p.screenshotCount).toBe(0);
  });

  it('updates only findingsCount when checkpoint is corrupt but findings changed', () => {
    const display = new ProgressDisplay([1], 1);

    // Set initial progress with known findingsCount
    display.updateProgress(1, 2, 1, 5, 3);

    // Checkpoint is corrupt/unreadable (returns null)
    mockReadCheckpoint.mockReturnValue(null);

    // But the report file has new findings (different from current 3)
    mockReadReportContent.mockReturnValue(
      '## I1-UXR-001: Bug\n## I1-UXR-002: Bug\n## I1-UXR-003: Bug\n## I1-UXR-004: New bug\n## I1-UXR-005: Another new bug',
    );
    mockCountFindings.mockReturnValue(5);

    display.pollCheckpoints();

    const p = display.getProgress(1)!;
    // findingsCount should be updated to 5 (from the report)
    expect(p.findingsCount).toBe(5);
    // Area progress should remain unchanged since checkpoint was unreadable
    expect(p.completedItems).toBe(2);
    expect(p.inProgressItems).toBe(1);
    expect(p.totalItems).toBe(5);
  });
});
