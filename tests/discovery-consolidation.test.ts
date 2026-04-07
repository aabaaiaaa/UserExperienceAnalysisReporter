import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  readAllDiscoveryDocs,
  buildDiscoveryConsolidationPrompt,
  consolidateDiscoveryDocs,
  writeConsolidatedDiscovery,
  DiscoveryConsolidationResult,
} from '../src/consolidation.js';

// Mock the claude-cli module
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

// Mock the discovery module's readDiscoveryContent
vi.mock('../src/discovery.js', () => ({
  readDiscoveryContent: vi.fn(),
}));

// Mock sleep to avoid real delays when withRateLimitRetry retries on rate-limit errors
vi.mock('../src/rate-limit.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/rate-limit.js')>();
  return {
    ...original,
    sleep: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock the file-manager module
vi.mock('../src/file-manager.js', () => ({
  getInstancePaths: vi.fn((instanceNumber: number) => {
    const dir = join(process.cwd(), '.uxreview-temp-test', `instance-${instanceNumber}`);
    return {
      dir,
      discovery: join(dir, 'discovery.md'),
      checkpoint: join(dir, 'checkpoint.json'),
      report: join(dir, 'report.md'),
      screenshots: join(dir, 'screenshots'),
    };
  }),
}));

import { runClaude } from '../src/claude-cli.js';
import { readDiscoveryContent } from '../src/discovery.js';

const mockedRunClaude = vi.mocked(runClaude);
const mockedReadDiscoveryContent = vi.mocked(readDiscoveryContent);

// ---- Sample discovery doc content ----

const INSTANCE_1_DISCOVERY = `# Discovery Document - Instance 1

## Round 1

### Navigation Bar
- **Visited**: 2026-04-01T10:00:00Z
- **Navigation Path**: Direct load
- **Elements Observed**:
  - Main nav links
  - Logo
  - Search bar
  - User menu dropdown
- **Checked**:
  - Layout consistency
  - Hover states
  - Mobile responsiveness

### Dashboard
- **Visited**: 2026-04-01T10:05:00Z
- **Navigation Path**: Home → Dashboard
- **Elements Observed**:
  - Stat cards
  - Activity feed
  - Quick actions panel
- **Checked**:
  - Card spacing
  - Loading states
  - Empty states
`;

const INSTANCE_2_DISCOVERY = `# Discovery Document - Instance 2

## Round 1

### Navigation Bar
- **Visited**: 2026-04-01T10:01:00Z
- **Navigation Path**: Direct load
- **Elements Observed**:
  - Main nav links
  - Breadcrumb trail
  - Mobile hamburger menu
- **Checked**:
  - Link consistency
  - Accessibility labels
  - Keyboard navigation

### Settings Page
- **Visited**: 2026-04-01T10:06:00Z
- **Navigation Path**: Home → Settings
- **Elements Observed**:
  - Profile form
  - Notification toggles
  - Theme selector
- **Checked**:
  - Form validation
  - Save button states
  - Error messaging
`;

const INSTANCE_3_DISCOVERY = `# Discovery Document - Instance 3

## Round 1

### Dashboard
- **Visited**: 2026-04-01T10:02:00Z
- **Navigation Path**: Home → Dashboard
- **Elements Observed**:
  - Stat cards
  - Charts and graphs
  - Filter controls
- **Checked**:
  - Data visualization clarity
  - Interactive element consistency
  - Tooltip behavior

### User Profile
- **Visited**: 2026-04-01T10:08:00Z
- **Navigation Path**: Dashboard → User Menu → Profile
- **Elements Observed**:
  - Avatar upload
  - Bio editor
  - Activity history
- **Checked**:
  - Image upload flow
  - Text input validation
  - Content hierarchy
`;

const CONSOLIDATED_RESPONSE = `# Navigation Bar

- Main nav links
  - Checked: layout consistency, link consistency, hover states
- Logo
  - Checked: layout consistency
- Search bar
  - Checked: layout consistency
- User menu dropdown
  - Checked: hover states
- Breadcrumb trail
  - Checked: accessibility labels
- Mobile hamburger menu
  - Checked: mobile responsiveness, keyboard navigation

# Dashboard

- Stat cards
  - Checked: card spacing, loading states, data visualization clarity
- Activity feed
  - Checked: loading states, empty states
- Quick actions panel
  - Checked: empty states
- Charts and graphs
  - Checked: data visualization clarity, interactive element consistency
- Filter controls
  - Checked: interactive element consistency, tooltip behavior

# Settings Page

- Profile form
  - Checked: form validation, error messaging
- Notification toggles
  - Checked: save button states
- Theme selector
  - Checked: save button states

# User Profile

- Avatar upload
  - Checked: image upload flow
- Bio editor
  - Checked: text input validation
- Activity history
  - Checked: content hierarchy`;

// ---- Tests ----

describe('readAllDiscoveryDocs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads discovery docs from all instances', () => {
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      if (num === 2) return INSTANCE_2_DISCOVERY;
      if (num === 3) return INSTANCE_3_DISCOVERY;
      return null;
    });

    const docs = readAllDiscoveryDocs([1, 2, 3]);

    expect(docs).toHaveLength(3);
    expect(docs[0].instanceNumber).toBe(1);
    expect(docs[0].content).toBe(INSTANCE_1_DISCOVERY);
    expect(docs[1].instanceNumber).toBe(2);
    expect(docs[2].instanceNumber).toBe(3);
  });

  it('skips instances with missing discovery docs', () => {
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      if (num === 2) return null;
      if (num === 3) return INSTANCE_3_DISCOVERY;
      return null;
    });

    const docs = readAllDiscoveryDocs([1, 2, 3]);

    expect(docs).toHaveLength(2);
    expect(docs[0].instanceNumber).toBe(1);
    expect(docs[1].instanceNumber).toBe(3);
  });

  it('skips instances with empty discovery docs', () => {
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      if (num === 2) return '   \n  ';
      return null;
    });

    const docs = readAllDiscoveryDocs([1, 2]);

    expect(docs).toHaveLength(1);
    expect(docs[0].instanceNumber).toBe(1);
  });

  it('returns empty array when no docs exist', () => {
    mockedReadDiscoveryContent.mockReturnValue(null);

    const docs = readAllDiscoveryDocs([1, 2, 3]);

    expect(docs).toHaveLength(0);
  });
});

