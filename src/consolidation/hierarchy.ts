import { runClaude } from '../claude-cli.js';
import { debug } from '../logger.js';
import { withRateLimitRetry, sleep } from '../rate-limit.js';
import { Finding } from './types.js';

// ---- Hierarchical Grouping (TASK-020) ----

/**
 * A finding with optional dependent (child) findings nested under it.
 * Children are themselves HierarchicalFinding objects, supporting arbitrary nesting depth.
 */
export interface HierarchicalFinding {
  finding: Finding;
  children: HierarchicalFinding[];
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
- A finding CAN be both a parent and a child, allowing multi-level nesting (e.g., a page-level issue can have a section-level child which itself has a component-level grandchild).
- Top-level findings (no parent) must be INDEPENDENT of each other — they can be worked on in parallel.
- Only create parent-child relationships when there is a clear dependency. When in doubt, keep findings at the top level.

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
 * Build a hierarchical structure of arbitrary depth from a flat list of
 * findings and a child-to-parent mapping.
 *
 * Supports multi-level nesting: a finding can be both a parent and a child.
 * Detects cycles in the ancestor chain and breaks them by promoting the
 * cycle-causing finding to the top level.
 *
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

  // Filter to only valid relationships (both IDs exist in findings)
  const validChildToParent = new Map<string, string>();
  for (const [childId, parentId] of childToParent) {
    if (findingMap.has(childId) && findingMap.has(parentId)) {
      validChildToParent.set(childId, parentId);
    }
  }

  // Cycle detection: for each node, walk up the ancestor chain.
  // If we revisit a node, there's a cycle — break it by removing the edge.
  for (const childId of [...validChildToParent.keys()]) {
    const visited = new Set<string>();
    let current = childId;

    while (true) {
      if (visited.has(current)) {
        // Cycle detected — break it by removing this node's parent edge
        validChildToParent.delete(current);
        break;
      }
      visited.add(current);
      const parent = validChildToParent.get(current);
      if (!parent) break;
      current = parent;
    }
  }

  // Build parentToChildren map
  const childIds = new Set<string>();
  const parentToChildren = new Map<string, string[]>();

  for (const [childId, parentId] of validChildToParent) {
    childIds.add(childId);
    const children = parentToChildren.get(parentId) || [];
    children.push(childId);
    parentToChildren.set(parentId, children);
  }

  // Build tree recursively
  function buildNode(id: string): HierarchicalFinding {
    const finding = findingMap.get(id)!;
    const childIdList = parentToChildren.get(id) || [];
    return {
      finding,
      children: childIdList.map((cid) => buildNode(cid)),
    };
  }

  // Top-level findings: those not marked as children
  const result: HierarchicalFinding[] = [];
  for (const finding of findings) {
    if (!childIds.has(finding.id)) {
      result.push(buildNode(finding.id));
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
  const result = await withRateLimitRetry(() => runClaude({ prompt }), { sleepFn: sleep });

  if (!result.success) {
    debug('Hierarchy determination failed \u2014 falling back to flat structure');
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

  // Sequential iteration is intentional — each determineHierarchy() call invokes
  // Claude, and parallelizing with Promise.all would create race conditions with
  // multiple Claude instances touching shared state/files. The consolidation phase
  // processes a small number of UI areas and does not benefit from parallelism.
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
 * Render a HierarchicalFinding and its children recursively as markdown lines.
 *
 * @param depth - Nesting depth (0 = top-level under area heading).
 *   Controls heading level (### at depth 0, #### at depth 1, capped at ###### for depth 3+)
 *   and indentation (2 spaces per depth level).
 */
function renderHierarchicalFindingMd(hf: HierarchicalFinding, depth: number): string[] {
  const indent = '  '.repeat(depth);
  const headingLevel = Math.min(3 + depth, 6);
  const heading = '#'.repeat(headingLevel);

  const lines: string[] = [];

  if (depth > 0) {
    lines.push('');
  }
  lines.push(`${indent}${heading} ${hf.finding.id}: ${hf.finding.title}`);

  if (depth > 0) {
    lines.push(formatFindingMetadata(hf.finding).split('\n').map(l => l.trim() === '' ? '' : `${indent}${l}`).join('\n'));
  } else {
    lines.push(formatFindingMetadata(hf.finding));
  }

  for (const child of hf.children) {
    lines.push(...renderHierarchicalFindingMd(child, depth + 1));
  }

  return lines;
}

/**
 * Format the consolidated report as hierarchical markdown.
 *
 * Structure:
 * - ## UI Area heading
 * - ### UXR-xxx: Title for top-level findings
 * -   #### UXR-xxx: Title for children, indented
 * -     ##### UXR-xxx: Title for grandchildren, further indented
 * Heading levels cap at ###### (HTML's deepest heading) for deep nesting.
 */
export function formatConsolidatedReport(groups: UIAreaGroup[]): string {
  const lines: string[] = ['# UX Analysis Report', ''];

  for (const group of groups) {
    lines.push(`## ${group.area}`);
    lines.push('');

    for (const hf of group.findings) {
      lines.push(...renderHierarchicalFindingMd(hf, 0));
      lines.push('');
    }
  }

  return lines.join('\n');
}
