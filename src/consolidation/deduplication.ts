import { runClaude } from '../claude-cli.js';
import { withRateLimitRetry, sleep } from '../rate-limit.js';
import { readInstanceReport, InstanceReport } from '../report.js';
import {
  Finding,
  DuplicateGroup,
  DeduplicationResult,
  ConsolidationResult,
  SEVERITY_RANK,
} from './types.js';

/**
 * Build the prompt that asks Claude to identify duplicate findings across instances.
 *
 * The prompt is conservative — it asks Claude to only flag true duplicates
 * (same issue in the same UI area) and to err on the side of keeping
 * findings separate rather than over-merging.
 */
export function buildDeduplicationPrompt(findings: Finding[]): string {
  const findingsList = findings
    .map(
      (f) =>
        `ID: ${f.id}\nUI Area: ${f.uiArea}\nTitle: ${f.title}\nSeverity: ${f.severity}\nDescription: ${f.description}`,
    )
    .join('\n\n');

  return `You are a deduplication assistant. Below is a list of UX findings from multiple independent reviewers who analyzed the same web application. Some findings may describe the exact same issue discovered independently by different reviewers.

Your job is to identify groups of findings that are TRUE DUPLICATES — meaning they describe the same specific issue in the same UI area.

RULES:
- Only group findings that describe the EXACT SAME issue. Same UI area AND same specific problem.
- Two findings about the same UI area but different problems are NOT duplicates. Keep them separate.
- Two findings about similar problems in DIFFERENT UI areas are NOT duplicates. Keep them separate.
- When in doubt, keep findings SEPARATE. It is better to have a near-duplicate than to incorrectly merge distinct issues.
- A finding can only appear in one duplicate group.

OUTPUT FORMAT:
If you find duplicates, output one line per group using this exact format:
DUPLICATE_GROUP: ID1, ID2
or for 3+ duplicates:
DUPLICATE_GROUP: ID1, ID2, ID3

If there are NO duplicates at all, output exactly:
NO_DUPLICATES

Do NOT add any other text, commentary, or explanation.

FINDINGS:

${findingsList}`;
}

/**
 * Parse Claude's deduplication response into structured duplicate groups.
 */
export function parseDeduplicationResponse(response: string): DuplicateGroup[] {
  const trimmed = response.trim();

  if (trimmed === 'NO_DUPLICATES' || trimmed === '') {
    return [];
  }

  const groups: DuplicateGroup[] = [];
  const lines = trimmed.split('\n');

  for (const line of lines) {
    const match = line.match(/^DUPLICATE_GROUP:\s*(.+)$/);
    if (match) {
      const ids = match[1]
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

      if (ids.length >= 2) {
        groups.push({ findingIds: ids });
      }
    }
  }

  return groups;
}

/**
 * Merge a group of duplicate findings into a single finding.
 *
 * Strategy:
 * - Use the finding with the longest description as the base (most detailed).
 * - Use the highest severity among the group.
 * - Combine screenshot references from all findings.
 * - Keep the first finding's ID as the merged ID (will be reassigned later).
 */
export function mergeDuplicateGroup(findings: Finding[]): Finding {
  if (findings.length === 0) {
    throw new Error('Cannot merge an empty group of findings');
  }

  if (findings.length === 1) {
    return { ...findings[0] };
  }

  // Sort by description length descending — use the most detailed as the base
  const sorted = [...findings].sort((a, b) => b.description.length - a.description.length);
  const base = sorted[0];

  // Use the highest severity
  let highestSeverity = base.severity;
  for (const f of findings) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[highestSeverity]) {
      highestSeverity = f.severity;
    }
  }

  // Combine screenshot references
  const screenshots = findings.map((f) => f.screenshot).filter((s) => s.length > 0);
  const combinedScreenshot = screenshots.join(', ');

  return {
    id: base.id,
    title: base.title,
    uiArea: base.uiArea,
    severity: highestSeverity,
    description: base.description,
    suggestion: base.suggestion,
    screenshot: combinedScreenshot,
  };
}

/**
 * Apply duplicate groups to a list of findings, merging duplicates.
 *
 * Returns a new list where each duplicate group is replaced by a single merged finding,
 * and non-duplicate findings are preserved as-is.
 */
