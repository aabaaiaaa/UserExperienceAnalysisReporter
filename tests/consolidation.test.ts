import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildDeduplicationPrompt,
  parseDeduplicationResponse,
  mergeDuplicateGroup,
  applyDeduplication,
  collectFindings,
  detectDuplicates,
  consolidateReports,
  DuplicateGroup,
  buildFinalId,
  parseScreenshotRefs,
  extractInstanceFromScreenshot,
  buildNewScreenshotFilenames,
  reassignIds,
  copyScreenshots,
  reassignAndRemapScreenshots,
  ConsolidationResult,
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

// Mock the file-manager module for getInstancePaths
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

// ---- TASK-019: ID Reassignment and Screenshot Remapping Tests ----

describe('buildFinalId', () => {
  it('builds zero-padded UXR IDs', () => {
    expect(buildFinalId(1)).toBe('UXR-001');
    expect(buildFinalId(9)).toBe('UXR-009');
    expect(buildFinalId(10)).toBe('UXR-010');
    expect(buildFinalId(99)).toBe('UXR-099');
    expect(buildFinalId(100)).toBe('UXR-100');
    expect(buildFinalId(999)).toBe('UXR-999');
  });
});

describe('parseScreenshotRefs', () => {
  it('parses a single screenshot reference', () => {
    expect(parseScreenshotRefs('I1-UXR-001.png')).toEqual(['I1-UXR-001.png']);
  });

  it('parses comma-separated screenshot references', () => {
    expect(parseScreenshotRefs('I1-UXR-001.png, I2-UXR-003.png')).toEqual([
      'I1-UXR-001.png',
      'I2-UXR-003.png',
    ]);
  });

  it('handles extra whitespace', () => {
    expect(parseScreenshotRefs('  I1-UXR-001.png ,  I2-UXR-003.png  ')).toEqual([
      'I1-UXR-001.png',
      'I2-UXR-003.png',
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(parseScreenshotRefs('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(parseScreenshotRefs('   ')).toEqual([]);
  });

  it('filters out empty entries from trailing commas', () => {
    expect(parseScreenshotRefs('I1-UXR-001.png, ')).toEqual(['I1-UXR-001.png']);
  });
});

describe('extractInstanceFromScreenshot', () => {
  it('extracts instance number from standard screenshot filenames', () => {
    expect(extractInstanceFromScreenshot('I1-UXR-001.png')).toBe(1);
    expect(extractInstanceFromScreenshot('I3-UXR-012.png')).toBe(3);
    expect(extractInstanceFromScreenshot('I10-UXR-005.png')).toBe(10);
  });

  it('extracts instance number from suffixed screenshot filenames', () => {
    expect(extractInstanceFromScreenshot('I2-UXR-001-a.png')).toBe(2);
    expect(extractInstanceFromScreenshot('I1-UXR-003-b.png')).toBe(1);
  });

  it('returns null for non-matching filenames', () => {
    expect(extractInstanceFromScreenshot('random.png')).toBeNull();
    expect(extractInstanceFromScreenshot('UXR-001.png')).toBeNull();
    expect(extractInstanceFromScreenshot('')).toBeNull();
  });
});

describe('buildNewScreenshotFilenames', () => {
  it('returns empty array for count 0', () => {
    expect(buildNewScreenshotFilenames('UXR-001', 0)).toEqual([]);
  });

  it('returns single filename without suffix for count 1', () => {
    expect(buildNewScreenshotFilenames('UXR-001', 1)).toEqual(['UXR-001.png']);
  });

  it('returns primary + suffixed filenames for count 2', () => {
    expect(buildNewScreenshotFilenames('UXR-001', 2)).toEqual([
      'UXR-001.png',
      'UXR-001-a.png',
    ]);
  });

  it('returns primary + sequential suffixes for count 3', () => {
    expect(buildNewScreenshotFilenames('UXR-005', 3)).toEqual([
      'UXR-005.png',
      'UXR-005-a.png',
      'UXR-005-b.png',
    ]);
  });
});

describe('reassignIds', () => {
  it('assigns sequential UXR IDs starting from 001', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'I1-UXR-001', screenshot: 'I1-UXR-001.png' }),
      makeFinding({ id: 'I2-UXR-001', screenshot: 'I2-UXR-001.png' }),
      makeFinding({ id: 'I1-UXR-002', screenshot: 'I1-UXR-002.png' }),
    ];

    const result = reassignIds(findings);

    expect(result.findings).toHaveLength(3);
    expect(result.findings[0].id).toBe('UXR-001');
    expect(result.findings[1].id).toBe('UXR-002');
    expect(result.findings[2].id).toBe('UXR-003');
  });

  it('builds correct ID mapping', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'I1-UXR-001', screenshot: 'I1-UXR-001.png' }),
      makeFinding({ id: 'I2-UXR-003', screenshot: 'I2-UXR-003.png' }),
    ];

    const result = reassignIds(findings);

    expect(result.idMapping.get('I1-UXR-001')).toBe('UXR-001');
    expect(result.idMapping.get('I2-UXR-003')).toBe('UXR-002');
  });

  it('remaps single screenshot references correctly', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'I1-UXR-001', screenshot: 'I1-UXR-001.png' }),
    ];

    const result = reassignIds(findings);

    expect(result.findings[0].screenshot).toBe('UXR-001.png');
  });

  it('remaps merged multi-screenshot references correctly', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'I2-UXR-002', screenshot: 'I1-UXR-001.png, I2-UXR-002.png' }),
    ];

    const result = reassignIds(findings);

    expect(result.findings[0].screenshot).toBe('UXR-001.png, UXR-001-a.png');
  });

  it('generates screenshot copy operations', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'I1-UXR-001', screenshot: 'I1-UXR-001.png' }),
      makeFinding({ id: 'I2-UXR-002', screenshot: 'I1-UXR-003.png, I2-UXR-002.png' }),
    ];

    const result = reassignIds(findings);

    expect(result.screenshotOps).toHaveLength(3);
    expect(result.screenshotOps[0]).toEqual({
      instanceNumber: 1,
      sourceFilename: 'I1-UXR-001.png',
      destFilename: 'UXR-001.png',
    });
    expect(result.screenshotOps[1]).toEqual({
      instanceNumber: 1,
      sourceFilename: 'I1-UXR-003.png',
      destFilename: 'UXR-002.png',
    });
    expect(result.screenshotOps[2]).toEqual({
      instanceNumber: 2,
      sourceFilename: 'I2-UXR-002.png',
      destFilename: 'UXR-002-a.png',
    });
  });

  it('handles findings with empty screenshot fields', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'I1-UXR-001', screenshot: '' }),
    ];

    const result = reassignIds(findings);

    expect(result.findings[0].id).toBe('UXR-001');
    expect(result.findings[0].screenshot).toBe('');
    expect(result.screenshotOps).toHaveLength(0);
  });

  it('returns empty results for empty findings array', () => {
    const result = reassignIds([]);

    expect(result.findings).toEqual([]);
    expect(result.idMapping.size).toBe(0);
    expect(result.screenshotOps).toHaveLength(0);
  });

  it('produces sequential IDs with no gaps', () => {
    const findings: Finding[] = Array.from({ length: 5 }, (_, i) =>
      makeFinding({ id: `I1-UXR-${String(i + 1).padStart(3, '0')}`, screenshot: `I1-UXR-${String(i + 1).padStart(3, '0')}.png` }),
    );

    const result = reassignIds(findings);

    const ids = result.findings.map((f) => f.id);
    expect(ids).toEqual(['UXR-001', 'UXR-002', 'UXR-003', 'UXR-004', 'UXR-005']);
  });
});

