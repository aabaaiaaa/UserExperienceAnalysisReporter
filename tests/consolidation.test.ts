import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDeduplicationPrompt,
  parseDeduplicationResponse,
  mergeDuplicateGroup,
  applyDeduplication,
  collectFindings,
  detectDuplicates,
  consolidateReports,
  DuplicateGroup,
} from '../src/consolidation.js';
import { Finding, InstanceReport } from '../src/report.js';

// Mock the claude-cli module
vi.mock('../src/claude-cli.js', () => ({
  runClaude: vi.fn(),
}));

// Mock the report module's readInstanceReport
vi.mock('../src/report.js', async () => {
  const actual = await vi.importActual<typeof import('../src/report.js')>('../src/report.js');
  return {
    ...actual,
    readInstanceReport: vi.fn(),
  };
});

import { runClaude } from '../src/claude-cli.js';
import { readInstanceReport } from '../src/report.js';

const mockedRunClaude = vi.mocked(runClaude);
const mockedReadInstanceReport = vi.mocked(readInstanceReport);

// ---- Test data helpers ----

function makeFinding(overrides: Partial<Finding> & { id: string }): Finding {
  return {
    title: 'Test finding',
    uiArea: 'Navigation',
    severity: 'minor',
    description: 'A test finding description.',
    suggestion: 'Fix it.',
    screenshot: `${overrides.id}.png`,
    ...overrides,
  };
}

// ---- Tests ----

describe('buildDeduplicationPrompt', () => {
  it('includes all finding details in the prompt', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'I1-UXR-001', title: 'Bad contrast', uiArea: 'Header', description: 'Text is hard to read' }),
      makeFinding({ id: 'I2-UXR-001', title: 'Poor contrast', uiArea: 'Header', description: 'Contrast is too low' }),
    ];

    const prompt = buildDeduplicationPrompt(findings);

    expect(prompt).toContain('I1-UXR-001');
    expect(prompt).toContain('I2-UXR-001');
    expect(prompt).toContain('Bad contrast');
    expect(prompt).toContain('Poor contrast');
    expect(prompt).toContain('Header');
    expect(prompt).toContain('Text is hard to read');
    expect(prompt).toContain('Contrast is too low');
    expect(prompt).toContain('DUPLICATE_GROUP');
    expect(prompt).toContain('NO_DUPLICATES');
    expect(prompt).toContain('keep findings SEPARATE');
  });
});

describe('parseDeduplicationResponse', () => {
  it('returns empty array for NO_DUPLICATES', () => {
    const groups = parseDeduplicationResponse('NO_DUPLICATES');
    expect(groups).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    const groups = parseDeduplicationResponse('');
    expect(groups).toEqual([]);
  });

  it('parses a single duplicate group with 2 IDs', () => {
    const groups = parseDeduplicationResponse('DUPLICATE_GROUP: I1-UXR-001, I2-UXR-003');
    expect(groups).toEqual([{ findingIds: ['I1-UXR-001', 'I2-UXR-003'] }]);
  });

  it('parses a single duplicate group with 3 IDs', () => {
    const groups = parseDeduplicationResponse('DUPLICATE_GROUP: I1-UXR-001, I2-UXR-003, I3-UXR-002');
    expect(groups).toEqual([
      { findingIds: ['I1-UXR-001', 'I2-UXR-003', 'I3-UXR-002'] },
    ]);
  });

  it('parses multiple duplicate groups', () => {
    const response = `DUPLICATE_GROUP: I1-UXR-001, I2-UXR-003
DUPLICATE_GROUP: I1-UXR-005, I3-UXR-002`;

    const groups = parseDeduplicationResponse(response);
    expect(groups).toEqual([
      { findingIds: ['I1-UXR-001', 'I2-UXR-003'] },
      { findingIds: ['I1-UXR-005', 'I3-UXR-002'] },
    ]);
  });

  it('ignores lines that do not match the expected format', () => {
    const response = `Some random text
DUPLICATE_GROUP: I1-UXR-001, I2-UXR-003
Another random line`;

    const groups = parseDeduplicationResponse(response);
    expect(groups).toEqual([{ findingIds: ['I1-UXR-001', 'I2-UXR-003'] }]);
  });

  it('ignores groups with fewer than 2 IDs', () => {
    const groups = parseDeduplicationResponse('DUPLICATE_GROUP: I1-UXR-001');
    expect(groups).toEqual([]);
  });
});

