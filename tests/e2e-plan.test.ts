/**
 * End-to-end test: Full plan discovery run with real Claude instances (no mocks).
 *
 * This test starts the test fixture web app, runs the full plan discovery
 * pipeline with 1 real Claude instance, and verifies the output.
 *
 * Run separately from integration tests:
 *   npm run test:e2e
 *
 * Requires:
 *   - Claude Code CLI installed and authenticated
 *   - Playwright MCP available
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startServer, stopServer } from './fixtures/e2e-app/server.js';
import { runPlanDiscovery } from '../src/plan-orchestrator.js';
import { ParsedPlanArgs } from '../src/cli.js';
import { DEFAULT_SCOPE } from '../src/default-scope.js';
import { getTempDir } from '../src/file-manager.js';

const E2E_PLAN_OUTPUT_DIR = resolve('.uxreview-e2e-plan-output');

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

describe('E2E: Full plan discovery run with real Claude instances', () => {
  let serverUrl: string;

  beforeAll(async () => {
    // Clean up from any previous run
    safeRmDir(E2E_PLAN_OUTPUT_DIR);
    safeRmDir(getTempDir());

    const { url } = await startServer();
    serverUrl = url;
  });

  afterAll(async () => {
    await stopServer();
    safeRmDir(getTempDir());
    safeRmDir(E2E_PLAN_OUTPUT_DIR);
  });

  it('completes plan discovery with 1 instance and produces valid output', async () => {
    const args: ParsedPlanArgs = {
      url: serverUrl,
      intro: E2E_INTRO,
      plan: E2E_PLAN,
      scope: DEFAULT_SCOPE,
      instances: 1,
      rounds: 1,
      output: E2E_PLAN_OUTPUT_DIR,
      keepTemp: false,
      dryRun: false,
      verbose: false,
      suppressOpen: true,
    };

    // Run the full plan discovery — no mocks, real Claude instances
    await runPlanDiscovery(args);

    // ---------------------------------------------------------------
    // Verify: discovery.html exists and has content
    // ---------------------------------------------------------------
    const discoveryHtmlPath = join(E2E_PLAN_OUTPUT_DIR, 'discovery.html');
    expect(existsSync(discoveryHtmlPath)).toBe(true);

    const discoveryHtmlContent = readFileSync(discoveryHtmlPath, 'utf-8');
    expect(discoveryHtmlContent.length).toBeGreaterThan(0);

    // discovery.html should contain at least one heading (structured content)
    expect(discoveryHtmlContent).toMatch(/<h[1-6][^>]*>/);

    // ---------------------------------------------------------------
    // Verify: plan.md exists and has content
    // ---------------------------------------------------------------
    const planPath = join(E2E_PLAN_OUTPUT_DIR, 'plan.md');
    expect(existsSync(planPath)).toBe(true);

    const planContent = readFileSync(planPath, 'utf-8');
    expect(planContent.length).toBeGreaterThan(100);

    // ---------------------------------------------------------------
    // Verify: discovery.md exists (the consolidated markdown)
    // ---------------------------------------------------------------
    const discoveryMdPath = join(E2E_PLAN_OUTPUT_DIR, 'discovery.md');
    expect(existsSync(discoveryMdPath)).toBe(true);

    const discoveryMdContent = readFileSync(discoveryMdPath, 'utf-8');
    expect(discoveryMdContent.length).toBeGreaterThan(0);

    // ---------------------------------------------------------------
    // Verify: no crashes or unhandled errors (if we got here, it passed)
    // ---------------------------------------------------------------
    // The runPlanDiscovery() call above would have thrown on any unhandled error.
    // Reaching this point means the tool completed successfully.
  });
});
