import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatDiscoveryHtml, DiscoveryMetadata } from '../src/discovery-html.js';

// Mock logger
const mockDebug = vi.fn();
vi.mock('../src/logger.js', () => ({
  debug: (...args: unknown[]) => mockDebug(...args),
  setVerbose: vi.fn(),
}));

// Track whether readdirSync should throw for a specific path
let readdirSyncErrorPath: string | null = null;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) => {
      if (readdirSyncErrorPath && String(args[0]).includes(readdirSyncErrorPath)) {
        throw new Error('Permission denied');
      }
      return actual.readdirSync(...args);
    },
  };
});

// Minimal valid 1x1 PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function makeMetadata(overrides: Partial<DiscoveryMetadata> = {}): DiscoveryMetadata {
  return {
    url: 'https://example.com',
    date: '2026-04-09',
    instanceCount: 3,
    roundCount: 2,
    ...overrides,
  };
}

const SIMPLE_DISCOVERY = `## Navigation Bar

- Logo and branding
- Main navigation links
- Search functionality

## Dashboard

- Widget layout
- Data visualisation charts
`;

const NESTED_DISCOVERY = `## Navigation

- Top nav links
- Breadcrumb trail

### Mobile Menu

- Hamburger button
- Slide-out panel

### Search Bar

- Auto-complete dropdown
- Search filters

## Settings

- User preferences form
`;