describe('buildDiscoveryConsolidationPrompt', () => {
  it('includes all instance documents in the prompt', () => {
    const docs = [
      { instanceNumber: 1, content: INSTANCE_1_DISCOVERY },
      { instanceNumber: 2, content: INSTANCE_2_DISCOVERY },
      { instanceNumber: 3, content: INSTANCE_3_DISCOVERY },
    ];

    const prompt = buildDiscoveryConsolidationPrompt(docs);

    expect(prompt).toContain('INSTANCE 1 DISCOVERY');
    expect(prompt).toContain('INSTANCE 2 DISCOVERY');
    expect(prompt).toContain('INSTANCE 3 DISCOVERY');
    expect(prompt).toContain(INSTANCE_1_DISCOVERY);
    expect(prompt).toContain(INSTANCE_2_DISCOVERY);
    expect(prompt).toContain(INSTANCE_3_DISCOVERY);
  });

  it('mentions the correct number of reviewers', () => {
    const docs = [
      { instanceNumber: 1, content: 'doc 1' },
      { instanceNumber: 2, content: 'doc 2' },
    ];

    const prompt = buildDiscoveryConsolidationPrompt(docs);

    expect(prompt).toContain('2 independent reviewers');
  });

  it('instructs deduplication and hierarchical structuring', () => {
    const docs = [{ instanceNumber: 1, content: 'doc 1' }];

    const prompt = buildDiscoveryConsolidationPrompt(docs);

    expect(prompt).toContain('DEDUPLICATES');
    expect(prompt).toContain('hierarchy');
    expect(prompt).toContain('review plan');
  });

  it('instructs not to include timestamps or instance numbers', () => {
    const docs = [{ instanceNumber: 1, content: 'doc 1' }];

    const prompt = buildDiscoveryConsolidationPrompt(docs);

    expect(prompt).toContain('Do NOT include instance numbers, timestamps');
  });
});

