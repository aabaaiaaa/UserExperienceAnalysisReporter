import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getTempDir } from './file-manager.js';
import { debug } from './logger.js';
import type { ConsolidationResult, UIAreaGroup } from './consolidation/index.js';
import type { Finding } from './report.js';

/**
 * The steps in the consolidation pipeline, in execution order.
 */
export type ConsolidationStep =
  | 'dedup'
  | 'reassign'
  | 'hierarchy'
  | 'format-report'
  | 'discovery-merge'
  | 'write-discovery';

/**
 * All consolidation steps in order.
 */
export const CONSOLIDATION_STEPS: ConsolidationStep[] = [
  'dedup',
  'reassign',
  'hierarchy',
  'format-report',
  'discovery-merge',
  'write-discovery',
];

/**
 * Checkpoint tracking consolidation phase progress and intermediate outputs.
 *
 * Each step records whether it has completed and stores its output so that
 * a resumed run can skip completed steps and pick up from intermediate results.
 */
export interface ConsolidationCheckpoint {
  /** Which steps have completed */
  completedSteps: ConsolidationStep[];
  /** Deduplicated findings (output of dedup step) */
  dedupOutput: ConsolidationResult | null;
  /** Reassigned findings (output of reassign step) */
  reassignOutput: Finding[] | null;
  /** Hierarchical grouping (output of hierarchy step) */
  hierarchyOutput: UIAreaGroup[] | null;
  /** Formatted report markdown (output of format-report step) */
  formatReportOutput: string | null;
  /** Merged discovery document content (output of discovery-merge step) */
  discoveryMergeOutput: string | null;
  /** ISO timestamp of last update */
  timestamp: string;
}

const CHECKPOINT_FILENAME = 'consolidation-checkpoint.json';

/**
 * Get the path to the consolidation checkpoint file.
 */
export function getConsolidationCheckpointPath(): string {
  return join(getTempDir(), CHECKPOINT_FILENAME);
}

/**
 * Write a consolidation checkpoint to disk.
 */
export function writeConsolidationCheckpoint(checkpoint: ConsolidationCheckpoint): void {
  const path = getConsolidationCheckpointPath();
  debug(`Writing consolidation checkpoint: steps=[${checkpoint.completedSteps.join(', ')}]`);
  writeFileSync(path, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

/**
 * Read the consolidation checkpoint from disk.
 * Returns null if the file doesn't exist or is corrupted.
 */
export function readConsolidationCheckpoint(): ConsolidationCheckpoint | null {
  const path = getConsolidationCheckpointPath();

  if (!existsSync(path)) {
    debug('No consolidation checkpoint found');
    return null;
  }

  try {
    debug('Reading consolidation checkpoint');
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);

    // Validate required fields and types
    if (
      !Array.isArray(parsed.completedSteps) ||
      typeof parsed.timestamp !== 'string'
    ) {
      return null;
    }

    // Validate that completedSteps contains only known step names
    for (const step of parsed.completedSteps) {
      if (!CONSOLIDATION_STEPS.includes(step)) {
        return null;
      }
    }

    // Validate nullable structured fields (object/array or null)
    const nullableStructuredFields = [
      'dedupOutput',
      'reassignOutput',
      'hierarchyOutput',
    ] as const;

    for (const field of nullableStructuredFields) {
      if (parsed[field] !== null && typeof parsed[field] !== 'object') {
        return null;
      }
    }

    // Validate nullable string fields
    const nullableStringFields = [
      'formatReportOutput',
      'discoveryMergeOutput',
    ] as const;

    for (const field of nullableStringFields) {
      if (parsed[field] !== null && typeof parsed[field] !== 'string') {
        return null;
      }
    }

    return parsed as ConsolidationCheckpoint;
  } catch (err) {
    debug(`readConsolidationCheckpoint failed: ${err}`);
    return null;
  }
}

/**
 * Create an empty consolidation checkpoint with no completed steps.
 */
export function createEmptyConsolidationCheckpoint(): ConsolidationCheckpoint {
  return {
    completedSteps: [],
    dedupOutput: null,
    reassignOutput: null,
    hierarchyOutput: null,
    formatReportOutput: null,
    discoveryMergeOutput: null,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check whether a specific consolidation step has been completed.
 */
export function isStepCompleted(checkpoint: ConsolidationCheckpoint, step: ConsolidationStep): boolean {
  return checkpoint.completedSteps.includes(step);
}
