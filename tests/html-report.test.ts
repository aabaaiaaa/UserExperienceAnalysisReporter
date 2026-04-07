import { describe, it, expect } from 'vitest';
import { formatHtmlReport, ReportMetadata } from '../src/html-report.js';
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
        findings: [{ finding: parent, children: [child] }],
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
        findings: [{ finding: parent, children: [child1, child2] }],
      },
    ];

    const html = formatHtmlReport(groups, makeMetadata());

    const childFindingMatches = html.match(/class="child-finding"/g);
    expect(childFindingMatches).toHaveLength(2);
    expect(html).toContain('Child A');
    expect(html).toContain('Child B');
  });
});
