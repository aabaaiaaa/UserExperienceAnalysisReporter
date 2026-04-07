/**
 * End-to-end test: Full tool run with real Claude instances (no mocks).
 *
 * This test starts the test fixture web app, runs the full orchestration
 * pipeline with 2 real Claude Code instances, and verifies the output.
 *
 * Run separately from integration tests:
 *   npm run test:e2e
 *
 * Requires:
 *   - Claude Code CLI installed and authenticated
 *   - Playwright MCP available
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startServer, stopServer } from './fixtures/e2e-app/server.js';
import { orchestrate } from '../src/orchestrator.js';
import { ParsedArgs } from '../src/cli.js';
import { DEFAULT_SCOPE } from '../src/default-scope.js';
import { getTempDir } from '../src/file-manager.js';

const E2E_OUTPUT_DIR = resolve('.uxreview-e2e-output');

const E2E_INTRO = `TaskFlow is a simple static project management dashboard. No login required.

It has 4 pages:
1. Dashboard (/) — Stat cards with action buttons, activity feed
2. Projects (/listings.html) — Table of projects with action buttons
3. Settings (/settings.html) — Forms for profile, notifications, security
4. Reports (/detail.html) — Report detail page

Navigate between pages using the nav links in the header, or by URL.`;

const E2E_PLAN = `## Dashboard & Navigation
- Check nav header consistency across pages (does every page have the same header?)
- Review dashboard card button styles and terminology (View, See Details, Open, Check)
- Check for empty states and loading indicators

## Settings & Forms
- Check form validation feedback on required fields
- Check label contrast and readability
- Compare action button terminology (Save vs Submit vs Confirm across sections)
- Review the Danger Zone for appropriate styling

## Projects Listing
- Review table row alignment and action button consistency
- Check status badge contrast
- Look for empty state in archived section

## Report Detail
- Check for navigation back to other pages (header, breadcrumbs)
- Review text contrast in the notes section
- Check button styles (Download, Export, Share) for consistency`;

/**
 * Safely remove a directory, ignoring EBUSY/EPERM errors that can occur
 * on Windows when subprocesses haven't fully released file handles.
 */
function safeRmDir(dir: string): void {
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors — stale dirs don't affect correctness
  }
}

describe('E2E: Full tool run with real Claude instances', () => {
  let serverUrl: string;

  beforeAll(async () => {
    // Clean up from any previous run
    safeRmDir(E2E_OUTPUT_DIR);
    safeRmDir(getTempDir());

    const { url } = await startServer();
    serverUrl = url;
  });

  afterAll(async () => {
    await stopServer();
    safeRmDir(getTempDir());
    safeRmDir(E2E_OUTPUT_DIR);
  });

  it('completes full analysis with 2 instances and produces valid output', async () => {
    const args: ParsedArgs = {
      url: serverUrl,
      intro: E2E_INTRO,
      plan: E2E_PLAN,
      scope: DEFAULT_SCOPE,
      instances: 2,
      rounds: 1,
      output: E2E_OUTPUT_DIR,
      keepTemp: false,
    };

    // Run the full orchestration — no mocks, real Claude instances
    await orchestrate(args);

    // ---------------------------------------------------------------
    // Verify: consolidated report exists and has findings with UXR- IDs
    // ---------------------------------------------------------------
    const reportPath = join(E2E_OUTPUT_DIR, 'report.md');
    expect(existsSync(reportPath)).toBe(true);

    const reportContent = readFileSync(reportPath, 'utf-8');
    expect(reportContent.length).toBeGreaterThan(0);

    // Report should contain UXR- IDs
    const uxrIdPattern = /UXR-\d{3}/g;
    const uxrMatches = reportContent.match(uxrIdPattern);
    expect(uxrMatches).not.toBeNull();
    expect(uxrMatches!.length).toBeGreaterThanOrEqual(2);

    // Extract unique finding IDs from headings
    const findingHeadingPattern = /^#{2,4}\s+(UXR-\d{3}):/gm;
    const findingIds = new Set<string>();
    let headingMatch: RegExpExecArray | null;
    while ((headingMatch = findingHeadingPattern.exec(reportContent)) !== null) {
      findingIds.add(headingMatch[1]);
    }
    expect(findingIds.size).toBeGreaterThanOrEqual(2);

    // Verify IDs are unique (no duplicates in headings)
    const headingIdList: string[] = [];
    const headingPattern2 = /^#{2,4}\s+(UXR-\d{3}):/gm;
    let m: RegExpExecArray | null;
    while ((m = headingPattern2.exec(reportContent)) !== null) {
      headingIdList.push(m[1]);
    }
    const uniqueIds = new Set(headingIdList);
    expect(uniqueIds.size).toBe(headingIdList.length);

    // No instance-scoped IDs should remain in the final report
    expect(reportContent).not.toMatch(/I\d+-UXR-\d{3}/);

    // ---------------------------------------------------------------
    // Verify: report groups findings by UI area (## headings)
    // ---------------------------------------------------------------
    const areaHeadingPattern = /^## [A-Z]/gm;
    const areaHeadings = reportContent.match(areaHeadingPattern);
    expect(areaHeadings).not.toBeNull();
    expect(areaHeadings!.length).toBeGreaterThanOrEqual(1);

    // ---------------------------------------------------------------
    // Verify: report contains screenshot references
    // ---------------------------------------------------------------
    expect(reportContent).toMatch(/UXR-\d{3}\.png/);

    // ---------------------------------------------------------------
    // Verify: screenshots exist in the output directory
    // ---------------------------------------------------------------
    const screenshotsDir = join(E2E_OUTPUT_DIR, 'screenshots');
    expect(existsSync(screenshotsDir)).toBe(true);

    const screenshotFiles = readdirSync(screenshotsDir).filter((f) => f.endsWith('.png'));
    expect(screenshotFiles.length).toBeGreaterThan(0);

    // Screenshots should be named with UXR- IDs
    const hasUxrScreenshot = screenshotFiles.some((f) => /^UXR-\d{3}/.test(f));
    expect(hasUxrScreenshot).toBe(true);

    // ---------------------------------------------------------------
    // Verify: consolidated discovery doc is present and structured
    // ---------------------------------------------------------------
    const discoveryPath = join(E2E_OUTPUT_DIR, 'discovery.md');
    expect(existsSync(discoveryPath)).toBe(true);

    const discoveryContent = readFileSync(discoveryPath, 'utf-8');
    expect(discoveryContent.length).toBeGreaterThan(0);

    // Discovery doc should have hierarchical structure (# headings for areas)
    expect(discoveryContent).toMatch(/^# .+/m);

    // ---------------------------------------------------------------
    // Verify: no crashes or unhandled errors (if we got here, it passed)
    // ---------------------------------------------------------------
    // The orchestrate() call above would have thrown on any unhandled error.
    // Reaching this point means the tool completed successfully.
  });
});
