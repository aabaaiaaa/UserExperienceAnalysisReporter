import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  Finding,
  InstanceReport,
  Severity,
  buildFindingId,
  buildScreenshotRef,
  formatFinding,
  formatInstanceReport,
  parseInstanceReport,
  writeInstanceReport,
  readInstanceReport,
  readReportContent,
  appendFinding,
  buildReportInstructions,
} from '../src/report.js';

// Use a test-specific temp directory
const TEST_TEMP_DIR = resolve('.uxreview-temp-report-test');

// Mock file-manager to use our test directory
vi.mock('../src/file-manager.js', () => ({
  getInstancePaths: (n: number) => {
    const dir = join(TEST_TEMP_DIR, `instance-${n}`);
    return {
      dir,
      discovery: join(dir, 'discovery.md'),
      checkpoint: join(dir, 'checkpoint.json'),
      report: join(dir, 'report.md'),
      screenshots: join(dir, 'screenshots'),
    };
  },
}));

function ensureInstanceDir(instanceNumber: number): string {
  const dir = join(TEST_TEMP_DIR, `instance-${instanceNumber}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SAMPLE_FINDING_1: Finding = {
  id: 'I1-UXR-001',
  title: 'Inconsistent hover states on main nav items',
  uiArea: 'Navigation',
  severity: 'major',
  description: 'The main navigation bar items have different hover effects — some use underline, others use background color change.',
  suggestion: 'Standardize all nav item hover states to use the same visual treatment (e.g., subtle background highlight).',
  screenshot: 'I1-UXR-001.png',
};

const SAMPLE_FINDING_2: Finding = {
  id: 'I1-UXR-002',
  title: 'Missing form validation feedback on email field',
  uiArea: 'Settings Page',
  severity: 'critical',
  description: 'The email field in the settings form accepts invalid email addresses without showing any error message.',
  suggestion: 'Add inline validation that shows an error message below the field when the email format is invalid.',
  screenshot: 'I1-UXR-002.png',
};

const SAMPLE_FINDING_3: Finding = {
  id: 'I1-UXR-003',
  title: 'Low contrast text in footer links',
  uiArea: 'Footer',
  severity: 'minor',
  description: 'Footer link text is light gray (#999) on a white background, resulting in a contrast ratio of only 2.8:1.',
  suggestion: 'Darken footer link text to at least #767676 to meet WCAG AA minimum contrast ratio of 4.5:1.',
  screenshot: 'I1-UXR-003.png',
};

const SAMPLE_REPORT: InstanceReport = {
  instanceNumber: 1,
  findings: [SAMPLE_FINDING_1, SAMPLE_FINDING_2, SAMPLE_FINDING_3],
};

beforeEach(() => {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_TEMP_DIR)) {
    rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  }
});

describe('buildFindingId', () => {
  it('builds an ID with zero-padded finding number', () => {
    expect(buildFindingId(1, 1)).toBe('I1-UXR-001');
    expect(buildFindingId(1, 12)).toBe('I1-UXR-012');
    expect(buildFindingId(1, 123)).toBe('I1-UXR-123');
  });

  it('uses the correct instance number', () => {
    expect(buildFindingId(2, 1)).toBe('I2-UXR-001');
    expect(buildFindingId(5, 3)).toBe('I5-UXR-003');
  });

  it('handles large finding numbers', () => {
    expect(buildFindingId(1, 1000)).toBe('I1-UXR-1000');
  });
});

describe('buildScreenshotRef', () => {
  it('appends .png to the finding ID', () => {
    expect(buildScreenshotRef('I1-UXR-001')).toBe('I1-UXR-001.png');
    expect(buildScreenshotRef('I3-UXR-015')).toBe('I3-UXR-015.png');
  });
});

describe('formatFinding', () => {
  it('formats a finding with all fields', () => {
    const result = formatFinding(SAMPLE_FINDING_1);

    expect(result).toContain('## I1-UXR-001: Inconsistent hover states on main nav items');
    expect(result).toContain('- **UI Area**: Navigation');
    expect(result).toContain('- **Severity**: major');
    expect(result).toContain('- **Description**: The main navigation bar items have different hover effects');
    expect(result).toContain('- **Suggestion**: Standardize all nav item hover states');
    expect(result).toContain('- **Screenshot**: I1-UXR-001.png');
  });

  it('formats all severity levels correctly', () => {
    const severities: Severity[] = ['critical', 'major', 'minor', 'suggestion'];
    for (const severity of severities) {
      const finding: Finding = { ...SAMPLE_FINDING_1, severity };
      const result = formatFinding(finding);
      expect(result).toContain(`- **Severity**: ${severity}`);
    }
  });

  it('uses the finding ID as the heading prefix', () => {
    const finding: Finding = { ...SAMPLE_FINDING_1, id: 'I3-UXR-042' };
    const result = formatFinding(finding);
    expect(result).toContain('## I3-UXR-042:');
  });
});

describe('formatInstanceReport', () => {
  it('formats a report with header and all findings', () => {
    const result = formatInstanceReport(SAMPLE_REPORT);

    expect(result).toContain('# UX Report - Instance 1');
    expect(result).toContain('## I1-UXR-001: Inconsistent hover states');
    expect(result).toContain('## I1-UXR-002: Missing form validation feedback');
    expect(result).toContain('## I1-UXR-003: Low contrast text in footer links');
  });

  it('uses the correct instance number in the header', () => {
    const report: InstanceReport = { instanceNumber: 3, findings: [SAMPLE_FINDING_1] };
    const result = formatInstanceReport(report);
    expect(result).toContain('# UX Report - Instance 3');
  });

  it('formats an empty findings list with just the header', () => {
    const report: InstanceReport = { instanceNumber: 1, findings: [] };
    const result = formatInstanceReport(report);
    expect(result).toContain('# UX Report - Instance 1');
    expect(result).not.toContain('## I');
  });

  it('ends with a newline', () => {
    const result = formatInstanceReport(SAMPLE_REPORT);
    expect(result.endsWith('\n')).toBe(true);
  });
});

describe('parseInstanceReport', () => {
  it('parses a formatted report back to structured data', () => {
    const formatted = formatInstanceReport(SAMPLE_REPORT);
    const parsed = parseInstanceReport(formatted, 1);

    expect(parsed).not.toBeNull();
    expect(parsed!.instanceNumber).toBe(1);
    expect(parsed!.findings).toHaveLength(3);
  });

  it('round-trips finding fields correctly', () => {
    const report: InstanceReport = { instanceNumber: 1, findings: [SAMPLE_FINDING_1] };
    const formatted = formatInstanceReport(report);
    const parsed = parseInstanceReport(formatted, 1);

    const finding = parsed!.findings[0];
    expect(finding.id).toBe('I1-UXR-001');
    expect(finding.title).toBe('Inconsistent hover states on main nav items');
    expect(finding.uiArea).toBe('Navigation');
    expect(finding.severity).toBe('major');
    expect(finding.description).toBe(SAMPLE_FINDING_1.description);
    expect(finding.suggestion).toBe(SAMPLE_FINDING_1.suggestion);
    expect(finding.screenshot).toBe('I1-UXR-001.png');
  });

  it('round-trips all severity levels', () => {
    const severities: Severity[] = ['critical', 'major', 'minor', 'suggestion'];
    for (const severity of severities) {
      const report: InstanceReport = {
        instanceNumber: 1,
        findings: [{ ...SAMPLE_FINDING_1, severity }],
      };
      const formatted = formatInstanceReport(report);
      const parsed = parseInstanceReport(formatted, 1);
      expect(parsed!.findings[0].severity).toBe(severity);
    }
  });

  it('parses multiple findings', () => {
    const formatted = formatInstanceReport(SAMPLE_REPORT);
    const parsed = parseInstanceReport(formatted, 1);

    expect(parsed!.findings).toHaveLength(3);
    expect(parsed!.findings[0].id).toBe('I1-UXR-001');
    expect(parsed!.findings[1].id).toBe('I1-UXR-002');
    expect(parsed!.findings[2].id).toBe('I1-UXR-003');
  });

  it('returns null for empty content', () => {
    expect(parseInstanceReport('', 1)).toBeNull();
    expect(parseInstanceReport('   ', 1)).toBeNull();
  });

  it('returns null for content without finding headers', () => {
    expect(parseInstanceReport('# Just a title\nNo findings here.', 1)).toBeNull();
  });

  it('defaults severity to suggestion for invalid values', () => {
    const content = `# UX Report - Instance 1

## I1-UXR-001: Test finding

- **UI Area**: Nav
- **Severity**: invalid-severity
- **Description**: Test
- **Suggestion**: Fix it
- **Screenshot**: I1-UXR-001.png
`;
    const parsed = parseInstanceReport(content, 1);
    expect(parsed!.findings[0].severity).toBe('suggestion');
  });

  it('handles missing fields gracefully', () => {
    const content = `# UX Report - Instance 1

## I1-UXR-001: Test finding with missing fields

- **UI Area**: Navigation
`;
    const parsed = parseInstanceReport(content, 1);
    expect(parsed).not.toBeNull();
    expect(parsed!.findings[0].id).toBe('I1-UXR-001');
    expect(parsed!.findings[0].title).toBe('Test finding with missing fields');
    expect(parsed!.findings[0].uiArea).toBe('Navigation');
    expect(parsed!.findings[0].severity).toBe('suggestion');
    expect(parsed!.findings[0].description).toBe('');
    expect(parsed!.findings[0].suggestion).toBe('');
    expect(parsed!.findings[0].screenshot).toBe('');
  });
});

describe('writeInstanceReport', () => {
  it('writes a report to the instance directory', () => {
    ensureInstanceDir(1);

    writeInstanceReport(1, SAMPLE_REPORT);

    const path = join(TEST_TEMP_DIR, 'instance-1', 'report.md');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('# UX Report - Instance 1');
    expect(content).toContain('## I1-UXR-001:');
    expect(content).toContain('## I1-UXR-002:');
    expect(content).toContain('## I1-UXR-003:');
  });

  it('overwrites existing content', () => {
    ensureInstanceDir(1);

    writeInstanceReport(1, SAMPLE_REPORT);

    const newReport: InstanceReport = {
      instanceNumber: 1,
      findings: [SAMPLE_FINDING_1],
    };
    writeInstanceReport(1, newReport);

    const path = join(TEST_TEMP_DIR, 'instance-1', 'report.md');
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('## I1-UXR-001:');
    expect(content).not.toContain('## I1-UXR-002:');
  });
});

describe('readInstanceReport', () => {
  it('reads and parses an existing report', () => {
    ensureInstanceDir(1);
    writeInstanceReport(1, SAMPLE_REPORT);

    const result = readInstanceReport(1);

    expect(result).not.toBeNull();
    expect(result!.instanceNumber).toBe(1);
    expect(result!.findings).toHaveLength(3);
    expect(result!.findings[0].id).toBe('I1-UXR-001');
  });

  it('returns null when no report file exists', () => {
    ensureInstanceDir(5);
    const result = readInstanceReport(5);
    expect(result).toBeNull();
  });

  it('returns null for invalid content', () => {
    const dir = ensureInstanceDir(3);
    writeFileSync(join(dir, 'report.md'), 'not a valid report', 'utf-8');
    const result = readInstanceReport(3);
    expect(result).toBeNull();
  });

});

describe('readReportContent', () => {
  it('reads raw content from the report file', () => {
    ensureInstanceDir(1);
    writeInstanceReport(1, SAMPLE_REPORT);

    const content = readReportContent(1);
    expect(content).not.toBeNull();
    expect(content).toContain('# UX Report - Instance 1');
    expect(content).toContain('I1-UXR-001');
  });

  it('returns null when file does not exist', () => {
    ensureInstanceDir(2);
    const content = readReportContent(2);
    expect(content).toBeNull();
  });
});

describe('appendFinding', () => {
  it('creates the file with header when no file exists', () => {
    ensureInstanceDir(1);

    appendFinding(1, SAMPLE_FINDING_1);

    const content = readReportContent(1);
    expect(content).not.toBeNull();
    expect(content).toContain('# UX Report - Instance 1');
    expect(content).toContain('## I1-UXR-001:');
    expect(content).toContain('- **Severity**: major');
  });

  it('appends a second finding to an existing report', () => {
    ensureInstanceDir(1);

    appendFinding(1, SAMPLE_FINDING_1);
    appendFinding(1, SAMPLE_FINDING_2);

    const content = readReportContent(1)!;
    expect(content).toContain('## I1-UXR-001:');
    expect(content).toContain('## I1-UXR-002:');
    expect(content).toContain('- **Severity**: major');
    expect(content).toContain('- **Severity**: critical');
  });

  it('preserves first finding after appending second', () => {
    ensureInstanceDir(1);

    appendFinding(1, SAMPLE_FINDING_1);
    appendFinding(1, SAMPLE_FINDING_2);

    const report = readInstanceReport(1);
    expect(report).not.toBeNull();
    expect(report!.findings).toHaveLength(2);
    expect(report!.findings[0].id).toBe('I1-UXR-001');
    expect(report!.findings[0].title).toBe('Inconsistent hover states on main nav items');
    expect(report!.findings[1].id).toBe('I1-UXR-002');
    expect(report!.findings[1].title).toBe('Missing form validation feedback on email field');
  });

  it('accumulates three findings correctly', () => {
    ensureInstanceDir(1);

    appendFinding(1, SAMPLE_FINDING_1);
    appendFinding(1, SAMPLE_FINDING_2);
    appendFinding(1, SAMPLE_FINDING_3);

    const report = readInstanceReport(1);
    expect(report).not.toBeNull();
    expect(report!.findings).toHaveLength(3);
    expect(report!.findings[0].id).toBe('I1-UXR-001');
    expect(report!.findings[1].id).toBe('I1-UXR-002');
    expect(report!.findings[2].id).toBe('I1-UXR-003');
  });
});

describe('buildReportInstructions', () => {
  it('includes the report file path', () => {
    const instructions = buildReportInstructions(1, '/tmp/instance-1/report.md');
    expect(instructions).toContain('/tmp/instance-1/report.md');
  });

  it('includes the finding format example with correct instance ID', () => {
    const instructions = buildReportInstructions(3, '/tmp/report.md');
    expect(instructions).toContain('I3-UXR-NNN');
    expect(instructions).toContain('I3-UXR-001');
  });

  it('includes all required finding fields in the format example', () => {
    const instructions = buildReportInstructions(1, '/tmp/report.md');
    expect(instructions).toContain('**UI Area**');
    expect(instructions).toContain('**Severity**');
    expect(instructions).toContain('**Description**');
    expect(instructions).toContain('**Suggestion**');
    expect(instructions).toContain('**Screenshot**');
  });

  it('includes all severity options', () => {
    const instructions = buildReportInstructions(1, '/tmp/report.md');
    expect(instructions).toContain('critical');
    expect(instructions).toContain('major');
    expect(instructions).toContain('minor');
    expect(instructions).toContain('suggestion');
  });

  it('includes report header instruction', () => {
    const instructions = buildReportInstructions(2, '/tmp/report.md');
    expect(instructions).toContain('# UX Report - Instance 2');
  });

  it('instructs sequential numbering starting from 001', () => {
    const instructions = buildReportInstructions(1, '/tmp/report.md');
    expect(instructions).toContain('I1-UXR-001');
    expect(instructions).toContain('sequentially');
  });

  it('instructs not to overwrite previous findings', () => {
    const instructions = buildReportInstructions(1, '/tmp/report.md');
    expect(instructions).toContain('Never overwrite previous findings');
  });

  it('includes multi-screenshot reference format', () => {
    const instructions = buildReportInstructions(1, '/tmp/report.md');
    expect(instructions).toContain('-a.png');
    expect(instructions).toContain('-b.png');
    expect(instructions).toContain('comma-separated');
  });
});

describe('verification: mock instance run with instance-scoped IDs', () => {
  it('simulates a full instance run producing a report with properly formatted findings', () => {
    ensureInstanceDir(1);

    // Simulate what a Claude instance would write during analysis
    const findings: Finding[] = [
      {
        id: buildFindingId(1, 1),
        title: 'Button styles inconsistent across dashboard cards',
        uiArea: 'Dashboard',
        severity: 'major',
        description: 'The action buttons on dashboard cards use three different color schemes — blue, green, and gray — for similar-level actions.',
        suggestion: 'Standardize card action buttons to use the primary blue color for all primary actions.',
        screenshot: buildScreenshotRef(buildFindingId(1, 1)),
      },
      {
        id: buildFindingId(1, 2),
        title: 'No validation error shown for empty required fields',
        uiArea: 'Settings Form',
        severity: 'critical',
        description: 'Submitting the settings form with empty required fields results in a silent failure — no error messages are displayed.',
        suggestion: 'Add inline validation messages below each required field that highlight when the field is empty on submit.',
        screenshot: buildScreenshotRef(buildFindingId(1, 2)),
      },
      {
        id: buildFindingId(1, 3),
        title: 'Dead-end page after deleting last item',
        uiArea: 'Item List',
        severity: 'minor',
        description: 'After deleting the last item in the list, the page shows an empty state with no navigation options to return to the dashboard.',
        suggestion: 'Add a "Back to Dashboard" link or button on the empty state, and consider showing a "Create new item" CTA.',
        screenshot: buildScreenshotRef(buildFindingId(1, 3)),
      },
    ];

    // Write findings one at a time as Claude would during analysis
    for (const finding of findings) {
      appendFinding(1, finding);
    }

    // Verification: report contains properly formatted findings with instance-scoped IDs
    const report = readInstanceReport(1);
    expect(report).not.toBeNull();
    expect(report!.instanceNumber).toBe(1);
    expect(report!.findings).toHaveLength(3);

    // Check instance-scoped IDs are correctly formatted
    expect(report!.findings[0].id).toBe('I1-UXR-001');
    expect(report!.findings[1].id).toBe('I1-UXR-002');
    expect(report!.findings[2].id).toBe('I1-UXR-003');

    // Check all required fields are present
    for (const finding of report!.findings) {
      expect(finding.id).toMatch(/^I1-UXR-\d{3}$/);
      expect(finding.title).toBeTruthy();
      expect(finding.uiArea).toBeTruthy();
      expect(['critical', 'major', 'minor', 'suggestion']).toContain(finding.severity);
      expect(finding.description).toBeTruthy();
      expect(finding.suggestion).toBeTruthy();
      expect(finding.screenshot).toBeTruthy();
    }

    // Check screenshot references use the correct ID format
    expect(report!.findings[0].screenshot).toBe('I1-UXR-001.png');
    expect(report!.findings[1].screenshot).toBe('I1-UXR-002.png');
    expect(report!.findings[2].screenshot).toBe('I1-UXR-003.png');

    // Verify raw markdown content has correct structure
    const rawContent = readReportContent(1)!;
    expect(rawContent).toContain('# UX Report - Instance 1');
    expect(rawContent).toContain('## I1-UXR-001:');
    expect(rawContent).toContain('## I1-UXR-002:');
    expect(rawContent).toContain('## I1-UXR-003:');
    expect(rawContent).toContain('- **Screenshot**: I1-UXR-001.png');
    expect(rawContent).toContain('- **Screenshot**: I1-UXR-002.png');
    expect(rawContent).toContain('- **Screenshot**: I1-UXR-003.png');
  });

  it('simulates a second instance with different instance-scoped IDs', () => {
    ensureInstanceDir(2);

    const findings: Finding[] = [
      {
        id: buildFindingId(2, 1),
        title: 'Poor contrast on sidebar links',
        uiArea: 'Sidebar Navigation',
        severity: 'minor',
        description: 'Sidebar links have a contrast ratio below 4.5:1.',
        suggestion: 'Increase text darkness for sidebar links.',
        screenshot: buildScreenshotRef(buildFindingId(2, 1)),
      },
      {
        id: buildFindingId(2, 2),
        title: 'Inconsistent terminology in action buttons',
        uiArea: 'Forms',
        severity: 'suggestion',
        description: 'Some forms use "Save", others use "Submit", and one uses "Confirm" for the same type of action.',
        suggestion: 'Standardize to "Save" for data persistence actions across all forms.',
        screenshot: buildScreenshotRef(buildFindingId(2, 2)),
      },
    ];

    for (const finding of findings) {
      appendFinding(2, finding);
    }

    const report = readInstanceReport(2);
    expect(report).not.toBeNull();
    expect(report!.instanceNumber).toBe(2);
    expect(report!.findings).toHaveLength(2);

    // Instance 2 IDs use I2 prefix
    expect(report!.findings[0].id).toBe('I2-UXR-001');
    expect(report!.findings[1].id).toBe('I2-UXR-002');

    // Screenshot references use instance 2 IDs
    expect(report!.findings[0].screenshot).toBe('I2-UXR-001.png');
    expect(report!.findings[1].screenshot).toBe('I2-UXR-002.png');
  });

  it('verifies IDs from different instances do not collide', () => {
    ensureInstanceDir(1);
    ensureInstanceDir(2);

    // Instance 1 findings
    appendFinding(1, {
      id: buildFindingId(1, 1),
      title: 'Finding from instance 1',
      uiArea: 'Dashboard',
      severity: 'major',
      description: 'Issue found by instance 1',
      suggestion: 'Fix from instance 1',
      screenshot: buildScreenshotRef(buildFindingId(1, 1)),
    });

    // Instance 2 findings — same finding number, different instance
    appendFinding(2, {
      id: buildFindingId(2, 1),
      title: 'Finding from instance 2',
      uiArea: 'Settings',
      severity: 'minor',
      description: 'Issue found by instance 2',
      suggestion: 'Fix from instance 2',
      screenshot: buildScreenshotRef(buildFindingId(2, 1)),
    });

    const report1 = readInstanceReport(1);
    const report2 = readInstanceReport(2);

    // IDs are unique across instances
    expect(report1!.findings[0].id).toBe('I1-UXR-001');
    expect(report2!.findings[0].id).toBe('I2-UXR-001');
    expect(report1!.findings[0].id).not.toBe(report2!.findings[0].id);

    // Screenshot references are unique across instances
    expect(report1!.findings[0].screenshot).toBe('I1-UXR-001.png');
    expect(report2!.findings[0].screenshot).toBe('I2-UXR-001.png');
    expect(report1!.findings[0].screenshot).not.toBe(report2!.findings[0].screenshot);
  });
});
