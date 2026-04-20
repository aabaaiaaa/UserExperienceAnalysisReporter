import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { encodeScreenshotBase64 } from './html-report.js';
import { debug } from './logger.js';

/**
 * Metadata about the discovery run, displayed in the report header.
 */
export interface DiscoveryMetadata {
  /** The URL that was reviewed */
  url: string;
  /** Date of the discovery run */
  date: string;
  /** Number of Claude instances used */
  instanceCount: number;
  /** Number of analysis rounds per instance */
  roundCount: number;
}

/**
 * A parsed sub-area within a top-level area.
 */
interface SubArea {
  /** The sub-area heading text */
  heading: string;
  /** Content lines (bullet items) under this sub-area */
  contentLines: string[];
}

/**
 * A parsed top-level area section from the discovery markdown.
 */
interface AreaSection {
  /** The area heading text */
  heading: string;
  /** Content lines (bullet items) directly under the area heading */
  contentLines: string[];
  /** Nested sub-areas (### headings) */
  subAreas: SubArea[];
}

/**
 * Regular expression matching screenshot filenames in the content.
 * Matches: I{N}-UXR-{NNN}.png and I{N}-UXR-{NNN}-{a-z}.png
 */
const SCREENSHOT_REF_REGEX = /I\d+-UXR-\d+(-[a-z])?\.png/g;

/**
 * Escape HTML special characters to prevent injection.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
 * Parse discovery markdown content into structured area sections.
 *
 * Expects:
 * - `# Heading` lines as top-level area sections
 * - `## Sub-heading` lines as nested sub-areas
 * - Bullet list lines under headings as content items (indentation preserved for
 *   nested rendering)
 */
