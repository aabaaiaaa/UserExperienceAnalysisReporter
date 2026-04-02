import { readdirSync, existsSync } from 'node:fs';
import { getInstancePaths } from './file-manager.js';

/**
 * Regular expression matching valid screenshot filenames.
 * Matches: I{N}-UXR-{NNN}.png and I{N}-UXR-{NNN}-{a-z}.png
 */
const SCREENSHOT_NAME_REGEX = /^I\d+-UXR-\d{3,}(-[a-z])?\.png$/;

/**
 * Regular expression for extracting the finding ID from a screenshot filename.
 */
const FINDING_ID_REGEX = /^(I\d+-UXR-\d{3,})(-[a-z])?\.png$/;

/**
 * Build the primary screenshot filename for a finding.
 * E.g., buildScreenshotFilename("I1-UXR-001") => "I1-UXR-001.png"
 */
export function buildScreenshotFilename(findingId: string): string {
  return `${findingId}.png`;
}

/**
 * Build a suffixed screenshot filename for findings with multiple screenshots.
 * Uses alphabetic suffixes: a, b, c, ...
 *
 * E.g., buildMultiScreenshotFilename("I1-UXR-001", 0) => "I1-UXR-001-a.png"
 *       buildMultiScreenshotFilename("I1-UXR-001", 1) => "I1-UXR-001-b.png"
 */
export function buildMultiScreenshotFilename(findingId: string, index: number): string {
  const suffix = String.fromCharCode(97 + index); // 97 = 'a'
  return `${findingId}-${suffix}.png`;
}

/**
 * Validate that a filename follows the screenshot naming convention.
 *
 * Valid formats:
 * - I{N}-UXR-{NNN}.png       (primary screenshot)
 * - I{N}-UXR-{NNN}-{a-z}.png (additional screenshot with suffix)
 */
export function isValidScreenshotName(filename: string): boolean {
  return SCREENSHOT_NAME_REGEX.test(filename);
}

/**
 * Extract the finding ID from a screenshot filename.
 * Returns null if the filename doesn't match the expected pattern.
 *
 * E.g., "I1-UXR-001.png"   => "I1-UXR-001"
 *       "I1-UXR-001-a.png" => "I1-UXR-001"
 *       "random.png"        => null
 */
export function extractFindingId(screenshotFilename: string): string | null {
  const match = screenshotFilename.match(FINDING_ID_REGEX);
  return match ? match[1] : null;
}

/**
 * List all valid screenshot files in an instance's screenshots directory.
 * Returns filenames only (not full paths), sorted alphabetically.
 */
export function listScreenshots(instanceNumber: number): string[] {
  const paths = getInstancePaths(instanceNumber);

  if (!existsSync(paths.screenshots)) {
    return [];
  }

  return readdirSync(paths.screenshots)
    .filter((f) => isValidScreenshotName(f))
    .sort();
}

/**
 * Get all screenshot filenames for a specific finding.
 * Returns both the primary screenshot and any suffixed additional screenshots.
 *
 * E.g., for findingId "I1-UXR-001", might return:
 *   ["I1-UXR-001.png", "I1-UXR-001-a.png", "I1-UXR-001-b.png"]
 */
export function getScreenshotsForFinding(instanceNumber: number, findingId: string): string[] {
  const all = listScreenshots(instanceNumber);
  return all.filter((f) => extractFindingId(f) === findingId);
}

/**
 * Build detailed screenshot capture instructions for a Claude instance prompt.
 * This tells Claude exactly how to capture and name screenshots via Playwright MCP.
 */
export function buildScreenshotInstructions(instanceNumber: number, screenshotsPath: string): string {
  return `### 3. Screenshots Directory: ${screenshotsPath}/

Capture screenshots via Playwright MCP as visual evidence for each UX finding.

**Screenshot capture process:**
1. When you identify a UX issue, capture a screenshot of the relevant UI state using Playwright MCP's screenshot tool.
2. Save the screenshot to the screenshots directory using the naming convention below.
3. Reference the screenshot filename in the finding's report entry.

**Naming convention:**
- Primary screenshot: \`I${instanceNumber}-UXR-NNN.png\` (e.g., \`I${instanceNumber}-UXR-001.png\`)
- Additional screenshots for the same finding use alphabetic suffixes:
  \`I${instanceNumber}-UXR-NNN-a.png\`, \`I${instanceNumber}-UXR-NNN-b.png\`, etc.
  Example: \`I${instanceNumber}-UXR-001-a.png\`, \`I${instanceNumber}-UXR-001-b.png\`

**When to capture multiple screenshots for one finding:**
- Before/after states (e.g., form before and after submission)
- Different viewport sizes showing responsive issues
- Multiple occurrences of the same issue across pages
- Step-by-step sequences showing a broken flow

**Rules:**
- Every finding MUST have at least one screenshot as evidence.
- Save all screenshots to: \`${screenshotsPath}/\`
- Use the finding's instance-scoped ID in the filename.
- Screenshot files must be PNG format.
- Reference all screenshots for a finding in its report entry (comma-separated if multiple).`;
}