describe('consolidateDiscoveryDocs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when no discovery docs exist', async () => {
    mockedReadDiscoveryContent.mockReturnValue(null);

    const result = await consolidateDiscoveryDocs([1, 2, 3]);

    expect(result.content).toBe('');
    expect(result.instanceCount).toBe(0);
    expect(result.usedClaude).toBe(false);
    expect(mockedRunClaude).not.toHaveBeenCalled();
  });

  it('uses Claude to restructure a single discovery doc', async () => {
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      return null;
    });

    mockedRunClaude.mockResolvedValueOnce({
      stdout: CONSOLIDATED_RESPONSE,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await consolidateDiscoveryDocs([1]);

    expect(result.instanceCount).toBe(1);
    expect(result.usedClaude).toBe(true);
    expect(result.content).toBe(CONSOLIDATED_RESPONSE);
    expect(mockedRunClaude).toHaveBeenCalledTimes(1);
  });

  it('falls back to raw content when Claude fails on single doc', async () => {
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      return null;
    });

    mockedRunClaude.mockResolvedValueOnce({
      stdout: '',
      stderr: 'Claude error',
      exitCode: 1,
      success: false,
    });

    const result = await consolidateDiscoveryDocs([1]);

    expect(result.instanceCount).toBe(1);
    expect(result.usedClaude).toBe(false);
    expect(result.content).toBe(INSTANCE_1_DISCOVERY);
  });

  it('uses Claude to merge multiple discovery docs', async () => {
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      if (num === 2) return INSTANCE_2_DISCOVERY;
      if (num === 3) return INSTANCE_3_DISCOVERY;
      return null;
    });

    mockedRunClaude.mockResolvedValueOnce({
      stdout: CONSOLIDATED_RESPONSE,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await consolidateDiscoveryDocs([1, 2, 3]);

    expect(result.instanceCount).toBe(3);
    expect(result.usedClaude).toBe(true);
    expect(result.content).toBe(CONSOLIDATED_RESPONSE);
    expect(mockedRunClaude).toHaveBeenCalledTimes(1);

    // Verify the prompt includes all docs
    const promptArg = mockedRunClaude.mock.calls[0][0].prompt;
    expect(promptArg).toContain('INSTANCE 1 DISCOVERY');
    expect(promptArg).toContain('INSTANCE 2 DISCOVERY');
    expect(promptArg).toContain('INSTANCE 3 DISCOVERY');
  });

  it('throws when Claude fails on multiple docs', async () => {
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      if (num === 2) return INSTANCE_2_DISCOVERY;
      return null;
    });

    mockedRunClaude.mockResolvedValueOnce({
      stdout: '',
      stderr: 'Internal server error',
      exitCode: 1,
      success: false,
    });

    await expect(consolidateDiscoveryDocs([1, 2])).rejects.toThrow(
      'Claude CLI failed during discovery consolidation',
    );
  });

  it('skips instances with no discovery docs in multi-instance run', async () => {
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      if (num === 2) return null; // Instance 2 failed, no discovery doc
      if (num === 3) return INSTANCE_3_DISCOVERY;
      return null;
    });

    mockedRunClaude.mockResolvedValueOnce({
      stdout: CONSOLIDATED_RESPONSE,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await consolidateDiscoveryDocs([1, 2, 3]);

    expect(result.instanceCount).toBe(2);
    expect(result.usedClaude).toBe(true);

    // Verify only instances 1 and 3 are in the prompt
    const promptArg = mockedRunClaude.mock.calls[0][0].prompt;
    expect(promptArg).toContain('INSTANCE 1 DISCOVERY');
    expect(promptArg).not.toContain('INSTANCE 2 DISCOVERY');
    expect(promptArg).toContain('INSTANCE 3 DISCOVERY');
  });

  it('trims whitespace from Claude response', async () => {
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      if (num === 2) return INSTANCE_2_DISCOVERY;
      return null;
    });

    mockedRunClaude.mockResolvedValueOnce({
      stdout: '\n  ' + CONSOLIDATED_RESPONSE + '\n\n',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await consolidateDiscoveryDocs([1, 2]);

    expect(result.content).toBe(CONSOLIDATED_RESPONSE);
  });
});

