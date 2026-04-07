import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { getInstancePaths } from './file-manager.js';

/**
 * Severity levels for UX findings.
 */
export type Severity = 'critical' | 'major' | 'minor' | 'suggestion';

/**
 * A single UX finding discovered during analysis.
 */
export interface Finding {
  /** Instance-scoped ID (e.g., "I1-UXR-001") */
  id: string;
  /** Concise description of the issue */
  title: string;
  /** Which part of the app this relates to */
  uiArea: string;
  /** Impact assessment */
  severity: Severity;
  /** Detailed observation of the UX issue */
  description: string;
  /** Recommended change or improvement */
  suggestion: string;
  /** Screenshot filename reference (e.g., "I1-UXR-001.png") */
  screenshot: string;
}

/**
 * A per-instance report containing all findings from that instance.
 */
export interface InstanceReport {
  instanceNumber: number;
  findings: Finding[];
}

/**
 * Valid severity values for validation.
 */
const VALID_SEVERITIES: Severity[] = ['critical', 'major', 'minor', 'suggestion'];

/**
 * Count finding headings in a report string.
 * Matches lines like "## I1-UXR-001: ..."
 */
export function countFindings(reportContent: string): number {
  const matches = reportContent.match(/^## I\d+-UXR-\d+:/gm);
  return matches ? matches.length : 0;
}

/**
 * Build an instance-scoped finding ID.
 * E.g., buildFindingId(1, 1) => "I1-UXR-001"
 */
export function buildFindingId(instanceNumber: number, findingNumber: number): string {
  const padded = String(findingNumber).padStart(3, '0');
  return `I${instanceNumber}-UXR-${padded}`;
}

/**
 * Build the expected screenshot filename for a finding.
 * E.g., buildScreenshotRef("I1-UXR-001") => "I1-UXR-001.png"
 */
export function buildScreenshotRef(findingId: string): string {
  return `${findingId}.png`;
}

/**
 * Format a single finding as markdown text.
 */
export function formatFinding(finding: Finding): string {
  const lines: string[] = [
    `## ${finding.id}: ${finding.title}`,
    '',
    `- **UI Area**: ${finding.uiArea}`,
    `- **Severity**: ${finding.severity}`,
    `- **Description**: ${finding.description}`,
    `- **Suggestion**: ${finding.suggestion}`,
    `- **Screenshot**: ${finding.screenshot}`,
  ];

  return lines.join('\n');
}

/**
 * Format a complete instance report as markdown text.
 */
export function formatInstanceReport(report: InstanceReport): string {
  const lines: string[] = [`# UX Report - Instance ${report.instanceNumber}`, ''];

  for (let i = 0; i < report.findings.length; i++) {
    lines.push(formatFinding(report.findings[i]));
    if (i < report.findings.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Parse a markdown instance report back into structured data.
 * Returns null if the content cannot be parsed.
 */
export function parseInstanceReport(content: string, instanceNumber: number): InstanceReport | null {
  if (!content.trim()) {
    return null;
  }

  const report: InstanceReport = { instanceNumber, findings: [] };

  // Match finding headers: ## I1-UXR-001: Title
  const findingRegex = /^## (I\d+-UXR-\d+):\s*(.+)$/gm;
  const findingMatches: { id: string; title: string; startIndex: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = findingRegex.exec(content)) !== null) {
    findingMatches.push({ id: match[1], title: match[2].trim(), startIndex: match.index });
  }

  if (findingMatches.length === 0) {
    return null;
  }

  for (let i = 0; i < findingMatches.length; i++) {
    const start = findingMatches[i].startIndex;
    const end = i < findingMatches.length - 1 ? findingMatches[i + 1].startIndex : content.length;
    const findingContent = content.slice(start, end);

    const finding = parseFindingContent(findingMatches[i].id, findingMatches[i].title, findingContent);
    report.findings.push(finding);
  }

  return report;
}

/**
 * Parse a single finding's content from markdown.
 */
function parseFindingContent(id: string, title: string, content: string): Finding {
  const uiAreaMatch = content.match(/\*\*UI Area\*\*:\s*(.+)/);
  const severityMatch = content.match(/\*\*Severity\*\*:\s*(.+)/);
  const descriptionMatch = content.match(/\*\*Description\*\*:\s*(.+)/);
  const suggestionMatch = content.match(/\*\*Suggestion\*\*:\s*(.+)/);
  const screenshotMatch = content.match(/\*\*Screenshot\*\*:\s*(.+)/);

  const rawSeverity = severityMatch ? severityMatch[1].trim() : 'suggestion';
  const severity: Severity = VALID_SEVERITIES.includes(rawSeverity as Severity)
    ? (rawSeverity as Severity)
    : 'suggestion';

  return {
    id,
    title,
    uiArea: uiAreaMatch ? uiAreaMatch[1].trim() : '',
    severity,
    description: descriptionMatch ? descriptionMatch[1].trim() : '',
    suggestion: suggestionMatch ? suggestionMatch[1].trim() : '',
    screenshot: screenshotMatch ? screenshotMatch[1].trim() : '',
  };
}

/**
 * Write a complete instance report to the instance's report.md file.
 * Overwrites any existing content.
 */
export function writeInstanceReport(instanceNumber: number, report: InstanceReport): void {
  const paths = getInstancePaths(instanceNumber);
  const content = formatInstanceReport(report);
  writeFileSync(paths.report, content, 'utf-8');
}

/**
 * Read and parse the instance report for an instance.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function readInstanceReport(instanceNumber: number): InstanceReport | null {
  const paths = getInstancePaths(instanceNumber);

  if (!existsSync(paths.report)) {
    return null;
  }

  try {
    const content = readFileSync(paths.report, 'utf-8');
    return parseInstanceReport(content, instanceNumber);
  } catch {
    return null;
  }
}

/**
 * Read the raw content of the report file for an instance.
 * Returns null if the file doesn't exist.
 */
export function readReportContent(instanceNumber: number): string | null {
  const paths = getInstancePaths(instanceNumber);

  if (!existsSync(paths.report)) {
    return null;
  }

  try {
    return readFileSync(paths.report, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Append a finding to an existing instance report file.
 * If the file doesn't exist, creates it with the header and the finding.
 * If the file exists, appends the new finding below existing content.
 */
export function appendFinding(instanceNumber: number, finding: Finding): void {
  const paths = getInstancePaths(instanceNumber);

  if (!existsSync(paths.report)) {
    const report: InstanceReport = { instanceNumber, findings: [finding] };
    writeFileSync(paths.report, formatInstanceReport(report), 'utf-8');
  } else {
    const findingText = '\n' + formatFinding(finding) + '\n';
    appendFileSync(paths.report, findingText, 'utf-8');
  }
}

/**
 * Build the report format instructions for a Claude instance prompt.
 * This tells Claude exactly how to structure findings in the report.
 *
 * Screenshot capture instructions are provided separately via the screenshots module.
 */
export function buildReportInstructions(instanceNumber: number, reportPath: string): string {
  return `### 2. Report Document: ${reportPath}

Write each UX finding as you discover it, using this exact markdown format:

\`\`\`markdown
## I${instanceNumber}-UXR-NNN: Finding Title

- **UI Area**: Which part of the app
- **Severity**: critical | major | minor | suggestion
- **Description**: Detailed observation of the UX issue
- **Suggestion**: Recommended improvement
- **Screenshot**: I${instanceNumber}-UXR-NNN.png
\`\`\`

Number findings sequentially starting from I${instanceNumber}-UXR-001. Each finding must have a unique instance-scoped ID.

For findings with multiple screenshots, list all screenshot filenames comma-separated:
\`\`\`
- **Screenshot**: I${instanceNumber}-UXR-NNN.png, I${instanceNumber}-UXR-NNN-a.png, I${instanceNumber}-UXR-NNN-b.png
\`\`\`

Start the file with:

\`\`\`markdown
# UX Report - Instance ${instanceNumber}
\`\`\`

Append new findings as you go. Never overwrite previous findings.`;
}
