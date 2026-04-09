import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  writeCheckpoint,
  readCheckpoint,
  createInitialCheckpoint,
  buildResumePrompt,
  Checkpoint,
} from '../src/checkpoint.js';

// Use a test-specific temp directory to avoid conflicts
const TEST_TEMP_DIR = resolve('.uxreview-temp-checkpoint-test');

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
}));

function ensureInstanceDir(instanceNumber: number): string {
  const dir = join(TEST_TEMP_DIR, `instance-${instanceNumber}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_TEMP_DIR)) {
    rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  }
});

describe('createInitialCheckpoint', () => {
  it('creates a checkpoint with all areas set to not-started', () => {
    const cp = createInitialCheckpoint(1, ['Navigation', 'Dashboard', 'Settings'], 1);

    expect(cp.instanceId).toBe(1);
    expect(cp.assignedAreas).toEqual(['Navigation', 'Dashboard', 'Settings']);
    expect(cp.currentRound).toBe(1);
    expect(cp.areas).toHaveLength(3);
    expect(cp.areas[0]).toEqual({ name: 'Navigation', status: 'not-started' });
    expect(cp.areas[1]).toEqual({ name: 'Dashboard', status: 'not-started' });
    expect(cp.areas[2]).toEqual({ name: 'Settings', status: 'not-started' });
    expect(cp.lastAction).toBe('Starting review');
    expect(cp.timestamp).toBeTruthy();
  });

  it('uses the provided round number', () => {
    const cp = createInitialCheckpoint(2, ['Forms'], 3);
    expect(cp.currentRound).toBe(3);
  });
});

describe('writeCheckpoint / readCheckpoint', () => {
  it('writes and reads back a checkpoint with all fields correct', () => {
    ensureInstanceDir(1);

    const checkpoint: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Navigation', 'Dashboard', 'Settings'],
      currentRound: 1,
      areas: [
        { name: 'Navigation', status: 'complete' },
        { name: 'Dashboard', status: 'in-progress' },
        { name: 'Settings', status: 'not-started' },
      ],
      lastAction: 'Checked nav bar hover states',
      timestamp: '2026-04-02T12:00:00.000Z',
    };

    writeCheckpoint(1, checkpoint);
    const result = readCheckpoint(1);

    expect(result).not.toBeNull();
    expect(result!.instanceId).toBe(1);
    expect(result!.assignedAreas).toEqual(['Navigation', 'Dashboard', 'Settings']);
    expect(result!.currentRound).toBe(1);
    expect(result!.areas).toEqual([
      { name: 'Navigation', status: 'complete' },
      { name: 'Dashboard', status: 'in-progress' },
      { name: 'Settings', status: 'not-started' },
    ]);
    expect(result!.lastAction).toBe('Checked nav bar hover states');
    expect(result!.timestamp).toBe('2026-04-02T12:00:00.000Z');
  });

  it('returns null when no checkpoint file exists', () => {
    ensureInstanceDir(5);
    const result = readCheckpoint(5);
    expect(result).toBeNull();
  });

  it('returns null when checkpoint file contains invalid JSON', () => {
    const dir = ensureInstanceDir(2);
    writeFileSync(join(dir, 'checkpoint.json'), 'not valid json {{{', 'utf-8');

    const result = readCheckpoint(2);
    expect(result).toBeNull();
  });

  it('returns null when checkpoint is missing required fields', () => {
    const dir = ensureInstanceDir(3);
    writeFileSync(
      join(dir, 'checkpoint.json'),
      JSON.stringify({ instanceId: 3, assignedAreas: ['Nav'] }),
      'utf-8',
    );

    const result = readCheckpoint(3);
    expect(result).toBeNull();
  });

  it('coerces wrong field types when areas array is present', () => {
    const dir = ensureInstanceDir(4);
    writeFileSync(
      join(dir, 'checkpoint.json'),
      JSON.stringify({
        instanceId: 'not-a-number',
        assignedAreas: ['Nav'],
        currentRound: 1,
        areas: [],
        lastAction: 'test',
        timestamp: '2026-04-02T12:00:00.000Z',
      }),
      'utf-8',
    );

    const result = readCheckpoint(4);
    expect(result).not.toBeNull();
    expect(result!.instanceId).toBe(4); // coerced from NaN to instanceNumber fallback
    expect(result!.areas).toEqual([]);
  });

  it('returns null when areas field is not an array', () => {
    const dir = ensureInstanceDir(4);
    writeFileSync(
      join(dir, 'checkpoint.json'),
      JSON.stringify({
        instanceId: 4,
        assignedAreas: ['Nav'],
        currentRound: 1,
        areas: 'not-an-array',
        lastAction: 'test',
        timestamp: '2026-04-02T12:00:00.000Z',
      }),
      'utf-8',
    );

    const result = readCheckpoint(4);
    expect(result).toBeNull();
  });

  it('overwrites previous checkpoint on re-write', () => {
    ensureInstanceDir(1);

    const cp1 = createInitialCheckpoint(1, ['Nav'], 1);
    writeCheckpoint(1, cp1);

    const cp2: Checkpoint = {
      ...cp1,
      areas: [{ name: 'Nav', status: 'complete' }],
      lastAction: 'Finished navigation review',
    };
    writeCheckpoint(1, cp2);

    const result = readCheckpoint(1);
    expect(result!.areas[0].status).toBe('complete');
    expect(result!.lastAction).toBe('Finished navigation review');
  });

  it('writes valid JSON that can be parsed by JSON.parse', () => {
    ensureInstanceDir(1);

    const cp = createInitialCheckpoint(1, ['Area A', 'Area B'], 2);
    writeCheckpoint(1, cp);

    const dir = join(TEST_TEMP_DIR, 'instance-1');
    const raw = readFileSync(join(dir, 'checkpoint.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.instanceId).toBe(1);
    expect(parsed.currentRound).toBe(2);
  });
});

describe('buildResumePrompt', () => {
  it('includes resume instructions header', () => {
    const cp = createInitialCheckpoint(1, ['Nav'], 1);
    const prompt = buildResumePrompt(cp);
    expect(prompt).toContain('## Resume Instructions');
  });

  it('includes the current round number', () => {
    const cp = createInitialCheckpoint(1, ['Nav'], 2);
    const prompt = buildResumePrompt(cp);
    expect(prompt).toContain('**Round**: 2');
  });

  it('includes the last action', () => {
    const cp: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Nav'],
      currentRound: 1,
      areas: [{ name: 'Nav', status: 'in-progress' }],
      lastAction: 'Reviewed top nav links',
      timestamp: '2026-04-02T12:00:00.000Z',
    };
    const prompt = buildResumePrompt(cp);
    expect(prompt).toContain('Reviewed top nav links');
  });

  it('lists completed areas as skip', () => {
    const cp: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Nav', 'Dashboard'],
      currentRound: 1,
      areas: [
        { name: 'Nav', status: 'complete' },
        { name: 'Dashboard', status: 'not-started' },
      ],
      lastAction: 'Completed navigation review',
      timestamp: '2026-04-02T12:00:00.000Z',
    };
    const prompt = buildResumePrompt(cp);
    expect(prompt).toContain('Completed Areas (skip these)');
    expect(prompt).toContain('- Nav');
  });

  it('lists in-progress areas with resume instruction', () => {
    const cp: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Nav', 'Dashboard'],
      currentRound: 1,
      areas: [
        { name: 'Nav', status: 'complete' },
        { name: 'Dashboard', status: 'in-progress' },
      ],
      lastAction: 'Checked card grid layout',
      timestamp: '2026-04-02T12:00:00.000Z',
    };
    const prompt = buildResumePrompt(cp);
    expect(prompt).toContain('In-Progress Areas (resume here)');
    expect(prompt).toContain('- Dashboard');
    expect(prompt).toContain('Checked card grid layout');
  });

  it('lists not-started areas', () => {
    const cp: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Nav', 'Dashboard', 'Settings'],
      currentRound: 1,
      areas: [
        { name: 'Nav', status: 'complete' },
        { name: 'Dashboard', status: 'in-progress' },
        { name: 'Settings', status: 'not-started' },
      ],
      lastAction: 'Checked card grid',
      timestamp: '2026-04-02T12:00:00.000Z',
    };
    const prompt = buildResumePrompt(cp);
    expect(prompt).toContain('Not Started Areas (do these next)');
    expect(prompt).toContain('- Settings');
  });

  it('instructs Claude to read existing docs and append', () => {
    const cp = createInitialCheckpoint(1, ['Nav'], 1);
    const prompt = buildResumePrompt(cp);
    expect(prompt).toContain('Read your existing discovery doc and report');
    expect(prompt).toContain('append new findings');
    expect(prompt).toContain('do not overwrite');
  });

  it('simulates mid-area failure and produces correct resume prompt', () => {
    // Simulate: instance was reviewing 3 areas, completed Nav, was mid-way
    // through Dashboard (checking form validation), Settings not started yet.
    // The instance crashed. We write the checkpoint at the failure point,
    // then verify the resume prompt correctly tells Claude what to do.
    ensureInstanceDir(1);

    const failureCheckpoint: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Navigation', 'Dashboard', 'Settings'],
      currentRound: 1,
      areas: [
        { name: 'Navigation', status: 'complete' },
        { name: 'Dashboard', status: 'in-progress' },
        { name: 'Settings', status: 'not-started' },
      ],
      lastAction: 'Checked dashboard card grid spacing, about to review form validation',
      timestamp: '2026-04-02T12:30:00.000Z',
    };

    // Write checkpoint at failure point
    writeCheckpoint(1, failureCheckpoint);

    // Read it back (simulating orchestrator reading after crash)
    const recovered = readCheckpoint(1);
    expect(recovered).not.toBeNull();

    // Build resume prompt
    const resumePrompt = buildResumePrompt(recovered!);

    // The resume prompt should:
    // 1. Tell Claude to skip Navigation (already complete)
    expect(resumePrompt).toContain('Completed Areas (skip these)');
    expect(resumePrompt).toContain('- Navigation');

    // 2. Tell Claude to resume Dashboard from where it left off
    expect(resumePrompt).toContain('In-Progress Areas (resume here)');
    expect(resumePrompt).toContain('- Dashboard');
    expect(resumePrompt).toContain('Checked dashboard card grid spacing, about to review form validation');

    // 3. Tell Claude to do Settings next
    expect(resumePrompt).toContain('Not Started Areas (do these next)');
    expect(resumePrompt).toContain('- Settings');

    // 4. Tell Claude to read existing files and not overwrite
    expect(resumePrompt).toContain('Read your existing discovery doc and report');
    expect(resumePrompt).toContain('do not overwrite previous work');
  });

  it('handles all areas complete', () => {
    const cp: Checkpoint = {
      instanceId: 1,
      assignedAreas: ['Nav', 'Dashboard'],
      currentRound: 1,
      areas: [
        { name: 'Nav', status: 'complete' },
        { name: 'Dashboard', status: 'complete' },
      ],
      lastAction: 'All areas reviewed',
      timestamp: '2026-04-02T12:00:00.000Z',
    };
    const prompt = buildResumePrompt(cp);
    expect(prompt).toContain('Completed Areas (skip these)');
    expect(prompt).not.toContain('In-Progress Areas');
    expect(prompt).not.toContain('Not Started Areas');
  });

  it('handles all areas not started', () => {
    const cp = createInitialCheckpoint(1, ['Nav', 'Dashboard'], 1);
    const prompt = buildResumePrompt(cp);
    expect(prompt).not.toContain('Completed Areas');
    expect(prompt).not.toContain('In-Progress Areas');
    expect(prompt).toContain('Not Started Areas (do these next)');
  });
});