describe('copyScreenshots', () => {
  const testTempDir = join(process.cwd(), '.uxreview-temp-test');
  const testOutputDir = join(process.cwd(), '.uxreview-output-test');

  beforeEach(() => {
    // Create test directory structure
    mkdirSync(join(testTempDir, 'instance-1', 'screenshots'), { recursive: true });
    mkdirSync(join(testTempDir, 'instance-2', 'screenshots'), { recursive: true });
    mkdirSync(join(testOutputDir, 'screenshots'), { recursive: true });

    // Create fake screenshot files
    writeFileSync(join(testTempDir, 'instance-1', 'screenshots', 'I1-UXR-001.png'), 'screenshot-1');
    writeFileSync(join(testTempDir, 'instance-2', 'screenshots', 'I2-UXR-001.png'), 'screenshot-2');
    writeFileSync(join(testTempDir, 'instance-1', 'screenshots', 'I1-UXR-002.png'), 'screenshot-3');
    writeFileSync(join(testTempDir, 'instance-1', 'screenshots', 'I1-UXR-002-a.png'), 'screenshot-3a');
  });

  afterEach(() => {
    if (existsSync(testTempDir)) {
      rmSync(testTempDir, { recursive: true, force: true });
    }
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('copies and renames screenshots to the output directory', () => {
    const ops = [
      { instanceNumber: 1, sourceFilename: 'I1-UXR-001.png', destFilename: 'UXR-001.png' },
      { instanceNumber: 2, sourceFilename: 'I2-UXR-001.png', destFilename: 'UXR-002.png' },
    ];

    copyScreenshots(ops, testOutputDir);

    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-001.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-002.png'))).toBe(true);

    // Verify content was copied correctly
    expect(readFileSync(join(testOutputDir, 'screenshots', 'UXR-001.png'), 'utf-8')).toBe('screenshot-1');
    expect(readFileSync(join(testOutputDir, 'screenshots', 'UXR-002.png'), 'utf-8')).toBe('screenshot-2');
  });

  it('handles multiple screenshots per finding', () => {
    const ops = [
      { instanceNumber: 1, sourceFilename: 'I1-UXR-002.png', destFilename: 'UXR-001.png' },
      { instanceNumber: 1, sourceFilename: 'I1-UXR-002-a.png', destFilename: 'UXR-001-a.png' },
    ];

    copyScreenshots(ops, testOutputDir);

    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-001.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-001-a.png'))).toBe(true);
    expect(readFileSync(join(testOutputDir, 'screenshots', 'UXR-001.png'), 'utf-8')).toBe('screenshot-3');
    expect(readFileSync(join(testOutputDir, 'screenshots', 'UXR-001-a.png'), 'utf-8')).toBe('screenshot-3a');
  });

  it('silently skips missing source screenshots', () => {
    const ops = [
      { instanceNumber: 1, sourceFilename: 'I1-UXR-001.png', destFilename: 'UXR-001.png' },
      { instanceNumber: 1, sourceFilename: 'I1-UXR-NONEXISTENT.png', destFilename: 'UXR-002.png' },
    ];

    // Should not throw
    copyScreenshots(ops, testOutputDir);

    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-001.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-002.png'))).toBe(false);
  });

  it('handles empty operations list', () => {
    copyScreenshots([], testOutputDir);
    // No errors, nothing copied
  });
});

describe('reassignAndRemapScreenshots', () => {
  const testTempDir = join(process.cwd(), '.uxreview-temp-test');
  const testOutputDir = join(process.cwd(), '.uxreview-output-test');

  beforeEach(() => {
    mkdirSync(join(testTempDir, 'instance-1', 'screenshots'), { recursive: true });
    mkdirSync(join(testTempDir, 'instance-2', 'screenshots'), { recursive: true });
    mkdirSync(join(testOutputDir, 'screenshots'), { recursive: true });

    writeFileSync(join(testTempDir, 'instance-1', 'screenshots', 'I1-UXR-001.png'), 'img-1');
    writeFileSync(join(testTempDir, 'instance-1', 'screenshots', 'I1-UXR-002.png'), 'img-2');
    writeFileSync(join(testTempDir, 'instance-2', 'screenshots', 'I2-UXR-001.png'), 'img-3');
  });

  afterEach(() => {
    if (existsSync(testTempDir)) {
      rmSync(testTempDir, { recursive: true, force: true });
    }
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('reassigns IDs and copies screenshots end-to-end', () => {
    const consolidationResult: ConsolidationResult = {
      findings: [
        makeFinding({ id: 'I1-UXR-001', title: 'Issue A', screenshot: 'I1-UXR-001.png' }),
        makeFinding({ id: 'I1-UXR-002', title: 'Issue B', screenshot: 'I1-UXR-002.png' }),
        makeFinding({ id: 'I2-UXR-001', title: 'Issue C', screenshot: 'I2-UXR-001.png' }),
      ],
      duplicateGroups: [],
      usedClaude: false,
    };

    const result = reassignAndRemapScreenshots(consolidationResult, testOutputDir);

    // IDs are sequential
    expect(result.findings[0].id).toBe('UXR-001');
    expect(result.findings[1].id).toBe('UXR-002');
    expect(result.findings[2].id).toBe('UXR-003');

    // Screenshot references updated
    expect(result.findings[0].screenshot).toBe('UXR-001.png');
    expect(result.findings[1].screenshot).toBe('UXR-002.png');
    expect(result.findings[2].screenshot).toBe('UXR-003.png');

    // Files copied and renamed in output
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-001.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-002.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-003.png'))).toBe(true);

    // Content preserved
    expect(readFileSync(join(testOutputDir, 'screenshots', 'UXR-001.png'), 'utf-8')).toBe('img-1');
    expect(readFileSync(join(testOutputDir, 'screenshots', 'UXR-002.png'), 'utf-8')).toBe('img-2');
    expect(readFileSync(join(testOutputDir, 'screenshots', 'UXR-003.png'), 'utf-8')).toBe('img-3');
  });

  it('handles merged findings with combined screenshot references', () => {
    const consolidationResult: ConsolidationResult = {
      findings: [
        makeFinding({
          id: 'I2-UXR-001',
          title: 'Merged issue',
          screenshot: 'I1-UXR-001.png, I2-UXR-001.png',
        }),
        makeFinding({ id: 'I1-UXR-002', title: 'Standalone', screenshot: 'I1-UXR-002.png' }),
      ],
      duplicateGroups: [{ findingIds: ['I1-UXR-001', 'I2-UXR-001'] }],
      usedClaude: true,
    };

    const result = reassignAndRemapScreenshots(consolidationResult, testOutputDir);

    expect(result.findings[0].id).toBe('UXR-001');
    expect(result.findings[0].screenshot).toBe('UXR-001.png, UXR-001-a.png');
    expect(result.findings[1].id).toBe('UXR-002');
    expect(result.findings[1].screenshot).toBe('UXR-002.png');

    // Both screenshots for the merged finding copied
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-001.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-001-a.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-002.png'))).toBe(true);
  });

  it('handles empty consolidation result', () => {
    const consolidationResult: ConsolidationResult = {
      findings: [],
      duplicateGroups: [],
      usedClaude: false,
    };

    const result = reassignAndRemapScreenshots(consolidationResult, testOutputDir);

    expect(result.findings).toEqual([]);
    expect(result.screenshotOps).toHaveLength(0);
  });
});

describe('TASK-019 verification: sequential IDs, screenshot renaming, and reference matching', () => {
  const testTempDir = join(process.cwd(), '.uxreview-temp-test');
  const testOutputDir = join(process.cwd(), '.uxreview-output-test');

  beforeEach(() => {
    mkdirSync(join(testTempDir, 'instance-1', 'screenshots'), { recursive: true });
    mkdirSync(join(testTempDir, 'instance-2', 'screenshots'), { recursive: true });
    mkdirSync(join(testTempDir, 'instance-3', 'screenshots'), { recursive: true });
    mkdirSync(join(testOutputDir, 'screenshots'), { recursive: true });

    // Instance 1 screenshots
    writeFileSync(join(testTempDir, 'instance-1', 'screenshots', 'I1-UXR-001.png'), 'i1-s1');
    writeFileSync(join(testTempDir, 'instance-1', 'screenshots', 'I1-UXR-002.png'), 'i1-s2');
    // Instance 2 screenshots
    writeFileSync(join(testTempDir, 'instance-2', 'screenshots', 'I2-UXR-001.png'), 'i2-s1');
    writeFileSync(join(testTempDir, 'instance-2', 'screenshots', 'I2-UXR-002.png'), 'i2-s2');
    // Instance 3 screenshots
    writeFileSync(join(testTempDir, 'instance-3', 'screenshots', 'I3-UXR-001.png'), 'i3-s1');
  });

  afterEach(() => {
    if (existsSync(testTempDir)) {
      rmSync(testTempDir, { recursive: true, force: true });
    }
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it('full pipeline: deduplication → ID reassignment → screenshot remapping', () => {
    // Simulate the output of consolidateReports (TASK-018):
    // 5 findings from 3 instances, one duplicate merged
    const consolidationResult: ConsolidationResult = {
      findings: [
        // Merged finding (I1-UXR-001 + I2-UXR-002 were duplicates)
        makeFinding({
          id: 'I2-UXR-002',
          title: 'Nav button inconsistency',
          uiArea: 'Navigation',
          severity: 'major',
          screenshot: 'I1-UXR-001.png, I2-UXR-002.png',
        }),
        makeFinding({
          id: 'I1-UXR-002',
          title: 'Form validation missing',
          uiArea: 'Settings',
          severity: 'major',
          screenshot: 'I1-UXR-002.png',
        }),
        makeFinding({
          id: 'I2-UXR-001',
          title: 'Dashboard misalignment',
          uiArea: 'Dashboard',
          severity: 'minor',
          screenshot: 'I2-UXR-001.png',
        }),
        makeFinding({
          id: 'I3-UXR-001',
          title: 'Poor footer contrast',
          uiArea: 'Footer',
          severity: 'critical',
          screenshot: 'I3-UXR-001.png',
        }),
      ],
      duplicateGroups: [{ findingIds: ['I1-UXR-001', 'I2-UXR-002'] }],
      usedClaude: true,
    };

    const result = reassignAndRemapScreenshots(consolidationResult, testOutputDir);

    // VERIFICATION 1: All findings have sequential UXR- IDs with no gaps
    const ids = result.findings.map((f) => f.id);
    expect(ids).toEqual(['UXR-001', 'UXR-002', 'UXR-003', 'UXR-004']);

    // Verify no gaps by checking the numeric sequence
    const idNumbers = ids.map((id) => parseInt(id.replace('UXR-', ''), 10));
    for (let i = 0; i < idNumbers.length; i++) {
      expect(idNumbers[i]).toBe(i + 1);
    }

    // VERIFICATION 2: Screenshots in output directory renamed correctly
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-001.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-001-a.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-002.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-003.png'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'screenshots', 'UXR-004.png'))).toBe(true);

    // No stale instance-scoped filenames in output
    expect(existsSync(join(testOutputDir, 'screenshots', 'I1-UXR-001.png'))).toBe(false);
    expect(existsSync(join(testOutputDir, 'screenshots', 'I2-UXR-002.png'))).toBe(false);

    // VERIFICATION 3: Report references match the new filenames
    expect(result.findings[0].screenshot).toBe('UXR-001.png, UXR-001-a.png');
    expect(result.findings[1].screenshot).toBe('UXR-002.png');
    expect(result.findings[2].screenshot).toBe('UXR-003.png');
    expect(result.findings[3].screenshot).toBe('UXR-004.png');

    // Cross-check: each screenshot referenced in findings exists on disk
    for (const finding of result.findings) {
      const refs = parseScreenshotRefs(finding.screenshot);
      for (const ref of refs) {
        expect(existsSync(join(testOutputDir, 'screenshots', ref))).toBe(true);
      }
    }
  });
});
