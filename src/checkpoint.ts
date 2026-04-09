import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { getInstancePaths } from './file-manager.js';
import { debug } from './logger.js';

export type AreaStatus = 'complete' | 'in-progress' | 'not-started';

export interface AreaState {
  name: string;
  status: AreaStatus;
}

export interface Checkpoint {
  instanceId: number;
  assignedAreas: string[];
  currentRound: number;
  areas: AreaState[];
  lastAction: string;
  timestamp: string;
}

/**
 * Write a checkpoint to the instance's checkpoint.json file.
 */
export function writeCheckpoint(instanceNumber: number, checkpoint: Checkpoint): void {
  const paths = getInstancePaths(instanceNumber);
  debug(`Writing checkpoint for instance ${instanceNumber}: round=${checkpoint.currentRound} action="${checkpoint.lastAction}"`);
  writeFileSync(paths.checkpoint, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

/**
 * Read a checkpoint from the instance's checkpoint.json file.
 * Returns null if the file doesn't exist or is corrupted.
 */
export function readCheckpoint(instanceNumber: number): Checkpoint | null {
  const paths = getInstancePaths(instanceNumber);

  if (!existsSync(paths.checkpoint)) {
    debug(`No checkpoint found for instance ${instanceNumber}`);
    return null;
  }

  try {
    debug(`Reading checkpoint for instance ${instanceNumber}`);
    const raw = readFileSync(paths.checkpoint, 'utf-8');
    const parsed = JSON.parse(raw);

    // Require areas array — this is the critical field for progress tracking
    if (!Array.isArray(parsed.areas)) {
      return null;
    }

    // Coerce fields that Claude might write in slightly wrong types
    return {
      instanceId: Number(parsed.instanceId) || instanceNumber,
      assignedAreas: Array.isArray(parsed.assignedAreas) ? parsed.assignedAreas : [],
      currentRound: Number(parsed.currentRound) || 1,
      areas: parsed.areas,
      lastAction: String(parsed.lastAction ?? ''),
      timestamp: String(parsed.timestamp ?? new Date().toISOString()),
    } as Checkpoint;
  } catch (err) {
    debug('Failed to read checkpoint for instance ' + instanceNumber, err);
    return null;
  }
}

/**
 * Create an initial checkpoint for an instance starting fresh.
 */
export function createInitialCheckpoint(instanceId: number, assignedAreas: string[], round: number): Checkpoint {
  return {
    instanceId,
    assignedAreas,
    currentRound: round,
    areas: assignedAreas.map((name) => ({ name, status: 'not-started' as AreaStatus })),
    lastAction: 'Starting review',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a resume prompt from a checkpoint, instructing Claude to continue
 * from where it left off after a failure.
 */
export function buildResumePrompt(checkpoint: Checkpoint): string {
  const completeAreas = checkpoint.areas.filter((a) => a.status === 'complete');
  const inProgressAreas = checkpoint.areas.filter((a) => a.status === 'in-progress');
  const notStartedAreas = checkpoint.areas.filter((a) => a.status === 'not-started');

  const lines: string[] = [
    '## Resume Instructions',
    '',
    'You are resuming a previously interrupted UX review. Here is your progress so far:',
    '',
    `**Round**: ${checkpoint.currentRound}`,
    `**Last completed action**: ${checkpoint.lastAction}`,
    `**Last checkpoint**: ${checkpoint.timestamp}`,
    '',
  ];

  if (completeAreas.length > 0) {
    lines.push('### Completed Areas (skip these)');
    for (const area of completeAreas) {
      lines.push(`- ${area.name}`);
    }
    lines.push('');
  }

  if (inProgressAreas.length > 0) {
    lines.push('### In-Progress Areas (resume here)');
    lines.push(`Continue from where you left off. The last action was: "${checkpoint.lastAction}"`);
    for (const area of inProgressAreas) {
      lines.push(`- ${area.name}`);
    }
    lines.push('');
  }

  if (notStartedAreas.length > 0) {
    lines.push('### Not Started Areas (do these next)');
    for (const area of notStartedAreas) {
      lines.push(`- ${area.name}`);
    }
    lines.push('');
  }

  lines.push('Read your existing discovery doc and report to understand what has already been documented.');
  lines.push('Continue writing to the same files — append new findings, do not overwrite previous work.');

  return lines.join('\n');
}
