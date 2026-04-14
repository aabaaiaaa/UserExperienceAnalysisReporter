import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from '../claude-cli.js';
import { withRateLimitRetry, sleep } from '../rate-limit.js';
import { getInstancePaths } from '../file-manager.js';
import { Severity } from '../report.js';
import {
  Finding,
  DuplicateGroup,
  DeduplicationResult,
  ConsolidationResult,
} from './types.js';
import { buildDeduplicationPrompt, parseDeduplicationResponse } from './deduplication.js';

// ---- ID Reassignment and Screenshot Remapping (TASK-019) ----

/**
 * A single screenshot copy operation mapping a source file in an instance
 * directory to a destination file in the output directory.
 */
export interface ScreenshotCopyOp {
  instanceNumber: number;
  sourceFilename: string;
  destFilename: string;
}

/**
 * Result of ID reassignment including the remapped findings and
 * the screenshot copy operations needed.
 */
export interface ReassignmentResult {
  findings: Finding[];
  idMapping: Map<string, string>;
  screenshotOps: ScreenshotCopyOp[];
}

/**
 * Build a clean sequential final ID.
 * E.g., buildFinalId(1) => "UXR-001", buildFinalId(12) => "UXR-012"
 */
export function buildFinalId(sequenceNumber: number): string {
  return `UXR-${String(sequenceNumber).padStart(3, '0')}`;
}

/**
 * Parse a comma-separated screenshot reference field into individual filenames.
 * E.g., "I1-UXR-001.png, I2-UXR-003.png" => ["I1-UXR-001.png", "I2-UXR-003.png"]
 */