describe('mergeDuplicateGroup', () => {
  it('throws for an empty group', () => {
    expect(() => mergeDuplicateGroup([])).toThrow('Cannot merge an empty group');
  });

  it('returns a copy for a single finding', () => {
    const finding = makeFinding({ id: 'I1-UXR-001' });
    const merged = mergeDuplicateGroup([finding]);
    expect(merged).toEqual(finding);
    expect(merged).not.toBe(finding); // should be a new object
  });

  it('uses the most detailed description as the base', () => {
    const short = makeFinding({ id: 'I1-UXR-001', description: 'Short.' });
    const long = makeFinding({
      id: 'I2-UXR-001',
      title: 'Detailed title',
      description: 'This is a much longer and more detailed description of the issue.',
    });

    const merged = mergeDuplicateGroup([short, long]);
    expect(merged.description).toBe(long.description);
    expect(merged.title).toBe(long.title);
    expect(merged.id).toBe(long.id);
  });

  it('uses the highest severity across the group', () => {
    const minor = makeFinding({ id: 'I1-UXR-001', severity: 'minor' });
    const critical = makeFinding({ id: 'I2-UXR-001', severity: 'critical' });
    const suggestion = makeFinding({ id: 'I3-UXR-001', severity: 'suggestion' });

    const merged = mergeDuplicateGroup([minor, critical, suggestion]);
    expect(merged.severity).toBe('critical');
  });

  it('combines screenshot references from all findings', () => {
    const f1 = makeFinding({ id: 'I1-UXR-001', screenshot: 'I1-UXR-001.png' });
    const f2 = makeFinding({ id: 'I2-UXR-003', screenshot: 'I2-UXR-003.png' });

    const merged = mergeDuplicateGroup([f1, f2]);
    expect(merged.screenshot).toBe('I1-UXR-001.png, I2-UXR-003.png');
  });

  it('filters out empty screenshot references', () => {
    const f1 = makeFinding({ id: 'I1-UXR-001', screenshot: 'I1-UXR-001.png' });
    const f2 = makeFinding({ id: 'I2-UXR-003', screenshot: '' });

    const merged = mergeDuplicateGroup([f1, f2]);
    expect(merged.screenshot).toBe('I1-UXR-001.png');
  });
});

