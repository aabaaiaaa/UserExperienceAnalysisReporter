import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from './claude-cli.js';
import { readDiscoveryContent } from './discovery.js';
import { getInstancePaths } from './file-manager.js';
import { readInstanceReport, Finding, InstanceReport, Severity } from './report.js';

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
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  suggestion: 1,
};

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
  const result = await runClaude({ prompt });

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
  const result = [`${finalId}.png`];
  for (let i = 1; i < count; i++) {
    const suffix = String.fromCharCode(96 + i); // 1->'a', 2->'b', etc.
    result.push(`${finalId}-${suffix}.png`);
  }
  return result;
}

/**
 * Reassign clean sequential IDs to all findings and build screenshot
 * copy operations for remapping.
 *
 * Takes the deduplicated findings (with old instance-scoped IDs) and returns:
 * - findings with new UXR-NNN IDs and updated screenshot references
 * - a mapping from old IDs to new IDs
 * - screenshot copy operations to execute
 */
export function reassignIds(findings: Finding[]): ReassignmentResult {
  const idMapping = new Map<string, string>();
  const reassignedFindings: Finding[] = [];
  const screenshotOps: ScreenshotCopyOp[] = [];

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const newId = buildFinalId(i + 1);
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
 */
export function copyScreenshots(screenshotOps: ScreenshotCopyOp[], outputDir: string): void {
  const outputScreenshotsDir = join(outputDir, 'screenshots');

  for (const op of screenshotOps) {
    const paths = getInstancePaths(op.instanceNumber);
    const sourcePath = join(paths.screenshots, op.sourceFilename);
    const destPath = join(outputScreenshotsDir, op.destFilename);

    if (existsSync(sourcePath)) {
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
 * Returns the findings with their final IDs and updated screenshot references.
 */
export function reassignAndRemapScreenshots(
  consolidationResult: ConsolidationResult,
  outputDir: string,
): ReassignmentResult {
  const { findings, idMapping, screenshotOps } = reassignIds(consolidationResult.findings);

  copyScreenshots(screenshotOps, outputDir);

  return { findings, idMapping, screenshotOps };
}

// ---- Hierarchical Grouping (TASK-020) ----

/**
 * A top-level finding with optional dependent (child) findings nested under it.
 */
export interface HierarchicalFinding {
  finding: Finding;
  children: Finding[];
}

/**
 * A group of findings for a single UI area, structured hierarchically.
 */
export interface UIAreaGroup {
  area: string;
  findings: HierarchicalFinding[];
}

/**
 * Group a flat list of findings by their uiArea field.
 * Returns a Map from area name to the findings in that area,
 * preserving the order of first appearance.
 */
export function groupFindingsByArea(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const area = finding.uiArea || 'Other';
    const existing = groups.get(area);
    if (existing) {
      existing.push(finding);
    } else {
      groups.set(area, [finding]);
    }
  }
  return groups;
}

/**
 * Build the prompt that asks Claude to determine parent-child dependency
 * relationships among findings within a single UI area.
 *
 * A child finding is one whose fix depends on or is a sub-part of its parent.
 * Top-level findings must be independent and parallelizable.
 */
export function buildHierarchyPrompt(findings: Finding[]): string {
  const findingsList = findings
    .map(
      (f) =>
        `ID: ${f.id}\nTitle: ${f.title}\nSeverity: ${f.severity}\nDescription: ${f.description}`,
    )
    .join('\n\n');

  return `You are a UX report organizer. Below is a list of UX findings that all belong to the same UI area. Your job is to determine which findings are dependent on (or sub-parts of) other findings.

A finding is a CHILD of another finding if:
- Fixing the child requires or strongly depends on fixing the parent first
- The child is a sub-issue or more specific aspect of the parent issue
- The child would naturally be addressed as part of the parent fix

RULES:
- A finding can have at most ONE parent.
- A finding can have zero or more children.
- Top-level findings (no parent) must be INDEPENDENT of each other — they can be worked on in parallel.
- Only create parent-child relationships when there is a clear dependency. When in doubt, keep findings at the top level.
- A finding cannot be both a parent and a child (only one level of nesting).

OUTPUT FORMAT:
For each child finding, output one line:
CHILD_OF: child_id, parent_id

If ALL findings are independent (no dependencies), output exactly:
NO_DEPENDENCIES

Do NOT add any other text, commentary, or explanation.

FINDINGS:

${findingsList}`;
}

/**
 * Parse Claude's hierarchy response into a map of child ID -> parent ID.
 */
export function parseHierarchyResponse(response: string): Map<string, string> {
  const trimmed = response.trim();
  const childToParent = new Map<string, string>();

  if (trimmed === 'NO_DEPENDENCIES' || trimmed === '') {
    return childToParent;
  }

  const lines = trimmed.split('\n');

  for (const line of lines) {
    const match = line.match(/^CHILD_OF:\s*(.+),\s*(.+)$/);
    if (match) {
      const childId = match[1].trim();
      const parentId = match[2].trim();
      if (childId && parentId && childId !== parentId) {
        childToParent.set(childId, parentId);
      }
    }
  }

  return childToParent;
}

/**
 * Build a hierarchical structure from a flat list of findings and a
 * child-to-parent mapping.
 *
 * Findings that are parents get their children nested under them.
 * Findings with no parent and no children are also top-level.
 * If a child references a parent ID that doesn't exist, the child
 * becomes top-level.
 */
export function buildHierarchy(
  findings: Finding[],
  childToParent: Map<string, string>,
): HierarchicalFinding[] {
  const findingMap = new Map<string, Finding>();
  for (const f of findings) {
    findingMap.set(f.id, f);
  }

  // Collect children grouped by parent ID
  const parentToChildren = new Map<string, Finding[]>();
  const childIds = new Set<string>();

  for (const [childId, parentId] of childToParent) {
    // Only apply the relationship if both IDs exist in the findings list
    if (findingMap.has(childId) && findingMap.has(parentId)) {
      childIds.add(childId);
      const children = parentToChildren.get(parentId) || [];
      children.push(findingMap.get(childId)!);
      parentToChildren.set(parentId, children);
    }
  }

  // Build top-level findings (those not marked as children)
  const result: HierarchicalFinding[] = [];
  for (const finding of findings) {
    if (!childIds.has(finding.id)) {
      result.push({
        finding,
        children: parentToChildren.get(finding.id) || [],
      });
    }
  }

  return result;
}

/**
 * Determine the hierarchy for findings within a single UI area using Claude.
 *
 * Skips the Claude call when there are 0 or 1 findings (no dependencies possible).
 */
export async function determineHierarchy(findings: Finding[]): Promise<HierarchicalFinding[]> {
  if (findings.length <= 1) {
    return findings.map((f) => ({ finding: f, children: [] }));
  }

  const prompt = buildHierarchyPrompt(findings);
  const result = await runClaude({ prompt });

  if (!result.success) {
    // On failure, fall back to flat structure (all top-level)
    return findings.map((f) => ({ finding: f, children: [] }));
  }

  const childToParent = parseHierarchyResponse(result.stdout);
  return buildHierarchy(findings, childToParent);
}

/**
 * Organize findings into UI area groups with hierarchical structure.
 *
 * This is the main entry point for TASK-020.
 *
 * Steps:
 * 1. Group findings by UI area
 * 2. For each area, use Claude to determine parent-child relationships
 * 3. Return structured UIAreaGroup[] suitable for report formatting
 */
export async function organizeHierarchically(findings: Finding[]): Promise<UIAreaGroup[]> {
  const areaMap = groupFindingsByArea(findings);
  const groups: UIAreaGroup[] = [];

  for (const [area, areaFindings] of areaMap) {
    const hierarchical = await determineHierarchy(areaFindings);
    groups.push({ area, findings: hierarchical });
  }

  return groups;
}

/**
 * Format a single finding's metadata as markdown lines.
 */
function formatFindingMetadata(finding: Finding): string {
  return [
    '',
    `- **Severity**: ${finding.severity}`,
    `- **Description**: ${finding.description}`,
    `- **Suggestion**: ${finding.suggestion}`,
    `- **Screenshot**: ${finding.screenshot}`,
  ].join('\n');
}

/**
 * Format the consolidated report as hierarchical markdown.
 *
 * Structure:
 * - ## UI Area heading
 * - ### UXR-xxx: Title for top-level findings
 * -   #### UXR-xxx: Title for child (dependent) findings, indented
 */
export function formatConsolidatedReport(groups: UIAreaGroup[]): string {
  const lines: string[] = ['# UX Analysis Report', ''];

  for (const group of groups) {
    lines.push(`## ${group.area}`);
    lines.push('');

    for (const hf of group.findings) {
      // Top-level finding
      lines.push(`### ${hf.finding.id}: ${hf.finding.title}`);
      lines.push(formatFindingMetadata(hf.finding));

      // Child findings
      for (const child of hf.children) {
        lines.push('');
        lines.push(`  #### ${child.id}: ${child.title}`);
        lines.push(formatFindingMetadata(child).split('\n').map(l => `  ${l}`).join('\n'));
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---- Discovery Document Consolidation (TASK-021) ----

/**
 * Result of the discovery document consolidation.
 */
export interface DiscoveryConsolidationResult {
  /** The consolidated discovery document content (markdown) */
  content: string;
  /** Number of instance discovery docs that were read */
  instanceCount: number;
  /** Whether Claude CLI was called for consolidation */
  usedClaude: boolean;
}

/**
 * Read all per-instance discovery documents and return them as
 * an array of { instanceNumber, content } pairs.
 *
 * Skips instances whose discovery doc is missing or empty.
 */
export function readAllDiscoveryDocs(
  instanceNumbers: number[],
): { instanceNumber: number; content: string }[] {
  const docs: { instanceNumber: number; content: string }[] = [];

  for (const num of instanceNumbers) {
    const content = readDiscoveryContent(num);
    if (content && content.trim()) {
      docs.push({ instanceNumber: num, content });
    }
  }

  return docs;
}

/**
 * Build the prompt that asks Claude to merge multiple per-instance discovery
 * documents into a single consolidated, deduplicated, hierarchical document.
 *
 * The output format is designed to be reusable as a review plan for future runs.
 */
export function buildDiscoveryConsolidationPrompt(
  docs: { instanceNumber: number; content: string }[],
): string {
  const docsList = docs
    .map(
      (d) =>
        `--- INSTANCE ${d.instanceNumber} DISCOVERY ---\n${d.content}\n--- END INSTANCE ${d.instanceNumber} ---`,
    )
    .join('\n\n');

  return `You are a document consolidation assistant. Below are discovery documents from ${docs.length} independent reviewers who each explored parts of the same web application. Each document lists UI areas visited, elements observed, and what was checked.

Your job is to merge these into a SINGLE consolidated discovery document that:

1. DEDUPLICATES overlapping areas — if multiple instances visited the same area, merge their observations into one entry (combine elements observed and criteria checked, don't repeat).
2. STRUCTURES the output as an indented hierarchy of UI areas and their specific features/elements.
3. FORMATS the output so it can be reused as a review plan for a future run of the tool.

OUTPUT FORMAT:
Use this exact markdown format. Each top-level heading is a UI area. Under each area, list the specific features, elements, and sub-areas as a nested bullet list. Include what was checked for each.

\`\`\`
# [UI Area Name]

- [Feature/Element]
  - Checked: [what was evaluated]
- [Feature/Element]
  - Checked: [what was evaluated]
  - Sub-elements:
    - [Sub-element detail]

# [Another UI Area]

- [Feature/Element]
  - Checked: [what was evaluated]
\`\`\`

RULES:
- Merge observations from different instances for the same area into one section.
- Keep all unique elements and checks — do not discard observations, only deduplicate exact repetitions.
- Order areas logically (e.g., navigation first, then main content areas, then settings/footer).
- The document should read as a comprehensive map of what was explored, suitable for planning future review passes.
- Do NOT include instance numbers, timestamps, or navigation paths in the output — those are internal tracking details.
- Output ONLY the consolidated document in the format above. No commentary or explanation.

DISCOVERY DOCUMENTS:

${docsList}`;
}

/**
 * Consolidate multiple per-instance discovery documents into a single document.
 *
 * If only one instance produced a discovery doc, restructures it without a Claude call.
 * For multiple docs, uses Claude to merge, deduplicate, and hierarchically structure them.
 */
export async function consolidateDiscoveryDocs(
  instanceNumbers: number[],
): Promise<DiscoveryConsolidationResult> {
  const docs = readAllDiscoveryDocs(instanceNumbers);

  if (docs.length === 0) {
    return { content: '', instanceCount: 0, usedClaude: false };
  }

  if (docs.length === 1) {
    // Single doc — still use Claude to restructure into the hierarchical plan format
    const prompt = buildDiscoveryConsolidationPrompt(docs);
    const result = await runClaude({ prompt });

    if (!result.success) {
      // Fallback: return the raw content if Claude fails
      return { content: docs[0].content, instanceCount: 1, usedClaude: false };
    }

    return { content: result.stdout.trim(), instanceCount: 1, usedClaude: true };
  }

  // Multiple docs — use Claude to merge and deduplicate
  const prompt = buildDiscoveryConsolidationPrompt(docs);
  const result = await runClaude({ prompt });

  if (!result.success) {
    throw new Error(
      `Claude CLI failed during discovery consolidation (exit code ${result.exitCode}): ${result.stderr}`,
    );
  }

  return { content: result.stdout.trim(), instanceCount: docs.length, usedClaude: true };
}

/**
 * Write the consolidated discovery document to the output directory.
 */
export function writeConsolidatedDiscovery(outputDir: string, content: string): void {
  const outputPath = join(outputDir, 'discovery.md');
  writeFileSync(outputPath, content + '\n', 'utf-8');
}