export function parseScreenshotRefs(screenshotField: string): string[] {
  if (!screenshotField || !screenshotField.trim()) {
    return [];
  }
  return screenshotField
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extract the instance number from an instance-scoped screenshot filename.
 * E.g., "I1-UXR-001.png" => 1, "I3-UXR-002-a.png" => 3
 * Returns null if the filename doesn't match the expected pattern.
 */
export function extractInstanceFromScreenshot(filename: string): number | null {
  const match = filename.match(/^I(\d+)-UXR-/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Build new screenshot filenames for a finding given its final ID.
 * - 1 screenshot:  ["UXR-001.png"]
 * - 2 screenshots: ["UXR-001.png", "UXR-001-a.png"]
 * - 3 screenshots: ["UXR-001.png", "UXR-001-a.png", "UXR-001-b.png"]
 */
export function buildNewScreenshotFilenames(finalId: string, count: number): string[] {
  if (count <= 0) return [];
  if (count > 26) {
    throw new Error(`Maximum 26 screenshots per finding (got ${count})`);
  }
  const result = [`${finalId}.png`];
  for (let i = 1; i < count; i++) {
    const suffix = String.fromCharCode(96 + i); // 1->'a', 2->'b', etc.
    result.push(`${finalId}-${suffix}.png`);
  }
  return result;
}

/**
 * Parse a consolidated report's markdown content into an array of Finding objects.
 *
 * Handles the hierarchical format produced by `formatConsolidatedReport`:
 * - `## Area Name` headings define the current UI area
 * - `### UXR-NNN: Title` defines a top-level finding
 * - `#### UXR-NNN: Title` (possibly indented) defines a child finding
 *
 * Returns an empty array for empty or unparseable content.
 */
export function parseConsolidatedReport(content: string): Finding[] {
  if (!content || !content.trim()) {
    return [];
  }

  const findings: Finding[] = [];
  let currentArea = '';

  // Split into lines for processing
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmedLine = line.trim();

    // Track UI area headings: ## Area Name
    const areaMatch = trimmedLine.match(/^## (.+)$/);
    if (areaMatch && !trimmedLine.match(/^## UXR-\d+:/)) {
      currentArea = areaMatch[1].trim();
      continue;
    }

    // Match finding headings: ### through ###### UXR-NNN: Title (multi-level hierarchy)
    const findingMatch = trimmedLine.match(/^#{3,6}\s+(UXR-\d{3,}):\s*(.+)$/);
    if (findingMatch) {
      const id = findingMatch[1];
      const title = findingMatch[2].trim();

      // Extract metadata from subsequent lines
      let severity: Severity = 'suggestion';
      let description = '';
      let suggestion = '';
      let screenshot = '';

      for (let j = i + 1; j < lines.length; j++) {
        const metaLine = lines[j].trim();

        // Stop at next heading or empty section
        if (metaLine.match(/^#{2,6}\s+/) && !metaLine.startsWith('- **')) {
          break;
        }

        const severityMatch = metaLine.match(/\*\*Severity\*\*:\s*(.+)/);
        if (severityMatch) {
          const raw = severityMatch[1].trim() as Severity;
          if (['critical', 'major', 'minor', 'suggestion'].includes(raw)) {
            severity = raw;
          }
        }
        const descMatch = metaLine.match(/\*\*Description\*\*:\s*(.+)/);
        if (descMatch) description = descMatch[1].trim();
        const sugMatch = metaLine.match(/\*\*Suggestion\*\*:\s*(.+)/);
        if (sugMatch) suggestion = sugMatch[1].trim();
        const ssMatch = metaLine.match(/\*\*Screenshot\*\*:\s*(.+)/);
        if (ssMatch) screenshot = ssMatch[1].trim();
      }

      findings.push({
        id,
        title,
        uiArea: currentArea,
        severity,
        description,
        suggestion,
        screenshot,
      });
    }
  }

  return findings;
}

/**
 * Detect cross-run duplicate findings between existing findings (from a
 * previous report) and newly consolidated findings. Uses Claude to compare
 * the two sets.
 *
 * Only calls Claude when both sets are non-empty. The returned duplicate
 * groups may contain IDs from both sets.
 */
export async function detectCrossRunDuplicates(
  existingFindings: Finding[],
  newFindings: Finding[],
): Promise<DeduplicationResult> {
  if (existingFindings.length === 0 || newFindings.length === 0) {
    return { duplicateGroups: [], usedClaude: false };
  }

  const allFindings = [...existingFindings, ...newFindings];
  const prompt = buildDeduplicationPrompt(allFindings);
  const result = await withRateLimitRetry(() => runClaude({ prompt }), { sleepFn: sleep });

  if (!result.success) {
    throw new Error(
      `Claude CLI failed during cross-run deduplication (exit code ${result.exitCode}): ${result.stderr}`,
    );
  }

  const groups = parseDeduplicationResponse(result.stdout);
  return { duplicateGroups: groups, usedClaude: true };
}

/**
 * Remove new findings that are duplicates of existing findings.
 *
 * Given duplicate groups from cross-run dedup, identifies new findings that
 * share a group with at least one existing finding, and removes them.
 * Existing findings are always kept. New findings that only duplicate other
 * new findings are also kept (that dedup was already handled within-run).
 */
export function filterCrossRunDuplicates(
  existingFindings: Finding[],
  newFindings: Finding[],
  duplicateGroups: DuplicateGroup[],
): Finding[] {
  const existingIds = new Set(existingFindings.map((f) => f.id));
  const newIdsToRemove = new Set<string>();

  for (const group of duplicateGroups) {
    const hasExisting = group.findingIds.some((id) => existingIds.has(id));
    if (hasExisting) {
      // Remove all new findings in this group (keep existing ones)
      for (const id of group.findingIds) {
        if (!existingIds.has(id)) {
          newIdsToRemove.add(id);
        }
      }
    }
  }

  return newFindings.filter((f) => !newIdsToRemove.has(f.id));
}

/**
 * Parse an existing consolidated report to extract finding IDs and determine
 * the next available UXR-NNN number.
 *
 * Returns the highest UXR number found, or 0 if no findings are found.
 * Returns 0 for missing files or corrupt/unparseable content (caller should warn).
 */
export function parseExistingReportIds(reportPath: string): { maxId: number; success: boolean } {
  if (!existsSync(reportPath)) {
    return { maxId: 0, success: true };
  }

  try {
    const content = readFileSync(reportPath, 'utf-8');
    const idPattern = /\bUXR-(\d{3,})\b/g;
    let maxId = 0;
    let match: RegExpExecArray | null;

    while ((match = idPattern.exec(content)) !== null) {
      const num = parseInt(match[1], 10);
      if (num > maxId) {
        maxId = num;
      }
    }

    return { maxId, success: true };
  } catch {
    return { maxId: 0, success: false };
  }
}

/**
 * Reassign clean sequential IDs to all findings and build screenshot
 * copy operations for remapping.
 *
 * Takes the deduplicated findings (with old instance-scoped IDs) and returns:
 * - findings with new UXR-NNN IDs and updated screenshot references
 * - a mapping from old IDs to new IDs
 * - screenshot copy operations to execute
 *
 * The optional `startId` parameter specifies the first sequence number to use
 * (default 1). In append mode, this should be set to one past the highest
 * existing ID so that new findings don't collide with previous ones.
 */
export function reassignIds(findings: Finding[], startId: number = 1): ReassignmentResult {
  const idMapping = new Map<string, string>();
  const reassignedFindings: Finding[] = [];
  const screenshotOps: ScreenshotCopyOp[] = [];

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const newId = buildFinalId(startId + i);
    idMapping.set(finding.id, newId);

    const oldRefs = parseScreenshotRefs(finding.screenshot);
    const newFilenames = buildNewScreenshotFilenames(newId, oldRefs.length);

    for (let j = 0; j < oldRefs.length; j++) {
      const instanceNum = extractInstanceFromScreenshot(oldRefs[j]);
      if (instanceNum !== null) {
        screenshotOps.push({
          instanceNumber: instanceNum,
          sourceFilename: oldRefs[j],
          destFilename: newFilenames[j],
        });
      }
    }

    reassignedFindings.push({
      ...finding,
      id: newId,
      screenshot: newFilenames.join(', '),
    });
  }

  return { findings: reassignedFindings, idMapping, screenshotOps };
}

/**
 * Copy and rename screenshots from instance working directories to the
 * output directory. Silently skips files that don't exist (e.g., if an
 * instance failed before capturing a screenshot).
 *
 * When `skipExisting` is true, does not overwrite screenshots that already
 * exist in the output directory. This is used in append mode to preserve
 * screenshots from previous runs.
 */
export function copyScreenshots(screenshotOps: ScreenshotCopyOp[], outputDir: string, skipExisting: boolean = false): void {
  const outputScreenshotsDir = join(outputDir, 'screenshots');

  for (const op of screenshotOps) {
    const paths = getInstancePaths(op.instanceNumber);
    const sourcePath = join(paths.screenshots, op.sourceFilename);
    const destPath = join(outputScreenshotsDir, op.destFilename);

    if (existsSync(sourcePath)) {
      if (skipExisting && existsSync(destPath)) {
        continue;
      }
      copyFileSync(sourcePath, destPath);
    }
  }
}

/**
 * Full ID reassignment and screenshot remapping pipeline.
 *
 * Takes the deduplicated consolidation result and an output directory, then:
 * 1. Assigns clean sequential UXR-NNN IDs to all findings
 * 2. Remaps screenshot references in each finding
 * 3. Copies and renames screenshot files to the output directory
 *
 * The optional `startId` parameter specifies the first sequence number to use
 * (default 1). In append mode, pass the next available ID after existing findings.
 *
 * When `skipExistingScreenshots` is true, existing screenshot files in the
 * output directory are preserved (not overwritten).
 *
 * Returns the findings with their final IDs and updated screenshot references.
 */
export function reassignAndRemapScreenshots(
  consolidationResult: ConsolidationResult,
  outputDir: string,
  startId: number = 1,
  skipExistingScreenshots: boolean = false,
): ReassignmentResult {
  const { findings, idMapping, screenshotOps } = reassignIds(consolidationResult.findings, startId);

  copyScreenshots(screenshotOps, outputDir, skipExistingScreenshots);

  return { findings, idMapping, screenshotOps };
}