export function applyDeduplication(
  findings: Finding[],
  duplicateGroups: DuplicateGroup[],
): Finding[] {
  // Build a set of all finding IDs that are part of a duplicate group
  const mergedIds = new Set<string>();
  const mergedFindings: Finding[] = [];

  for (const group of duplicateGroups) {
    const groupFindings = group.findingIds
      .map((id) => findings.find((f) => f.id === id))
      .filter((f): f is Finding => f !== undefined);

    if (groupFindings.length >= 2) {
      const merged = mergeDuplicateGroup(groupFindings);
      mergedFindings.push(merged);
      for (const f of groupFindings) {
        mergedIds.add(f.id);
      }
    }
  }

  // Build the result: non-duplicated findings in original order, then merged findings
  // inserted at the position of the first occurrence in each group
  const result: Finding[] = [];
  const insertedGroups = new Set<number>();

  for (const finding of findings) {
    if (mergedIds.has(finding.id)) {
      // Find which group this finding belongs to
      const groupIndex = duplicateGroups.findIndex((g) => g.findingIds.includes(finding.id));
      if (groupIndex >= 0 && !insertedGroups.has(groupIndex)) {
        // Insert the merged finding at the position of the first occurrence
        const merged = mergedFindings.find((mf) => {
          const group = duplicateGroups[groupIndex];
          return group.findingIds.includes(mf.id);
        });
        if (merged) {
          result.push(merged);
        }
        insertedGroups.add(groupIndex);
      }
      // Skip individual duplicates (they're replaced by the merged version)
    } else {
      result.push({ ...finding });
    }
  }

  return result;
}

/**
 * Collect all findings from multiple instance reports into a single flat list.
 */
export function collectFindings(reports: InstanceReport[]): Finding[] {
  const all: Finding[] = [];
  for (const report of reports) {
    for (const finding of report.findings) {
      all.push(finding);
    }
  }
  return all;
}

/**
 * Detect duplicate findings using Claude CLI.
 *
 * If there are findings from only one instance, skips the Claude call
 * (no cross-instance duplicates possible).
 */
export async function detectDuplicates(findings: Finding[]): Promise<DeduplicationResult> {
  // Determine how many distinct instances contributed findings
  const instancePrefixes = new Set(findings.map((f) => f.id.replace(/-UXR-\d+$/, '')));

  if (instancePrefixes.size <= 1) {
    // All findings from one instance — no cross-instance duplicates possible
    return { duplicateGroups: [], usedClaude: false };
  }

  if (findings.length <= 1) {
    return { duplicateGroups: [], usedClaude: false };
  }

  const prompt = buildDeduplicationPrompt(findings);
  const result = await withRateLimitRetry(() => runClaude({ prompt }), { sleepFn: sleep });

  if (!result.success) {
    throw new Error(
      `Claude CLI failed during deduplication (exit code ${result.exitCode}): ${result.stderr}`,
    );
  }

  const groups = parseDeduplicationResponse(result.stdout);

  return { duplicateGroups: groups, usedClaude: true };
}

/**
 * Read all instance reports and consolidate them into a single deduplicated set of findings.
 *
 * This is the main entry point for TASK-018.
 *
 * Steps:
 * 1. Read all per-instance reports
 * 2. Collect all findings into a flat list
 * 3. Use Claude to detect cross-instance duplicates
 * 4. Merge duplicate groups into single findings
 * 5. Return the consolidated result
 */
export async function consolidateReports(
  instanceNumbers: number[],
): Promise<ConsolidationResult> {
  // Read all instance reports
  const reports: InstanceReport[] = [];
  for (const num of instanceNumbers) {
    const report = readInstanceReport(num);
    if (report && report.findings.length > 0) {
      reports.push(report);
    }
  }

  if (reports.length === 0) {
    return { findings: [], duplicateGroups: [], usedClaude: false };
  }

  // Collect all findings
  const allFindings = collectFindings(reports);

  // Detect duplicates
  const dedup = await detectDuplicates(allFindings);

  // Apply deduplication
  const consolidated = applyDeduplication(allFindings, dedup.duplicateGroups);

  return {
    findings: consolidated,
    duplicateGroups: dedup.duplicateGroups,
    usedClaude: dedup.usedClaude,
  };
}