describe('applyDeduplication', () => {
  it('returns all findings unchanged when no duplicate groups', () => {
    const findings = [
      makeFinding({ id: 'I1-UXR-001' }),
      makeFinding({ id: 'I2-UXR-001' }),
    ];
    const result = applyDeduplication(findings, []);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('I1-UXR-001');
    expect(result[1].id).toBe('I2-UXR-001');
  });

  it('merges a duplicate group and removes the duplicated entries', () => {
    const findings = [
      makeFinding({ id: 'I1-UXR-001', uiArea: 'Nav', description: 'Short' }),
      makeFinding({ id: 'I1-UXR-002', uiArea: 'Dashboard' }),
      makeFinding({
        id: 'I2-UXR-001',
        uiArea: 'Nav',
        description: 'A much longer and more detailed description',
      }),
    ];

    const groups: DuplicateGroup[] = [{ findingIds: ['I1-UXR-001', 'I2-UXR-001'] }];

    const result = applyDeduplication(findings, groups);

    // Should have 2 findings: the merged one (at position of first occurrence) and I1-UXR-002
    expect(result).toHaveLength(2);
    // The merged finding replaces I1-UXR-001's position
    expect(result[0].description).toBe('A much longer and more detailed description');
    expect(result[1].id).toBe('I1-UXR-002');
  });

  it('handles multiple duplicate groups correctly', () => {
    const findings = [
      makeFinding({ id: 'I1-UXR-001', uiArea: 'Nav', description: 'Nav issue short' }),
      makeFinding({ id: 'I1-UXR-002', uiArea: 'Forms', description: 'Form issue detailed description' }),
      makeFinding({ id: 'I2-UXR-001', uiArea: 'Nav', description: 'Nav issue very detailed and thorough' }),
      makeFinding({ id: 'I2-UXR-002', uiArea: 'Forms', description: 'Form issue' }),
      makeFinding({ id: 'I3-UXR-001', uiArea: 'Dashboard' }),
    ];

    const groups: DuplicateGroup[] = [
      { findingIds: ['I1-UXR-001', 'I2-UXR-001'] },
      { findingIds: ['I1-UXR-002', 'I2-UXR-002'] },
    ];

    const result = applyDeduplication(findings, groups);

    // 5 findings - 2 duplicated = 3 findings
    expect(result).toHaveLength(3);
    expect(result[0].description).toBe('Nav issue very detailed and thorough');
    expect(result[1].description).toBe('Form issue detailed description');
    expect(result[2].id).toBe('I3-UXR-001');
  });

  it('handles duplicate group with IDs not found in findings gracefully', () => {
    const findings = [
      makeFinding({ id: 'I1-UXR-001' }),
      makeFinding({ id: 'I2-UXR-001' }),
    ];

    // Group references a non-existent finding
    const groups: DuplicateGroup[] = [
      { findingIds: ['I1-UXR-001', 'I9-UXR-999'] },
    ];

    // Only one real finding in the group — less than 2, so no merge happens
    const result = applyDeduplication(findings, groups);
    expect(result).toHaveLength(2);
  });
});

describe('collectFindings', () => {
  it('collects findings from multiple instance reports', () => {
    const reports: InstanceReport[] = [
      {
        instanceNumber: 1,
        findings: [
          makeFinding({ id: 'I1-UXR-001' }),
          makeFinding({ id: 'I1-UXR-002' }),
        ],
      },
      {
        instanceNumber: 2,
        findings: [makeFinding({ id: 'I2-UXR-001' })],
      },
    ];

    const all = collectFindings(reports);
    expect(all).toHaveLength(3);
    expect(all.map((f) => f.id)).toEqual(['I1-UXR-001', 'I1-UXR-002', 'I2-UXR-001']);
  });

  it('returns empty array for no reports', () => {
    expect(collectFindings([])).toEqual([]);
  });
});

