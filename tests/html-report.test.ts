import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatHtmlReport, ReportMetadata, encodeScreenshotBase64 } from '../src/html-report.js';
import { UIAreaGroup } from '../src/consolidation.js';
import { Finding } from '../src/report.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'UXR-001',
    title: 'Button too small',
    uiArea: 'Navigation',
    severity: 'major',
    description: 'The submit button is too small on mobile',
    suggestion: 'Increase button size to 44px minimum',
    screenshot: 'UXR-001.png',
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<ReportMetadata> = {}): ReportMetadata {
  return {
    url: 'https://example.com',
    date: '2026-04-07',
    instanceCount: 3,
    roundCount: 2,
    ...overrides,
  };
}

describe('formatHtmlReport', () => {
  it('produces valid HTML document structure', () => {
    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [{ finding: makeFinding(), children: [] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('<title>UX Analysis Report</title>');
  });

  it('includes inline CSS styles', () => {
    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [{ finding: makeFinding(), children: [] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
    expect(html).toContain('font-family');
    // No external stylesheets
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it('renders metadata header with all fields', () => {
    const groups: UIAreaGroup[] = [];
    const metadata = makeMetadata({
      url: 'https://app.example.com/dashboard',
      date: '2026-04-07',
      instanceCount: 5,
      roundCount: 3,
    });

    const html = formatHtmlReport(groups, metadata);

    expect(html).toContain('https://app.example.com/dashboard');
    expect(html).toContain('2026-04-07');
    expect(html).toContain('5');
    expect(html).toContain('3');
    expect(html).toContain('class="metadata"');
  });

  it('renders table of contents with anchor links', () => {
    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [
          { finding: makeFinding({ id: 'UXR-001', title: 'Bad nav' }), children: [] },
          { finding: makeFinding({ id: 'UXR-002', title: 'Missing breadcrumb' }), children: [] },
        ],
      },
      {
        area: 'Forms',
        findings: [
          { finding: makeFinding({ id: 'UXR-003', title: 'No validation' }), children: [] },
        ],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    // TOC container
    expect(html).toContain('class="toc"');
    expect(html).toContain('Table of Contents');

    // Area links
    expect(html).toContain('href="#navigation"');
    expect(html).toContain('href="#forms"');

    // Finding links
    expect(html).toContain('href="#uxr-001"');
    expect(html).toContain('href="#uxr-002"');
    expect(html).toContain('href="#uxr-003"');

    // Link text
    expect(html).toContain('UXR-001: Bad nav');
    expect(html).toContain('UXR-003: No validation');
  });

  it('renders collapsible details/summary sections per UI area', () => {
    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [{ finding: makeFinding(), children: [] }],
      },
      {
        area: 'Forms',
        findings: [
          { finding: makeFinding({ id: 'UXR-002', uiArea: 'Forms' }), children: [] },
        ],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    // Each area is a <details> section
    expect(html).toContain('<details open id="navigation">');
    expect(html).toContain('<summary>Navigation (1 finding)</summary>');
    expect(html).toContain('<details open id="forms">');
    expect(html).toContain('<summary>Forms (1 finding)</summary>');
    expect(html).toContain('</details>');
  });

  it('uses correct severity colors', () => {
    const groups: UIAreaGroup[] = [
      {
        area: 'Test Area',
        findings: [
          { finding: makeFinding({ id: 'UXR-001', severity: 'critical' }), children: [] },
          { finding: makeFinding({ id: 'UXR-002', severity: 'major' }), children: [] },
          { finding: makeFinding({ id: 'UXR-003', severity: 'minor' }), children: [] },
          { finding: makeFinding({ id: 'UXR-004', severity: 'suggestion' }), children: [] },
        ],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    // Critical = red
    expect(html).toContain('background-color: #dc2626;');
    // Major = orange
    expect(html).toContain('background-color: #ea580c;');
    // Minor = yellow
    expect(html).toContain('background-color: #ca8a04;');
    // Suggestion = blue
    expect(html).toContain('background-color: #2563eb;');
  });

  it('renders finding content correctly', () => {
    const finding = makeFinding({
      id: 'UXR-010',
      title: 'Missing alt text',
      severity: 'minor',
      description: 'Images lack alt attributes',
      suggestion: 'Add descriptive alt text',
      screenshot: 'UXR-010.png',
    });

    const groups: UIAreaGroup[] = [
      {
        area: 'Accessibility',
        findings: [{ finding, children: [] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    expect(html).toContain('UXR-010: Missing alt text');
    expect(html).toContain('Images lack alt attributes');
    expect(html).toContain('Add descriptive alt text');
    expect(html).toContain('UXR-010.png');
    expect(html).toContain('id="uxr-010"');
  });

  it('renders child findings with child-finding class', () => {
    const parent = makeFinding({ id: 'UXR-001', title: 'Parent issue' });
    const child = makeFinding({ id: 'UXR-002', title: 'Child issue', severity: 'minor' });

    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [{ finding: parent, children: [{ finding: child, children: [] }] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    expect(html).toContain('class="child-finding"');
    expect(html).toContain('UXR-001: Parent issue');
    expect(html).toContain('UXR-002: Child issue');

    // Parent uses h3, child uses h4
    expect(html).toContain('<h3>UXR-001: Parent issue</h3>');
    expect(html).toContain('<h4>UXR-002: Child issue</h4>');
  });

  it('handles empty groups array', () => {
    const html = formatHtmlReport([], makeMetadata());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('UX Analysis Report');
    expect(html).toContain('class="toc"');
    // No details sections
    expect(html).not.toContain('<details');
  });

  it('escapes HTML special characters in finding content', () => {
    const finding = makeFinding({
      title: 'Use <button> instead of <div>',
      description: 'The element uses <div onclick="..."> which is not accessible',
      suggestion: 'Replace with <button> & proper ARIA',
    });

    const groups: UIAreaGroup[] = [
      {
        area: 'Accessibility',
        findings: [{ finding, children: [] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    // Special chars must be escaped
    expect(html).toContain('&lt;button&gt;');
    expect(html).toContain('&lt;div&gt;');
    expect(html).toContain('&amp; proper ARIA');
    expect(html).toContain('&quot;...&quot;');
    // Raw chars must NOT appear in the escaped content
    expect(html).not.toContain('onclick="..."');
  });

  it('pluralizes finding count in summary correctly', () => {
    const groups: UIAreaGroup[] = [
      {
        area: 'Single',
        findings: [{ finding: makeFinding(), children: [] }],
      },
      {
        area: 'Multiple',
        findings: [
          { finding: makeFinding({ id: 'UXR-001' }), children: [] },
          { finding: makeFinding({ id: 'UXR-002' }), children: [] },
          { finding: makeFinding({ id: 'UXR-003' }), children: [] },
        ],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    expect(html).toContain('Single (1 finding)');
    expect(html).toContain('Multiple (3 findings)');
  });

  it('renders multiple child findings under one parent', () => {
    const parent = makeFinding({ id: 'UXR-001', title: 'Parent' });
    const child1 = makeFinding({ id: 'UXR-002', title: 'Child A' });
    const child2 = makeFinding({ id: 'UXR-003', title: 'Child B' });

    const groups: UIAreaGroup[] = [
      {
        area: 'Area',
        findings: [{ finding: parent, children: [{ finding: child1, children: [] }, { finding: child2, children: [] }] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    const childFindingMatches = html.match(/class="child-finding"/g);
    expect(childFindingMatches).toHaveLength(2);
    expect(html).toContain('Child A');
    expect(html).toContain('Child B');
  });

  it('wraps children in collapsible nested-findings details section', () => {
    const parent = makeFinding({ id: 'UXR-001', title: 'Parent issue' });
    const child = makeFinding({ id: 'UXR-002', title: 'Child issue' });

    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [{ finding: parent, children: [{ finding: child, children: [] }] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    expect(html).toContain('class="nested-findings"');
    expect(html).toContain('<summary>1 sub-finding</summary>');
  });

  it('pluralizes sub-finding count in nested details summary', () => {
    const parent = makeFinding({ id: 'UXR-001', title: 'Parent' });
    const child1 = makeFinding({ id: 'UXR-002', title: 'Child A' });
    const child2 = makeFinding({ id: 'UXR-003', title: 'Child B' });

    const groups: UIAreaGroup[] = [
      {
        area: 'Area',
        findings: [{ finding: parent, children: [{ finding: child1, children: [] }, { finding: child2, children: [] }] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    expect(html).toContain('<summary>2 sub-findings</summary>');
  });

  it('renders multi-level nesting (grandchildren) with increasing heading levels', () => {
    const grandchild = makeFinding({ id: 'UXR-003', title: 'Component issue' });
    const child = makeFinding({ id: 'UXR-002', title: 'Section issue' });
    const parent = makeFinding({ id: 'UXR-001', title: 'Page issue' });

    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [{
          finding: parent,
          children: [{
            finding: child,
            children: [{ finding: grandchild, children: [] }],
          }],
        }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    // Parent h3, child h4, grandchild h5
    expect(html).toContain('<h3>UXR-001: Page issue</h3>');
    expect(html).toContain('<h4>UXR-002: Section issue</h4>');
    expect(html).toContain('<h5>UXR-003: Component issue</h5>');

    // Nested child-finding divs at each level
    const childFindingMatches = html.match(/class="child-finding"/g);
    expect(childFindingMatches).toHaveLength(2);

    // Nested collapsible sections at each parent level
    const nestedMatches = html.match(/class="nested-findings"/g);
    expect(nestedMatches).toHaveLength(2);
  });

  it('caps heading level at h6 for very deep nesting in HTML', () => {
    const l4 = makeFinding({ id: 'UXR-005', title: 'L4' });
    const l3 = makeFinding({ id: 'UXR-004', title: 'L3' });
    const l2 = makeFinding({ id: 'UXR-003', title: 'L2' });
    const l1 = makeFinding({ id: 'UXR-002', title: 'L1' });
    const l0 = makeFinding({ id: 'UXR-001', title: 'L0' });

    const groups: UIAreaGroup[] = [
      {
        area: 'Deep',
        findings: [{
          finding: l0,
          children: [{
            finding: l1,
            children: [{
              finding: l2,
              children: [{
                finding: l3,
                children: [{ finding: l4, children: [] }],
              }],
            }],
          }],
        }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    // h3 -> h4 -> h5 -> h6 -> h6 (capped)
    expect(html).toContain('<h3>UXR-001: L0</h3>');
    expect(html).toContain('<h4>UXR-002: L1</h4>');
    expect(html).toContain('<h5>UXR-003: L2</h5>');
    expect(html).toContain('<h6>UXR-004: L3</h6>');
    expect(html).toContain('<h6>UXR-005: L4</h6>');

    // No h7 tags
    expect(html).not.toContain('<h7');
  });

  it('renders leaf findings without nested-findings wrapper', () => {
    const groups: UIAreaGroup[] = [
      {
        area: 'Simple',
        findings: [{ finding: makeFinding({ id: 'UXR-001', title: 'Leaf' }), children: [] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    expect(html).not.toContain('class="nested-findings"');
    expect(html).not.toContain('sub-finding');
  });

  it('includes nested-findings CSS in styles', () => {
    const html = formatHtmlReport([], makeMetadata());

    expect(html).toContain('.nested-findings');
  });

  it('renders screenshot text when no screenshotsDir is provided', () => {
    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [{ finding: makeFinding({ screenshot: 'UXR-001.png' }), children: [] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    // Without screenshotsDir, screenshot field is rendered as text
    expect(html).toContain('UXR-001.png');
    expect(html).not.toContain('<img');
  });
});

describe('screenshot base64 embedding', () => {
  const screenshotsDir = join(process.cwd(), '.uxreview-html-test-screenshots');
  // Minimal valid 1x1 red PNG
  const PNG_HEADER = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  beforeEach(() => {
    mkdirSync(screenshotsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(screenshotsDir)) {
      rmSync(screenshotsDir, { recursive: true, force: true });
    }
  });

  it('encodeScreenshotBase64 returns data URI for existing file', () => {
    writeFileSync(join(screenshotsDir, 'UXR-001.png'), PNG_HEADER);

    const result = encodeScreenshotBase64(screenshotsDir, 'UXR-001.png');

    expect(result).not.toBeNull();
    expect(result).toMatch(/^data:image\/png;base64,/);
    // Verify round-trip: decode the base64 and check it matches original
    const base64Part = result!.replace('data:image/png;base64,', '');
    const decoded = Buffer.from(base64Part, 'base64');
    expect(decoded).toEqual(PNG_HEADER);
  });

  it('encodeScreenshotBase64 returns null for missing file', () => {
    const result = encodeScreenshotBase64(screenshotsDir, 'nonexistent.png');

    expect(result).toBeNull();
  });

  it('embeds screenshot as base64 img tag when screenshotsDir is provided', () => {
    writeFileSync(join(screenshotsDir, 'UXR-001.png'), PNG_HEADER);

    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [{ finding: makeFinding({ screenshot: 'UXR-001.png' }), children: [] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata(), screenshotsDir);

    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain('alt="UXR-001.png"');
    expect(html).toContain('class="screenshot"');
  });

  it('embeds multiple screenshots for a finding with comma-separated refs', () => {
    writeFileSync(join(screenshotsDir, 'UXR-001.png'), PNG_HEADER);
    writeFileSync(join(screenshotsDir, 'UXR-001-a.png'), PNG_HEADER);

    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [
          { finding: makeFinding({ screenshot: 'UXR-001.png, UXR-001-a.png' }), children: [] },
        ],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata(), screenshotsDir);

    const imgMatches = html.match(/<img src="data:image\/png;base64,/g);
    expect(imgMatches).toHaveLength(2);
    expect(html).toContain('alt="UXR-001.png"');
    expect(html).toContain('alt="UXR-001-a.png"');
  });

  it('skips missing screenshots gracefully without erroring', () => {
    // Only create one of two referenced screenshots
    writeFileSync(join(screenshotsDir, 'UXR-001.png'), PNG_HEADER);

    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [
          { finding: makeFinding({ screenshot: 'UXR-001.png, UXR-001-a.png' }), children: [] },
        ],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata(), screenshotsDir);

    // Only the existing screenshot is embedded
    const imgMatches = html.match(/<img src="data:image\/png;base64,/g);
    expect(imgMatches).toHaveLength(1);
    expect(html).toContain('alt="UXR-001.png"');
    // Missing file is not embedded
    expect(html).not.toContain('alt="UXR-001-a.png"');
  });

  it('falls back to text when all screenshots are missing', () => {
    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [
          { finding: makeFinding({ screenshot: 'missing.png' }), children: [] },
        ],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata(), screenshotsDir);

    // No img tags — falls back to plain text
    expect(html).not.toContain('<img');
    expect(html).toContain('missing.png');
  });

  it('embeds screenshots for child findings', () => {
    writeFileSync(join(screenshotsDir, 'UXR-001.png'), PNG_HEADER);
    writeFileSync(join(screenshotsDir, 'UXR-002.png'), PNG_HEADER);

    const parent = makeFinding({ id: 'UXR-001', screenshot: 'UXR-001.png' });
    const child = makeFinding({ id: 'UXR-002', screenshot: 'UXR-002.png' });

    const groups: UIAreaGroup[] = [
      {
        area: 'Navigation',
        findings: [{ finding: parent, children: [{ finding: child, children: [] }] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata(), screenshotsDir);

    const imgMatches = html.match(/<img src="data:image\/png;base64,/g);
    expect(imgMatches).toHaveLength(2);
    expect(html).toContain('alt="UXR-001.png"');
    expect(html).toContain('alt="UXR-002.png"');
  });

  it('includes screenshot CSS class in styles', () => {
    const html = formatHtmlReport([], makeMetadata());

    expect(html).toContain('.screenshot');
    expect(html).toContain('max-width: 100%');
  });
});
