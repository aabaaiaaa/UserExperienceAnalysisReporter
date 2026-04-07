import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UIAreaGroup, HierarchicalFinding } from './consolidation.js';
import { Finding, Severity } from './report.js';

/**
 * Metadata about the analysis run, displayed in the report header.
 */
export interface ReportMetadata {
  /** The URL that was reviewed */
  url: string;
  /** Date of the analysis run */
  date: string;
  /** Number of Claude instances used */
  instanceCount: number;
  /** Number of analysis rounds per instance */
  roundCount: number;
}

/**
 * Map severity levels to display colors.
 */
const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#dc2626',
  major: '#ea580c',
  minor: '#ca8a04',
  suggestion: '#2563eb',
};

/**
 * Generate a CSS-safe anchor ID from a string.
 */
function toAnchorId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Escape HTML special characters to prevent injection.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Read a screenshot file and return it as a base64 data URI.
 * Returns null if the file does not exist or cannot be read.
 */
export function encodeScreenshotBase64(screenshotsDir: string, filename: string): string | null {
  const filePath = join(screenshotsDir, filename);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const buffer = readFileSync(filePath);
    const base64 = buffer.toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch {
    return null;
  }
}

/**
 * Render embedded screenshot `<img>` tags for a finding's screenshot references.
 * Parses comma-separated screenshot filenames, encodes each as base64, and
 * returns the HTML. Missing screenshots are silently skipped.
 */
function renderScreenshots(screenshotField: string, screenshotsDir: string | undefined): string {
  if (!screenshotsDir || !screenshotField) {
    return `<dd>${escapeHtml(screenshotField)}</dd>`;
  }

  const refs = screenshotField
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (refs.length === 0) {
    return `<dd>${escapeHtml(screenshotField)}</dd>`;
  }

  const images: string[] = [];
  for (const ref of refs) {
    const dataUri = encodeScreenshotBase64(screenshotsDir, ref);
    if (dataUri) {
      images.push(`<img src="${dataUri}" alt="${escapeHtml(ref)}" class="screenshot" />`);
    }
  }

  if (images.length === 0) {
    return `<dd>${escapeHtml(screenshotField)}</dd>`;
  }

  return `<dd>${images.join('\n')}</dd>`;
}

/**
 * Render a single finding as HTML.
 */
function renderFinding(finding: Finding, headingLevel: number, screenshotsDir?: string): string {
  const tag = `h${Math.min(headingLevel, 6)}`;
  const color = SEVERITY_COLORS[finding.severity] || SEVERITY_COLORS.suggestion;
  const anchorId = toAnchorId(finding.id);

  return `<div class="finding" id="${anchorId}">
  <${tag}>${escapeHtml(finding.id)}: ${escapeHtml(finding.title)}</${tag}>
  <span class="severity" style="background-color: ${color};">${escapeHtml(finding.severity)}</span>
  <dl>
    <dt>Description</dt>
    <dd>${escapeHtml(finding.description)}</dd>
    <dt>Suggestion</dt>
    <dd>${escapeHtml(finding.suggestion)}</dd>
    <dt>Screenshot</dt>
    ${renderScreenshots(finding.screenshot, screenshotsDir)}
  </dl>
</div>`;
}

/**
 * Render a hierarchical finding (parent + children) as HTML.
 */
function renderHierarchicalFinding(hf: HierarchicalFinding, screenshotsDir?: string): string {
  let html = renderFinding(hf.finding, 3, screenshotsDir);

  for (const child of hf.children) {
    html += '\n' + `<div class="child-finding">\n${renderFinding(child, 4, screenshotsDir)}\n</div>`;
  }

  return html;
}

/**
 * Build the table of contents HTML from UI area groups.
 */
function buildTableOfContents(groups: UIAreaGroup[]): string {
  const items: string[] = [];

  for (const group of groups) {
    const areaAnchor = toAnchorId(group.area);
    items.push(`<li><a href="#${areaAnchor}">${escapeHtml(group.area)}</a><ul>`);

    for (const hf of group.findings) {
      const findingAnchor = toAnchorId(hf.finding.id);
      items.push(
        `  <li><a href="#${findingAnchor}">${escapeHtml(hf.finding.id)}: ${escapeHtml(hf.finding.title)}</a></li>`,
      );
    }

    items.push('</ul></li>');
  }

  return `<nav class="toc">
<h2>Table of Contents</h2>
<ul>
${items.join('\n')}
</ul>
</nav>`;
}

/**
 * Generate the inline CSS for the HTML report.
 */
function getStyles(): string {
  return `<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem;
    color: #1a1a1a;
    line-height: 1.6;
  }
  h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  .metadata { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 1rem; margin-bottom: 2rem; }
  .metadata dt { font-weight: 600; display: inline; }
  .metadata dd { display: inline; margin: 0 1rem 0 0; }
  .toc { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 1rem; margin-bottom: 2rem; }
  .toc ul { padding-left: 1.5rem; }
  .toc a { color: #2563eb; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  details { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 1rem; }
  summary { cursor: pointer; padding: 0.75rem 1rem; font-weight: 600; font-size: 1.1rem; background: #f9fafb; border-radius: 6px; }
  summary:hover { background: #f3f4f6; }
  .finding { padding: 0.75rem 1rem; border-bottom: 1px solid #f3f4f6; }
  .finding:last-child { border-bottom: none; }
  .severity { display: inline-block; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem; }
  .child-finding { margin-left: 1.5rem; border-left: 3px solid #e5e7eb; padding-left: 1rem; }
  dl { margin: 0.5rem 0; }
  dt { font-weight: 600; margin-top: 0.5rem; }
  dd { margin: 0 0 0.25rem 0; }
  .screenshot { max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 4px; margin: 0.5rem 0; }
</style>`;
}

/**
 * Format a complete HTML report from structured finding groups and metadata.
 *
 * Produces a self-contained HTML string with inline CSS, a table of contents,
 * severity color coding, and collapsible sections per UI area.
 * No external dependencies — the file is fully standalone.
 *
 * @param screenshotsDir - Optional path to the screenshots directory. When provided,
 *   screenshot files are read and embedded as base64 `<img>` tags. Missing screenshots
 *   are silently skipped.
 */
export function formatHtmlReport(groups: UIAreaGroup[], metadata: ReportMetadata, screenshotsDir?: string): string {
  const toc = buildTableOfContents(groups);

  const sections: string[] = [];
  for (const group of groups) {
    const areaAnchor = toAnchorId(group.area);
    const findingsHtml = group.findings.map((hf) => renderHierarchicalFinding(hf, screenshotsDir)).join('\n');

    sections.push(
      `<details open id="${areaAnchor}">
<summary>${escapeHtml(group.area)} (${group.findings.length} finding${group.findings.length !== 1 ? 's' : ''})</summary>
${findingsHtml}
</details>`,
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UX Analysis Report</title>
${getStyles()}
</head>
<body>
<h1>UX Analysis Report</h1>
<div class="metadata">
<dl>
  <dt>URL:</dt><dd>${escapeHtml(metadata.url)}</dd>
  <dt>Date:</dt><dd>${escapeHtml(metadata.date)}</dd>
  <dt>Instances:</dt><dd>${metadata.instanceCount}</dd>
  <dt>Rounds:</dt><dd>${metadata.roundCount}</dd>
</dl>
</div>
${toc}
${sections.join('\n')}
</body>
</html>`;
}