describe('detectDuplicates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips Claude call when all findings from one instance', async () => {
    const findings = [
      makeFinding({ id: 'I1-UXR-001' }),
      makeFinding({ id: 'I1-UXR-002' }),
    ];

    const result = await detectDuplicates(findings);
    expect(result.usedClaude).toBe(false);
    expect(result.duplicateGroups).toEqual([]);
    expect(mockedRunClaude).not.toHaveBeenCalled();
  });

  it('skips Claude call for 0 or 1 findings', async () => {
    const result = await detectDuplicates([makeFinding({ id: 'I1-UXR-001' })]);
    expect(result.usedClaude).toBe(false);
    expect(mockedRunClaude).not.toHaveBeenCalled();
  });

  it('calls Claude and returns duplicate groups for multi-instance findings', async () => {
    mockedRunClaude.mockResolvedValue({
      stdout: 'DUPLICATE_GROUP: I1-UXR-001, I2-UXR-002',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const findings = [
      makeFinding({ id: 'I1-UXR-001' }),
      makeFinding({ id: 'I2-UXR-002' }),
    ];

    const result = await detectDuplicates(findings);
    expect(result.usedClaude).toBe(true);
    expect(result.duplicateGroups).toEqual([
      { findingIds: ['I1-UXR-001', 'I2-UXR-002'] },
    ]);
    expect(mockedRunClaude).toHaveBeenCalledTimes(1);
  });

  it('returns no groups when Claude says NO_DUPLICATES', async () => {
    mockedRunClaude.mockResolvedValue({
      stdout: 'NO_DUPLICATES',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const findings = [
      makeFinding({ id: 'I1-UXR-001' }),
      makeFinding({ id: 'I2-UXR-001' }),
    ];

    const result = await detectDuplicates(findings);
    expect(result.usedClaude).toBe(true);
    expect(result.duplicateGroups).toEqual([]);
  });

  it('throws when Claude CLI fails', async () => {
    mockedRunClaude.mockResolvedValue({
      stdout: '',
      stderr: 'Some error',
      exitCode: 1,
      success: false,
    });

    const findings = [
      makeFinding({ id: 'I1-UXR-001' }),
      makeFinding({ id: 'I2-UXR-001' }),
    ];

    await expect(detectDuplicates(findings)).rejects.toThrow(
      'Claude CLI failed during deduplication',
    );
  });
});

describe('consolidateReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when no instances have reports', async () => {
    mockedReadInstanceReport.mockReturnValue(null);

    const result = await consolidateReports([1, 2, 3]);
    expect(result.findings).toEqual([]);
    expect(result.duplicateGroups).toEqual([]);
    expect(result.usedClaude).toBe(false);
  });

  it('returns all findings for a single instance without calling Claude', async () => {
    mockedReadInstanceReport.mockImplementation((num) => {
      if (num === 1) {
        return {
          instanceNumber: 1,
          findings: [
            makeFinding({ id: 'I1-UXR-001', title: 'Issue A' }),
            makeFinding({ id: 'I1-UXR-002', title: 'Issue B' }),
          ],
        };
      }
      return null;
    });

    const result = await consolidateReports([1]);
    expect(result.findings).toHaveLength(2);
    expect(result.usedClaude).toBe(false);
    expect(mockedRunClaude).not.toHaveBeenCalled();
  });

  it('merges duplicates across 3 instances where 2 found the same issue', async () => {
    // Instance 1: found issues A and B
    // Instance 2: found issues C and A' (duplicate of A)
    // Instance 3: found issue D
    mockedReadInstanceReport.mockImplementation((num) => {
      if (num === 1) {
        return {
          instanceNumber: 1,
          findings: [
            makeFinding({
              id: 'I1-UXR-001',
              title: 'Inconsistent button colors',
              uiArea: 'Navigation',
              severity: 'minor',
              description: 'The buttons in the nav have different colors.',
              screenshot: 'I1-UXR-001.png',
            }),
            makeFinding({
              id: 'I1-UXR-002',
              title: 'Missing form validation',
              uiArea: 'Settings',
              severity: 'major',
              description: 'The settings form has no client-side validation feedback.',
              screenshot: 'I1-UXR-002.png',
            }),
          ],
        };
      }
      if (num === 2) {
        return {
          instanceNumber: 2,
          findings: [
            makeFinding({
              id: 'I2-UXR-001',
              title: 'Dashboard cards misaligned',
              uiArea: 'Dashboard',
              severity: 'minor',
              description: 'Cards on the dashboard are not evenly spaced.',
              screenshot: 'I2-UXR-001.png',
            }),
            makeFinding({
              id: 'I2-UXR-002',
              title: 'Navigation button styling inconsistency',
              uiArea: 'Navigation',
              severity: 'major',
              description:
                'The navigation bar buttons use different background colors, font sizes, and border styles across different sections, creating a visually inconsistent experience.',
              screenshot: 'I2-UXR-002.png',
            }),
          ],
        };
      }
      if (num === 3) {
        return {
          instanceNumber: 3,
          findings: [
            makeFinding({
              id: 'I3-UXR-001',
              title: 'Poor contrast in footer',
              uiArea: 'Footer',
              severity: 'critical',
              description: 'Footer text has very poor contrast against the background.',
              screenshot: 'I3-UXR-001.png',
            }),
          ],
        };
      }
      return null;
    });

    // Claude detects that I1-UXR-001 and I2-UXR-002 are duplicates
    mockedRunClaude.mockResolvedValue({
      stdout: 'DUPLICATE_GROUP: I1-UXR-001, I2-UXR-002',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await consolidateReports([1, 2, 3]);

    // 5 findings - 1 duplicate = 4 findings
    expect(result.findings).toHaveLength(4);

    // The duplicate should be merged
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.duplicateGroups[0].findingIds).toEqual(['I1-UXR-001', 'I2-UXR-002']);

    // The merged finding should use the more detailed description (I2-UXR-002)
    const mergedFinding = result.findings.find(
      (f) =>
        f.description.includes('visually inconsistent experience'),
    );
    expect(mergedFinding).toBeDefined();
    expect(mergedFinding!.severity).toBe('major'); // highest severity between minor and major

    // Combined screenshots
    expect(mergedFinding!.screenshot).toContain('I1-UXR-001.png');
    expect(mergedFinding!.screenshot).toContain('I2-UXR-002.png');

    // Non-duplicate findings preserved
    const nonDuplicateIds = result.findings
      .filter((f) => !f.description.includes('visually inconsistent experience'))
      .map((f) => f.id);
    expect(nonDuplicateIds).toContain('I1-UXR-002');
    expect(nonDuplicateIds).toContain('I2-UXR-001');
    expect(nonDuplicateIds).toContain('I3-UXR-001');

    // Claude was called
    expect(result.usedClaude).toBe(true);
  });

  it('keeps similar-but-distinct findings separate', async () => {
    // Instance 1: navigation color issue
    // Instance 2: navigation layout issue (similar area, different problem)
    mockedReadInstanceReport.mockImplementation((num) => {
      if (num === 1) {
        return {
          instanceNumber: 1,
          findings: [
            makeFinding({
              id: 'I1-UXR-001',
              title: 'Nav button colors inconsistent',
              uiArea: 'Navigation',
              description: 'Different color buttons in the nav bar.',
            }),
          ],
        };
      }
      if (num === 2) {
        return {
          instanceNumber: 2,
          findings: [
            makeFinding({
              id: 'I2-UXR-001',
              title: 'Nav layout broken on mobile',
              uiArea: 'Navigation',
              description: 'The nav bar overflows on mobile viewports.',
            }),
          ],
        };
      }
      return null;
    });

    // Claude correctly identifies these as NOT duplicates
    mockedRunClaude.mockResolvedValue({
      stdout: 'NO_DUPLICATES',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await consolidateReports([1, 2]);

    // Both findings kept separate
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].id).toBe('I1-UXR-001');
    expect(result.findings[1].id).toBe('I2-UXR-001');
    expect(result.duplicateGroups).toHaveLength(0);
  });

  it('handles instances with empty reports mixed with valid ones', async () => {
    mockedReadInstanceReport.mockImplementation((num) => {
      if (num === 1) {
        return { instanceNumber: 1, findings: [] };
      }
      if (num === 2) {
        return {
          instanceNumber: 2,
          findings: [makeFinding({ id: 'I2-UXR-001' })],
        };
      }
      if (num === 3) {
        return null;
      }
      return null;
    });

    const result = await consolidateReports([1, 2, 3]);

    // Only 1 finding from 1 instance — no Claude call needed
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].id).toBe('I2-UXR-001');
    expect(result.usedClaude).toBe(false);
  });
});