function parseDiscoveryMarkdown(content: string): AreaSection[] {
  const lines = content.split('\n');
  const areas: AreaSection[] = [];
  let currentArea: AreaSection | null = null;
  let currentSubArea: SubArea | null = null;

  for (const line of lines) {
    // Check for # heading (but NOT ## — exactly one hash)
    const h1Match = line.match(/^# (.+)$/);
    if (h1Match) {
      // Finish any pending sub-area
      if (currentSubArea && currentArea) {
        currentArea.subAreas.push(currentSubArea);
        currentSubArea = null;
      }
      // Start a new top-level area
      currentArea = {
        heading: h1Match[1].trim(),
        contentLines: [],
        subAreas: [],
      };
      areas.push(currentArea);
      continue;
    }

    // Check for ## sub-heading
    const h2Match = line.match(/^## (.+)$/);
    if (h2Match && currentArea) {
      // Finish any pending sub-area
      if (currentSubArea) {
        currentArea.subAreas.push(currentSubArea);
      }
      currentSubArea = {
        heading: h2Match[1].trim(),
        contentLines: [],
      };
      continue;
    }

    // Content line (bullet or non-empty text)
    const trimmed = line.trim();
    if (trimmed && currentArea) {
      if (currentSubArea) {
        currentSubArea.contentLines.push(line);
      } else {
        currentArea.contentLines.push(line);
      }
    }
  }

  // Push final pending sub-area
  if (currentSubArea && currentArea) {
    currentArea.subAreas.push(currentSubArea);
  }

  return areas;
}

/**
 * Extract all screenshot filenames referenced in a block of text.
 */
function extractScreenshotRefs(text: string): string[] {
  const matches = text.match(SCREENSHOT_REF_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Render a contiguous run of bullets as a nested `<ul>` tree, preserving
 * indentation-based hierarchy. Each entry is `{indent, text}` where `indent` is
 * the number of leading whitespace characters on the original line.
 */
function renderBulletTree(bullets: { indent: number; text: string }[]): string {
  if (bullets.length === 0) return '';

  const out: string[] = [];
  const stack: number[] = [];

  for (const b of bullets) {
    while (stack.length > 0 && stack[stack.length - 1] > b.indent) {
      out.push('</li></ul>');
      stack.pop();
    }

    if (stack.length === 0 || stack[stack.length - 1] < b.indent) {
      out.push('<ul>');
      stack.push(b.indent);
    } else {
      out.push('</li>');
    }

    out.push(`<li>${escapeHtml(b.text)}`);
  }

  while (stack.length > 0) {
    out.push('</li></ul>');
    stack.pop();
  }

  return out.join('\n');
}

/**
 * Render content lines as HTML, converting markdown bullets to nested list
 * items (indentation preserved) and any non-bullet text lines to `<p>`.
 */
function renderContentLines(lines: string[]): string {
  if (lines.length === 0) return '';

  const htmlParts: string[] = [];
  let bulletBuffer: { indent: number; text: string }[] = [];

  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    htmlParts.push(renderBulletTree(bulletBuffer));
    bulletBuffer = [];
  };

  for (const line of lines) {
    if (!line.trim()) continue;

    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletMatch) {
      bulletBuffer.push({ indent: bulletMatch[1].length, text: bulletMatch[2] });
    } else {
      flushBullets();
      htmlParts.push(`<p>${escapeHtml(line.trim())}</p>`);
    }
  }
  flushBullets();

  return htmlParts.join('\n');
}

/**
 * Render embedded screenshot images for a list of screenshot filenames.
 */
function renderScreenshotImages(refs: string[], screenshotsDir: string): string {
  const images: string[] = [];
  for (const ref of refs) {
    const dataUri = encodeScreenshotBase64(screenshotsDir, ref);
    if (dataUri) {
      images.push(`<img src="${dataUri}" alt="${escapeHtml(ref)}" class="screenshot" />`);
    }
  }
  return images.join('\n');
}

/**
 * Generate the inline CSS for the discovery HTML report.
 * Based on the same foundation as the findings report but adapted for discovery content.
 */
function getDiscoveryStyles(): string {
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
  .area-content { padding: 0.75rem 1rem; }
  .sub-area { margin-left: 1.5rem; border-left: 3px solid #e5e7eb; padding-left: 1rem; }
  .sub-area details { border: none; margin-bottom: 0.5rem; }
  .sub-area summary { font-size: 0.95rem; background: transparent; padding: 0.5rem 0; }
  .screenshot { max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 4px; margin: 0.5rem 0; }
  .screenshots-section { padding: 0.75rem 1rem; }
  ul { margin: 0.25rem 0; padding-left: 1.5rem; }
  li { margin: 0.15rem 0; }
  p { margin: 0.5rem 0; }
</style>`;
}

/**
 * Build the table of contents HTML from parsed area sections.
 */
function buildDiscoveryToc(areas: AreaSection[]): string {
  const items: string[] = [];

  for (const area of areas) {
    const areaAnchor = toAnchorId(area.heading);
    if (area.subAreas.length > 0) {
      items.push(`<li><a href="#${areaAnchor}">${escapeHtml(area.heading)}</a><ul>`);
      for (const sub of area.subAreas) {
        const subAnchor = toAnchorId(`${area.heading}-${sub.heading}`);
        items.push(`  <li><a href="#${subAnchor}">${escapeHtml(sub.heading)}</a></li>`);
      }
      items.push('</ul></li>');
    } else {
      items.push(`<li><a href="#${areaAnchor}">${escapeHtml(area.heading)}</a></li>`);
    }
  }

  return `<nav class="toc">
<h2>Table of Contents</h2>
<ul>
${items.join('\n')}
</ul>
</nav>`;
}

/**
 * Get all valid screenshot filenames from a screenshots directory.
 * Returns an empty array if the directory does not exist.
 */
function listAllScreenshots(screenshotsDir: string): string[] {
  if (!existsSync(screenshotsDir)) {
    return [];
  }
  try {
    return readdirSync(screenshotsDir).filter((f) => /^I\d+-UXR-\d+(-[a-z])?\.png$/.test(f));
  } catch (err) {
    debug(`Failed to read screenshots directory ${screenshotsDir}: ${err}`);
    return [];
  }
}

/**
 * Format a complete discovery HTML report from consolidated discovery markdown and metadata.
 *
 * Produces a self-contained HTML string with inline CSS, a table of contents,
 * collapsible area sections, and embedded base64 screenshots.
 * No external dependencies — the file is fully standalone.
 *
 * @param discoveryContent - Consolidated discovery markdown content with ## headings for areas
 * @param metadata - Report metadata (URL, date, instance count, rounds)
 * @param screenshotsDir - Optional path to the screenshots directory. When provided,
 *   screenshot files referenced in the content are read and embedded as base64 `<img>` tags.
 *   Unreferenced screenshots are shown in a general section at the bottom.
 */
export function formatDiscoveryHtml(
  discoveryContent: string,
  metadata: DiscoveryMetadata,
  screenshotsDir?: string,
): string {
  const areas = parseDiscoveryMarkdown(discoveryContent);
  const toc = buildDiscoveryToc(areas);

  // Track which screenshots are matched to areas
  const matchedScreenshots = new Set<string>();

  const sections: string[] = [];
  for (const area of areas) {
    const areaAnchor = toAnchorId(area.heading);

    // Collect all text content for this area (including sub-areas) for screenshot matching
    const allAreaText = [
      ...area.contentLines,
      ...area.subAreas.flatMap((s) => [s.heading, ...s.contentLines]),
    ].join('\n');

    const areaScreenshotRefs = extractScreenshotRefs(allAreaText);
    for (const ref of areaScreenshotRefs) {
      matchedScreenshots.add(ref);
    }

    // Render area content
    const contentHtml = renderContentLines(area.contentLines);

    // Render screenshot images for this area
    let screenshotsHtml = '';
    if (screenshotsDir && areaScreenshotRefs.length > 0) {
      screenshotsHtml = renderScreenshotImages(areaScreenshotRefs, screenshotsDir);
    }

    // Render sub-areas
    const subAreaHtmlParts: string[] = [];
    for (const sub of area.subAreas) {
      const subAnchor = toAnchorId(`${area.heading}-${sub.heading}`);
      const subContentHtml = renderContentLines(sub.contentLines);

      // Extract sub-area-specific screenshot refs
      const subText = [sub.heading, ...sub.contentLines].join('\n');
      const subScreenshotRefs = extractScreenshotRefs(subText);
      let subScreenshotsHtml = '';
      if (screenshotsDir && subScreenshotRefs.length > 0) {
        subScreenshotsHtml = renderScreenshotImages(subScreenshotRefs, screenshotsDir);
      }

      subAreaHtmlParts.push(
        `<div class="sub-area">
<details id="${subAnchor}">
<summary>${escapeHtml(sub.heading)}</summary>
<div class="area-content">
${subContentHtml}${subScreenshotsHtml ? '\n' + subScreenshotsHtml : ''}
</div>
</details>
</div>`,
      );
    }

    const subAreasHtml = subAreaHtmlParts.join('\n');

    sections.push(
      `<details open id="${areaAnchor}">
<summary>${escapeHtml(area.heading)}</summary>
<div class="area-content">
${contentHtml}${screenshotsHtml ? '\n' + screenshotsHtml : ''}
</div>
${subAreasHtml}
</details>`,
    );
  }

  // Collect unmatched screenshots
  let unmatchedSection = '';
  if (screenshotsDir) {
    const allScreenshots = listAllScreenshots(screenshotsDir);
    const unmatched = allScreenshots.filter((f) => !matchedScreenshots.has(f));
    if (unmatched.length > 0) {
      const unmatchedImages = renderScreenshotImages(unmatched, screenshotsDir);
      if (unmatchedImages) {
        unmatchedSection = `<details open id="unmatched-screenshots">
<summary>Screenshots</summary>
<div class="screenshots-section">
${unmatchedImages}
</div>
</details>`;
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UX Discovery Report</title>
${getDiscoveryStyles()}
</head>
<body>
<h1>UX Discovery Report</h1>
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
${unmatchedSection}
</body>
</html>`;
}