describe('writeConsolidatedDiscovery', () => {
  const testOutputDir = join(process.cwd(), '.uxreview-test-output-discovery');

  beforeEach(() => {
    mkdirSync(testOutputDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('writes the consolidated discovery doc to the output directory', () => {
    writeConsolidatedDiscovery(testOutputDir, CONSOLIDATED_RESPONSE);

    const outputPath = join(testOutputDir, 'discovery.md');
    expect(existsSync(outputPath)).toBe(true);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toBe(CONSOLIDATED_RESPONSE + '\n');
  });

  it('overwrites existing discovery doc', () => {
    const outputPath = join(testOutputDir, 'discovery.md');
    writeFileSync(outputPath, 'old content', 'utf-8');

    writeConsolidatedDiscovery(testOutputDir, CONSOLIDATED_RESPONSE);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toBe(CONSOLIDATED_RESPONSE + '\n');
  });
});

describe('discovery consolidation — end-to-end with 3 overlapping instances', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces a deduplicated, hierarchical, plan-reusable document from 3 instances', async () => {
    // Set up: 3 instances where instances 1 & 2 both visited Navigation Bar,
    // instances 1 & 3 both visited Dashboard
    mockedReadDiscoveryContent.mockImplementation((num: number) => {
      if (num === 1) return INSTANCE_1_DISCOVERY;
      if (num === 2) return INSTANCE_2_DISCOVERY;
      if (num === 3) return INSTANCE_3_DISCOVERY;
      return null;
    });

    // Claude returns a properly consolidated response
    mockedRunClaude.mockResolvedValueOnce({
      stdout: CONSOLIDATED_RESPONSE,
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await consolidateDiscoveryDocs([1, 2, 3]);

    // Verify: instanceCount is correct
    expect(result.instanceCount).toBe(3);
    expect(result.usedClaude).toBe(true);

    // Verify: the consolidated doc is deduplicated
    // "Navigation Bar" appears once as a heading (not twice, even though instances 1 & 2 both visited it)
    const navBarMatches = result.content.match(/^# Navigation Bar$/gm);
    expect(navBarMatches).toHaveLength(1);

    // "Dashboard" appears once as a heading (not twice, even though instances 1 & 3 both visited it)
    const dashboardMatches = result.content.match(/^# Dashboard$/gm);
    expect(dashboardMatches).toHaveLength(1);

    // Verify: hierarchically structured — top-level headings are UI areas
    expect(result.content).toContain('# Navigation Bar');
    expect(result.content).toContain('# Dashboard');
    expect(result.content).toContain('# Settings Page');
    expect(result.content).toContain('# User Profile');

    // Verify: elements are listed under their areas as bullets
    expect(result.content).toContain('- Main nav links');
    expect(result.content).toContain('- Stat cards');
    expect(result.content).toContain('- Profile form');
    expect(result.content).toContain('- Avatar upload');

    // Verify: readable as a review plan — contains checked criteria
    expect(result.content).toContain('Checked:');

    // Verify: no instance numbers or timestamps in the output
    expect(result.content).not.toContain('Instance 1');
    expect(result.content).not.toContain('Instance 2');
    expect(result.content).not.toContain('Instance 3');
    expect(result.content).not.toContain('2026-04-01T');
  });
});