describe('formatDiscoveryHtml', () => {
  it('generates valid HTML structure', () => {
    const html = formatDiscoveryHtml(SIMPLE_DISCOVERY, makeMetadata());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('<title>UX Discovery Report</title>');
    expect(html).toContain('https://example.com');
    expect(html).toContain('2026-04-09');
    expect(html).toContain('3');
    expect(html).toContain('2');
  });

  it('builds table of contents from headings', () => {
    const html = formatDiscoveryHtml(SIMPLE_DISCOVERY, makeMetadata());

    // TOC container
    expect(html).toContain('class="toc"');
    expect(html).toContain('Table of Contents');

    // Area links
    expect(html).toContain('href="#navigation-bar"');
    expect(html).toContain('href="#dashboard"');

    // Link text
    expect(html).toContain('>Navigation Bar</a>');
    expect(html).toContain('>Dashboard</a>');
  });

  it('creates collapsible sections for areas', () => {
    const html = formatDiscoveryHtml(SIMPLE_DISCOVERY, makeMetadata());

    // Each area is a <details> section
    expect(html).toContain('<details open id="navigation-bar">');
    expect(html).toContain('<summary>Navigation Bar</summary>');
    expect(html).toContain('<details open id="dashboard">');
    expect(html).toContain('<summary>Dashboard</summary>');
    expect(html).toContain('</details>');

    // Content is rendered
    expect(html).toContain('Logo and branding');
    expect(html).toContain('Widget layout');
  });

  it('handles nested sub-areas', () => {
    const html = formatDiscoveryHtml(NESTED_DISCOVERY, makeMetadata());

    // Top-level area
    expect(html).toContain('<details open id="navigation">');
    expect(html).toContain('<summary>Navigation</summary>');

    // Sub-areas as nested details
    expect(html).toContain('class="sub-area"');
    expect(html).toContain('<summary>Mobile Menu</summary>');
    expect(html).toContain('<summary>Search Bar</summary>');

    // Sub-area content
    expect(html).toContain('Hamburger button');
    expect(html).toContain('Auto-complete dropdown');

    // TOC includes nested entries
    expect(html).toContain('>Mobile Menu</a>');
    expect(html).toContain('>Search Bar</a>');
  });

  it('handles missing screenshotsDir gracefully', () => {
    const html = formatDiscoveryHtml(SIMPLE_DISCOVERY, makeMetadata());

    // Should produce valid HTML without errors
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('UX Discovery Report');
    // No img tags when no screenshots dir
    expect(html).not.toContain('<img');
  });

  it('handles undefined screenshotsDir explicitly', () => {
    const html = formatDiscoveryHtml(SIMPLE_DISCOVERY, makeMetadata(), undefined);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('<img');
  });

  it('handles empty discovery content', () => {
    const html = formatDiscoveryHtml('', makeMetadata());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('UX Discovery Report');
    // No area sections when content is empty
    expect(html).not.toContain('<details open id=');
  });

  it('escapes HTML special characters in content', () => {
    const dangerousContent = `## <script>alert("xss")</script>

- Item with <b>bold</b> & "quotes"
- Another item with 'single quotes'
`;

    const html = formatDiscoveryHtml(dangerousContent, makeMetadata());

    // Special chars must be escaped
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
    // Raw chars must NOT appear in escaped content
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>bold</b>');
  });

  it('includes inline CSS styles', () => {
    const html = formatDiscoveryHtml(SIMPLE_DISCOVERY, makeMetadata());

    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
    expect(html).toContain('font-family');
    expect(html).toContain('.screenshot');
    // No external stylesheets
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it('renders metadata header with all fields', () => {
    const metadata = makeMetadata({
      url: 'https://app.example.com/dashboard',
      date: '2026-04-09',
      instanceCount: 5,
      roundCount: 3,
    });

    const html = formatDiscoveryHtml(SIMPLE_DISCOVERY, metadata);

    expect(html).toContain('https://app.example.com/dashboard');
    expect(html).toContain('2026-04-09');
    expect(html).toContain('5');
    expect(html).toContain('3');
    expect(html).toContain('class="metadata"');
  });
});

describe('screenshot embedding', () => {
  const screenshotsDir = join(process.cwd(), '.uxreview-discovery-html-test-screenshots');

  beforeEach(() => {
    mkdirSync(screenshotsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(screenshotsDir)) {
      rmSync(screenshotsDir, { recursive: true, force: true });
    }
  });

  it('embeds screenshots as base64 when referenced in content', () => {
    writeFileSync(join(screenshotsDir, 'I1-UXR-001.png'), TINY_PNG);

    const content = `## Navigation

- Logo link: see I1-UXR-001.png
- Main menu links
`;

    const html = formatDiscoveryHtml(content, makeMetadata(), screenshotsDir);

    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain('alt="I1-UXR-001.png"');
    expect(html).toContain('class="screenshot"');
  });

  it('shows unmatched screenshots in general section', () => {
    writeFileSync(join(screenshotsDir, 'I1-UXR-099.png'), TINY_PNG);

    // Content does NOT reference I1-UXR-099.png
    const content = `## Navigation

- Logo link
- Main menu links
`;

    const html = formatDiscoveryHtml(content, makeMetadata(), screenshotsDir);

    // Unmatched screenshot should appear in a screenshots section at the bottom
    expect(html).toContain('id="unmatched-screenshots"');
    expect(html).toContain('<summary>Screenshots</summary>');
    expect(html).toContain('alt="I1-UXR-099.png"');
    expect(html).toContain('<img src="data:image/png;base64,');
  });

  it('does not show unmatched section when all screenshots are matched', () => {
    writeFileSync(join(screenshotsDir, 'I1-UXR-001.png'), TINY_PNG);

    const content = `## Navigation

- Logo link: I1-UXR-001.png
`;

    const html = formatDiscoveryHtml(content, makeMetadata(), screenshotsDir);

    expect(html).not.toContain('id="unmatched-screenshots"');
    // The matched screenshot should still appear in the area section
    expect(html).toContain('alt="I1-UXR-001.png"');
  });

  it('handles empty screenshots directory', () => {
    const content = `## Navigation

- Logo link
`;

    const html = formatDiscoveryHtml(content, makeMetadata(), screenshotsDir);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('id="unmatched-screenshots"');
  });

  it('embeds screenshots referenced in sub-areas', () => {
    writeFileSync(join(screenshotsDir, 'I2-UXR-005.png'), TINY_PNG);

    const content = `## Navigation

- Top nav links

### Mobile Menu

- Hamburger button screenshot: I2-UXR-005.png
`;

    const html = formatDiscoveryHtml(content, makeMetadata(), screenshotsDir);

    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain('alt="I2-UXR-005.png"');
    // Should NOT be in unmatched section since it's referenced
    expect(html).not.toContain('id="unmatched-screenshots"');
  });

  it('handles multiple screenshot references in one area', () => {
    writeFileSync(join(screenshotsDir, 'I1-UXR-001.png'), TINY_PNG);
    writeFileSync(join(screenshotsDir, 'I1-UXR-002.png'), TINY_PNG);

    const content = `## Navigation

- Logo: I1-UXR-001.png
- Menu: I1-UXR-002.png
`;

    const html = formatDiscoveryHtml(content, makeMetadata(), screenshotsDir);

    const imgMatches = html.match(/<img src="data:image\/png;base64,/g);
    expect(imgMatches).toHaveLength(2);
    expect(html).toContain('alt="I1-UXR-001.png"');
    expect(html).toContain('alt="I1-UXR-002.png"');
  });

  it('logs debug message when readdirSync throws in screenshot listing', () => {
    // Create the screenshots directory so existsSync returns true,
    // then make readdirSync throw via the mock trigger
    mkdirSync(screenshotsDir, { recursive: true });
    readdirSyncErrorPath = screenshotsDir;
    mockDebug.mockClear();

    try {
      // This should not throw — the catch returns [] and logs debug
      const html = formatDiscoveryHtml(
        '## Test Area\n- item one',
        makeMetadata(),
        screenshotsDir,
      );

      expect(html).toContain('Test Area');
      expect(mockDebug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read screenshots directory'),
      );
    } finally {
      readdirSyncErrorPath = null;
    }
  });
});
