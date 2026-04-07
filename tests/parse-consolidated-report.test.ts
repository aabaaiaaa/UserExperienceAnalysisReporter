import { describe, it, expect } from 'vitest';
import { parseConsolidatedReport } from '../src/consolidation.js';

describe('parseConsolidatedReport', () => {
  it('returns empty array for empty input', () => {
    expect(parseConsolidatedReport('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseConsolidatedReport('   \n\n  ')).toEqual([]);
  });

  it('returns empty array when no finding headings are present', () => {
    const content = [
      '# Report Title',
      '## Navigation',
      'Some description text here.',
      '## Forms',
      'More text without any findings.',
    ].join('\n');

    expect(parseConsolidatedReport(content)).toEqual([]);
  });

  it('parses a single finding with all fields correctly', () => {
    const content = [
      '## Navigation',
      '### UXR-001: Button is hard to find',
      '- **Severity**: major',
      '- **Description**: The submit button is below the fold',
      '- **Suggestion**: Move the button above the fold',
      '- **Screenshot**: UXR-001.png',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      id: 'UXR-001',
      title: 'Button is hard to find',
      uiArea: 'Navigation',
      severity: 'major',
      description: 'The submit button is below the fold',
      suggestion: 'Move the button above the fold',
      screenshot: 'UXR-001.png',
    });
  });

  it('parses a finding with missing severity line — defaults to suggestion', () => {
    const content = [
      '## Forms',
      '### UXR-002: Missing label',
      '- **Description**: Input field has no label',
      '- **Suggestion**: Add an aria-label',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('suggestion');
    expect(findings[0].id).toBe('UXR-002');
    expect(findings[0].uiArea).toBe('Forms');
  });

  it('parses multiple findings across multiple areas with correct area assignment', () => {
    const content = [
      '## Navigation',
      '### UXR-001: Nav issue one',
      '- **Severity**: minor',
      '- **Description**: First nav issue',
      '- **Suggestion**: Fix nav',
      '- **Screenshot**: UXR-001.png',
      '',
      '### UXR-002: Nav issue two',
      '- **Severity**: critical',
      '- **Description**: Second nav issue',
      '- **Suggestion**: Fix nav urgently',
      '- **Screenshot**: UXR-002.png',
      '',
      '## Forms',
      '### UXR-003: Form issue',
      '- **Severity**: major',
      '- **Description**: Form problem',
      '- **Suggestion**: Fix form',
      '- **Screenshot**: UXR-003.png',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(3);
    expect(findings[0].uiArea).toBe('Navigation');
    expect(findings[0].id).toBe('UXR-001');
    expect(findings[1].uiArea).toBe('Navigation');
    expect(findings[1].id).toBe('UXR-002');
    expect(findings[2].uiArea).toBe('Forms');
    expect(findings[2].id).toBe('UXR-003');
  });

  it('recognizes deeply nested findings at heading levels ####, #####, ######', () => {
    const content = [
      '## Layout',
      '#### UXR-010: Level 4 finding',
      '- **Severity**: minor',
      '- **Description**: Found at h4',
      '- **Suggestion**: Fix h4',
      '- **Screenshot**: UXR-010.png',
      '',
      '##### UXR-011: Level 5 finding',
      '- **Severity**: major',
      '- **Description**: Found at h5',
      '- **Suggestion**: Fix h5',
      '- **Screenshot**: UXR-011.png',
      '',
      '###### UXR-012: Level 6 finding',
      '- **Severity**: critical',
      '- **Description**: Found at h6',
      '- **Suggestion**: Fix h6',
      '- **Screenshot**: UXR-012.png',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(3);
    expect(findings[0].id).toBe('UXR-010');
    expect(findings[1].id).toBe('UXR-011');
    expect(findings[2].id).toBe('UXR-012');
    expect(findings.every((f) => f.uiArea === 'Layout')).toBe(true);
  });

  it('skips malformed headings without UXR- prefix', () => {
    const content = [
      '## Navigation',
      '### ISSUE-001: Not a UXR finding',
      '- **Severity**: major',
      '- **Description**: Should be skipped',
      '',
      '### UXR-001: Real finding',
      '- **Severity**: minor',
      '- **Description**: Should be parsed',
      '- **Suggestion**: Keep it',
      '- **Screenshot**: UXR-001.png',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('UXR-001');
  });

  it('treats ## UXR- heading as finding context, not area heading', () => {
    const content = [
      '## General',
      '### UXR-001: First finding',
      '- **Severity**: minor',
      '- **Description**: Under General area',
      '- **Suggestion**: Fix it',
      '- **Screenshot**: UXR-001.png',
      '',
      '## UXR-050: This looks like a finding in an area heading',
      '### UXR-002: Second finding',
      '- **Severity**: major',
      '- **Description**: Should still be under General area',
      '- **Suggestion**: Fix it too',
      '- **Screenshot**: UXR-002.png',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(2);
    // The ## UXR-050 line is NOT treated as an area heading (the regex excludes ## UXR-)
    // so the area remains 'General' for the second finding
    expect(findings[1].uiArea).toBe('General');
  });

  it('captures multi-line description (first line only per current implementation)', () => {
    const content = [
      '## Accessibility',
      '### UXR-005: Color contrast issue',
      '- **Severity**: critical',
      '- **Description**: The text color has insufficient contrast ratio against the background',
      '- **Suggestion**: Use a darker text color',
      '- **Screenshot**: UXR-005.png',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(1);
    expect(findings[0].description).toBe(
      'The text color has insufficient contrast ratio against the background',
    );
  });

  it('handles finding with no metadata lines at all', () => {
    const content = [
      '## Layout',
      '### UXR-099: Bare finding with no metadata',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      id: 'UXR-099',
      title: 'Bare finding with no metadata',
      uiArea: 'Layout',
      severity: 'suggestion',
      description: '',
      suggestion: '',
      screenshot: '',
    });
  });

  it('handles finding IDs with more than 3 digits', () => {
    const content = [
      '## Dashboard',
      '### UXR-1234: Finding with long ID',
      '- **Severity**: minor',
      '- **Description**: IDs can be longer',
      '- **Suggestion**: Support them',
      '- **Screenshot**: UXR-1234.png',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('UXR-1234');
  });

  it('ignores invalid severity values and defaults to suggestion', () => {
    const content = [
      '## Settings',
      '### UXR-007: Bad severity',
      '- **Severity**: extreme',
      '- **Description**: Invalid severity value',
      '- **Suggestion**: Should default',
      '- **Screenshot**: UXR-007.png',
    ].join('\n');

    const findings = parseConsolidatedReport(content);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('suggestion');
  });
});
