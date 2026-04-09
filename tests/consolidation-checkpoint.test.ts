import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  writeConsolidationCheckpoint,
  readConsolidationCheckpoint,
  createEmptyConsolidationCheckpoint,
  isStepCompleted,
  ConsolidationCheckpoint,
  CONSOLIDATION_STEPS,
} from '../src/consolidation-checkpoint.js';

const TEST_TEMP_DIR = resolve('.uxreview-temp-consol-cp-test');
const CHECKPOINT_PATH = join(TEST_TEMP_DIR, 'consolidation-checkpoint.json');

// Mock file-manager to use our test directory
vi.mock('../src/file-manager.js', () => ({
  getTempDir: () => TEST_TEMP_DIR,
}));

beforeEach(() => {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_TEMP_DIR)) {
    rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  }
});

describe('createEmptyConsolidationCheckpoint', () => {
  it('creates a checkpoint with no completed steps', () => {
    const cp = createEmptyConsolidationCheckpoint();

    expect(cp.completedSteps).toEqual([]);
    expect(cp.dedupOutput).toBeNull();
    expect(cp.reassignOutput).toBeNull();
    expect(cp.hierarchyOutput).toBeNull();
    expect(cp.formatReportOutput).toBeNull();
    expect(cp.discoveryMergeOutput).toBeNull();
    expect(cp.timestamp).toBeTruthy();
  });
});

