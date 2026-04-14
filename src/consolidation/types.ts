import { Finding, Severity } from '../report.js';
export { Finding };

/**
 * A group of finding IDs that Claude identified as duplicates of each other.
 */
export interface DuplicateGroup {
  /** The finding IDs in this duplicate group */
  findingIds: string[];
}

/**
 * Result of the deduplication step.
 */
export interface DeduplicationResult {
  /** Groups of duplicate findings detected */
  duplicateGroups: DuplicateGroup[];
  /** Whether Claude CLI was called for deduplication */
  usedClaude: boolean;
}

/**
 * Result of the full consolidation process.
 */
export interface ConsolidationResult {
  /** The deduplicated, merged findings */
  findings: Finding[];
  /** Duplicate groups that were merged */
  duplicateGroups: DuplicateGroup[];
  /** Whether Claude was used for deduplication */
  usedClaude: boolean;
}

/**
 * Severity ranking for comparison (higher = more severe).
 */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  suggestion: 1,
};