describe('TASK-018 verification: 3-instance deduplication scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges duplicate found by 2 of 3 instances and keeps distinct findings separate', async () => {
    // Setup: 3 instances, instances 1 and 3 both found "missing breadcrumbs on sub-pages"
    // Instance 2 found a different issue in the same area (not a duplicate)
    mockedReadInstanceReport.mockImplementation((num) => {
      if (num === 1) {
        return {
          instanceNumber: 1,
          findings: [
            makeFinding({
              id: 'I1-UXR-001',
              title: 'Missing breadcrumbs on sub-pages',
              uiArea: 'Navigation',
              severity: 'minor',
              description: 'Sub-pages under Settings lack breadcrumb navigation.',
              suggestion: 'Add breadcrumbs to all sub-pages.',
              screenshot: 'I1-UXR-001.png',
            }),
            makeFinding({
              id: 'I1-UXR-002',
              title: 'Slow loading spinner',
              uiArea: 'Dashboard',
              severity: 'suggestion',
              description: 'The loading spinner appears for too long on initial load.',
              suggestion: 'Optimize initial data fetch or add skeleton loading.',
              screenshot: 'I1-UXR-002.png',
            }),
          ],
        };
      }
      if (num === 2) {
        return {
          instanceNumber: 2,
          findings: [
            makeFinding({
              id: 'I2-UXR-001',
              title: 'Inconsistent hover states in nav',
              uiArea: 'Navigation',
              severity: 'minor',
              description: 'Hover effects differ between top nav and sidebar nav items.',
              suggestion: 'Standardize hover states across all navigation elements.',
              screenshot: 'I2-UXR-001.png',
            }),
          ],
        };
      }
      if (num === 3) {
        return {
          instanceNumber: 3,
          findings: [
            makeFinding({
              id: 'I3-UXR-001',
              title: 'No breadcrumb trail on Settings sub-pages',
              uiArea: 'Navigation',
              severity: 'major',
              description:
                'When navigating to sub-pages under Settings (e.g., Profile, Security, Notifications), there is no breadcrumb trail showing the navigation hierarchy. Users can get lost in deeply nested pages with no way to orient themselves within the app structure.',
              suggestion: 'Implement breadcrumb navigation on all sub-pages showing the full path.',
              screenshot: 'I3-UXR-001.png',
            }),
            makeFinding({
              id: 'I3-UXR-002',
              title: 'Empty state missing on dashboard widgets',
              uiArea: 'Dashboard',
              severity: 'minor',
              description: 'Dashboard widgets show a blank space instead of a helpful empty state when there is no data.',
              suggestion: 'Add empty state illustrations and messaging to all dashboard widgets.',
              screenshot: 'I3-UXR-002.png',
            }),
          ],
        };
      }
      return null;
    });

    // Claude identifies the breadcrumb findings as duplicates
    mockedRunClaude.mockResolvedValue({
      stdout: 'DUPLICATE_GROUP: I1-UXR-001, I3-UXR-001',
      stderr: '',
      exitCode: 0,
      success: true,
    });

    const result = await consolidateReports([1, 2, 3]);

    // 5 findings - 1 duplicate = 4 findings
    expect(result.findings).toHaveLength(4);

    // Verify the duplicate was merged
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.duplicateGroups[0].findingIds).toContain('I1-UXR-001');
    expect(result.duplicateGroups[0].findingIds).toContain('I3-UXR-001');

    // The merged finding uses the more detailed description (from I3-UXR-001)
    const mergedFinding = result.findings.find((f) =>
      f.description.includes('no breadcrumb trail showing the navigation hierarchy'),
    );
    expect(mergedFinding).toBeDefined();
    expect(mergedFinding!.severity).toBe('major'); // I3 had major, I1 had minor
    expect(mergedFinding!.screenshot).toContain('I1-UXR-001.png');
    expect(mergedFinding!.screenshot).toContain('I3-UXR-001.png');

    // Verify similar-but-distinct finding in same area is kept separate
    const hoverFinding = result.findings.find((f) => f.id === 'I2-UXR-001');
    expect(hoverFinding).toBeDefined();
    expect(hoverFinding!.title).toBe('Inconsistent hover states in nav');

    // Verify other non-duplicate findings are preserved
    const spinnerFinding = result.findings.find((f) => f.id === 'I1-UXR-002');
    expect(spinnerFinding).toBeDefined();

    const emptyStateFinding = result.findings.find((f) => f.id === 'I3-UXR-002');
    expect(emptyStateFinding).toBeDefined();

    // Confirm Claude was called for deduplication
    expect(result.usedClaude).toBe(true);
    expect(mockedRunClaude).toHaveBeenCalledTimes(1);
  });
});