describe('writeConsolidationCheckpoint / readConsolidationCheckpoint', () => {
  it('writes and reads back a checkpoint with all fields correct', () => {
    const checkpoint: ConsolidationCheckpoint = {
      completedSteps: ['dedup', 'reassign'],
      dedupOutput: { findings: [{ id: 'UXR-001', title: 'Test', uiArea: 'Navigation', severity: 'major' as const, description: 'desc', suggestion: 'sug', screenshot: 'UXR-001.png' }], duplicateGroups: [], usedClaude: true },
      reassignOutput: [{ id: 'UXR-001', title: 'Test', uiArea: 'Navigation', severity: 'major' as const, description: 'desc', suggestion: 'sug', screenshot: 'UXR-001.png' }],
      hierarchyOutput: null,
      formatReportOutput: null,
      discoveryMergeOutput: null,
      timestamp: '2026-04-07T12:00:00.000Z',
    };

    writeConsolidationCheckpoint(checkpoint);
    const result = readConsolidationCheckpoint();

    expect(result).not.toBeNull();
    expect(result!.completedSteps).toEqual(['dedup', 'reassign']);
    expect(result!.dedupOutput).toEqual(checkpoint.dedupOutput);
    expect(result!.reassignOutput).toEqual(checkpoint.reassignOutput);
    expect(result!.hierarchyOutput).toBeNull();
    expect(result!.formatReportOutput).toBeNull();
    expect(result!.discoveryMergeOutput).toBeNull();
    expect(result!.timestamp).toBe('2026-04-07T12:00:00.000Z');
  });

  it('writes and reads back a fully completed checkpoint', () => {
    const checkpoint: ConsolidationCheckpoint = {
      completedSteps: [...CONSOLIDATION_STEPS],
      dedupOutput: { findings: [], duplicateGroups: [], usedClaude: false },
      reassignOutput: [{ id: 'UXR-001', title: 'Finding', uiArea: 'Nav', severity: 'minor' as const, description: 'd', suggestion: 's', screenshot: 'UXR-001.png' }],
      hierarchyOutput: [{ area: 'Nav', findings: [{ finding: { id: 'UXR-001', title: 'Finding', uiArea: 'Nav', severity: 'minor' as const, description: 'd', suggestion: 's', screenshot: 'UXR-001.png' }, children: [] }] }],
      formatReportOutput: '# UX Report\n\nNo findings.',
      discoveryMergeOutput: '# Discovery\n\nAll areas explored.',
      timestamp: '2026-04-07T13:00:00.000Z',
    };

    writeConsolidationCheckpoint(checkpoint);
    const result = readConsolidationCheckpoint();

    expect(result).not.toBeNull();
    expect(result!.completedSteps).toEqual(CONSOLIDATION_STEPS);
    expect(result!.dedupOutput).toEqual({ findings: [], duplicateGroups: [], usedClaude: false });
    expect(result!.reassignOutput).toEqual(checkpoint.reassignOutput);
    expect(result!.hierarchyOutput).toEqual(checkpoint.hierarchyOutput);
    expect(result!.formatReportOutput).toBe('# UX Report\n\nNo findings.');
    expect(result!.discoveryMergeOutput).toBe('# Discovery\n\nAll areas explored.');
  });

  it('returns null when no checkpoint file exists', () => {
    const result = readConsolidationCheckpoint();
    expect(result).toBeNull();
  });

  it('returns null when checkpoint file contains invalid JSON', () => {
    writeFileSync(CHECKPOINT_PATH, 'not valid json {{{', 'utf-8');

    const result = readConsolidationCheckpoint();
    expect(result).toBeNull();
  });

  it('logs a debug message when checkpoint read fails due to invalid JSON', async () => {
    const logger = await import('../src/logger.js');
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});

    writeFileSync(CHECKPOINT_PATH, 'not valid json {{{', 'utf-8');

    const result = readConsolidationCheckpoint();
    expect(result).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('readConsolidationCheckpoint failed:'),
    );

    debugSpy.mockRestore();
  });

  it('returns null when checkpoint is missing required fields', () => {
    writeFileSync(
      CHECKPOINT_PATH,
      JSON.stringify({ completedSteps: ['dedup'] }),
      'utf-8',
    );

    const result = readConsolidationCheckpoint();
    expect(result).toBeNull();
  });

  it('returns null when completedSteps is not an array', () => {
    writeFileSync(
      CHECKPOINT_PATH,
      JSON.stringify({
        completedSteps: 'dedup',
        dedupOutput: null,
        reassignOutput: null,
        hierarchyOutput: null,
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: '2026-04-07T12:00:00.000Z',
      }),
      'utf-8',
    );

    const result = readConsolidationCheckpoint();
    expect(result).toBeNull();
  });

  it('returns null when completedSteps contains unknown step names', () => {
    writeFileSync(
      CHECKPOINT_PATH,
      JSON.stringify({
        completedSteps: ['dedup', 'unknown-step'],
        dedupOutput: null,
        reassignOutput: null,
        hierarchyOutput: null,
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: '2026-04-07T12:00:00.000Z',
      }),
      'utf-8',
    );

    const result = readConsolidationCheckpoint();
    expect(result).toBeNull();
  });

  it('returns null when timestamp is not a string', () => {
    writeFileSync(
      CHECKPOINT_PATH,
      JSON.stringify({
        completedSteps: [],
        dedupOutput: null,
        reassignOutput: null,
        hierarchyOutput: null,
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: 12345,
      }),
      'utf-8',
    );

    const result = readConsolidationCheckpoint();
    expect(result).toBeNull();
  });

  it('returns null when a nullable output field has wrong type', () => {
    writeFileSync(
      CHECKPOINT_PATH,
      JSON.stringify({
        completedSteps: ['dedup'],
        dedupOutput: 42,
        reassignOutput: null,
        hierarchyOutput: null,
        formatReportOutput: null,
        discoveryMergeOutput: null,
        timestamp: '2026-04-07T12:00:00.000Z',
      }),
      'utf-8',
    );

    const result = readConsolidationCheckpoint();
    expect(result).toBeNull();
  });

  it('overwrites previous checkpoint on re-write', () => {
    const cp1 = createEmptyConsolidationCheckpoint();
    writeConsolidationCheckpoint(cp1);

    const cp2: ConsolidationCheckpoint = {
      ...cp1,
      completedSteps: ['dedup'],
      dedupOutput: { findings: [], duplicateGroups: [], usedClaude: true },
    };
    writeConsolidationCheckpoint(cp2);

    const result = readConsolidationCheckpoint();
    expect(result!.completedSteps).toEqual(['dedup']);
    expect(result!.dedupOutput).toEqual({ findings: [], duplicateGroups: [], usedClaude: true });
  });

  it('writes valid JSON that can be parsed by JSON.parse', () => {
    const cp = createEmptyConsolidationCheckpoint();
    writeConsolidationCheckpoint(cp);

    const raw = readFileSync(CHECKPOINT_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.completedSteps).toEqual([]);
    expect(parsed.timestamp).toBeTruthy();
  });
});

describe('isStepCompleted', () => {
  it('returns false for steps not in completedSteps', () => {
    const cp = createEmptyConsolidationCheckpoint();
    expect(isStepCompleted(cp, 'dedup')).toBe(false);
    expect(isStepCompleted(cp, 'hierarchy')).toBe(false);
  });

  it('returns true for steps in completedSteps', () => {
    const cp: ConsolidationCheckpoint = {
      ...createEmptyConsolidationCheckpoint(),
      completedSteps: ['dedup', 'reassign'],
    };
    expect(isStepCompleted(cp, 'dedup')).toBe(true);
    expect(isStepCompleted(cp, 'reassign')).toBe(true);
    expect(isStepCompleted(cp, 'hierarchy')).toBe(false);
  });
});

describe('CONSOLIDATION_STEPS', () => {
  it('contains all six steps in order', () => {
    expect(CONSOLIDATION_STEPS).toEqual([
      'dedup',
      'reassign',
      'hierarchy',
      'format-report',
      'discovery-merge',
      'write-discovery',
    ]);
  });
});
