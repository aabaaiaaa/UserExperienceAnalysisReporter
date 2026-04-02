import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  buildScreenshotFilename,
  buildMultiScreenshotFilename,
  isValidScreenshotName,
  extractFindingId,
  listScreenshots,
  getScreenshotsForFinding,
  buildScreenshotInstructions,
} from '../src/screenshots.js';

// Use a test-specific temp directory
const TEST_TEMP_DIR = resolve('.uxreview-temp-screenshots-test');

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

function ensureScreenshotsDir(instanceNumber: number): string {
  const dir = join(TEST_TEMP_DIR, `instance-${instanceNumber}`, 'screenshots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createScreenshotFile(instanceNumber: number, filename: string): void {
  const dir = ensureScreenshotsDir(instanceNumber);
  // Write a minimal PNG header to simulate a real screenshot
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  writeFileSync(join(dir, filename), pngHeader);
}

beforeEach(() => {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_TEMP_DIR)) {
    rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  }
});

describe('buildScreenshotFilename', () => {
  it('appends .png to the finding ID', () => {
    expect(buildScreenshotFilename('I1-UXR-001')).toBe('I1-UXR-001.png');
  });

  it('works for different instance numbers', () => {
    expect(buildScreenshotFilename('I3-UXR-015')).toBe('I3-UXR-015.png');
  });

  it('works for large finding numbers', () => {
    expect(buildScreenshotFilename('I1-UXR-1000')).toBe('I1-UXR-1000.png');
  });
});

describe('buildMultiScreenshotFilename', () => {
  it('uses alphabetic suffix starting from a', () => {
    expect(buildMultiScreenshotFilename('I1-UXR-001', 0)).toBe('I1-UXR-001-a.png');
  });

  it('increments suffix alphabetically', () => {
    expect(buildMultiScreenshotFilename('I1-UXR-001', 0)).toBe('I1-UXR-001-a.png');
    expect(buildMultiScreenshotFilename('I1-UXR-001', 1)).toBe('I1-UXR-001-b.png');
    expect(buildMultiScreenshotFilename('I1-UXR-001', 2)).toBe('I1-UXR-001-c.png');
  });

  it('works for different instance numbers', () => {
    expect(buildMultiScreenshotFilename('I2-UXR-005', 0)).toBe('I2-UXR-005-a.png');
    expect(buildMultiScreenshotFilename('I2-UXR-005', 1)).toBe('I2-UXR-005-b.png');
  });

  it('supports up to 26 suffixes (a-z)', () => {
    expect(buildMultiScreenshotFilename('I1-UXR-001', 25)).toBe('I1-UXR-001-z.png');
  });
});

describe('isValidScreenshotName', () => {
  it('accepts primary screenshot names', () => {
    expect(isValidScreenshotName('I1-UXR-001.png')).toBe(true);
    expect(isValidScreenshotName('I2-UXR-042.png')).toBe(true);
    expect(isValidScreenshotName('I10-UXR-100.png')).toBe(true);
  });

  it('accepts suffixed screenshot names', () => {
    expect(isValidScreenshotName('I1-UXR-001-a.png')).toBe(true);
    expect(isValidScreenshotName('I1-UXR-001-b.png')).toBe(true);
    expect(isValidScreenshotName('I1-UXR-001-z.png')).toBe(true);
  });

  it('rejects names with wrong extension', () => {
    expect(isValidScreenshotName('I1-UXR-001.jpg')).toBe(false);
    expect(isValidScreenshotName('I1-UXR-001.jpeg')).toBe(false);
    expect(isValidScreenshotName('I1-UXR-001.gif')).toBe(false);
  });

  it('rejects names with wrong prefix format', () => {
    expect(isValidScreenshotName('UXR-001.png')).toBe(false);
    expect(isValidScreenshotName('I-UXR-001.png')).toBe(false);
    expect(isValidScreenshotName('instance1-UXR-001.png')).toBe(false);
  });

  it('rejects names with wrong finding number format', () => {
    expect(isValidScreenshotName('I1-UXR-01.png')).toBe(false);
    expect(isValidScreenshotName('I1-UXR-1.png')).toBe(false);
  });

  it('rejects names with uppercase suffix', () => {
    expect(isValidScreenshotName('I1-UXR-001-A.png')).toBe(false);
  });

  it('rejects names with multi-character suffix', () => {
    expect(isValidScreenshotName('I1-UXR-001-ab.png')).toBe(false);
  });

  it('rejects random filenames', () => {
    expect(isValidScreenshotName('screenshot.png')).toBe(false);
    expect(isValidScreenshotName('random-file.png')).toBe(false);
    expect(isValidScreenshotName('')).toBe(false);
  });

  it('accepts finding numbers longer than 3 digits', () => {
    expect(isValidScreenshotName('I1-UXR-1000.png')).toBe(true);
    expect(isValidScreenshotName('I1-UXR-1000-a.png')).toBe(true);
  });
});

describe('extractFindingId', () => {
  it('extracts ID from primary screenshot name', () => {
    expect(extractFindingId('I1-UXR-001.png')).toBe('I1-UXR-001');
    expect(extractFindingId('I3-UXR-042.png')).toBe('I3-UXR-042');
  });

  it('extracts ID from suffixed screenshot name', () => {
    expect(extractFindingId('I1-UXR-001-a.png')).toBe('I1-UXR-001');
    expect(extractFindingId('I1-UXR-001-b.png')).toBe('I1-UXR-001');
    expect(extractFindingId('I2-UXR-015-z.png')).toBe('I2-UXR-015');
  });

  it('returns null for invalid filenames', () => {
    expect(extractFindingId('screenshot.png')).toBeNull();
    expect(extractFindingId('random.txt')).toBeNull();
    expect(extractFindingId('')).toBeNull();
  });

  it('returns null for filenames with wrong pattern', () => {
    expect(extractFindingId('UXR-001.png')).toBeNull();
    expect(extractFindingId('I1-UXR-01.png')).toBeNull();
  });
});

describe('listScreenshots', () => {
  it('returns empty array when screenshots directory does not exist', () => {
    // Instance 99 doesn't have a directory
    const result = listScreenshots(99);
    expect(result).toEqual([]);
  });

  it('returns empty array when screenshots directory is empty', () => {
    ensureScreenshotsDir(1);
    const result = listScreenshots(1);
    expect(result).toEqual([]);
  });

  it('lists all valid screenshot files', () => {
    createScreenshotFile(1, 'I1-UXR-001.png');
    createScreenshotFile(1, 'I1-UXR-002.png');
    createScreenshotFile(1, 'I1-UXR-003.png');

    const result = listScreenshots(1);
    expect(result).toEqual(['I1-UXR-001.png', 'I1-UXR-002.png', 'I1-UXR-003.png']);
  });

  it('includes suffixed screenshots', () => {
    createScreenshotFile(1, 'I1-UXR-001.png');
    createScreenshotFile(1, 'I1-UXR-001-a.png');
    createScreenshotFile(1, 'I1-UXR-001-b.png');

    const result = listScreenshots(1);
    expect(result).toEqual(['I1-UXR-001-a.png', 'I1-UXR-001-b.png', 'I1-UXR-001.png']);
  });

  it('filters out non-screenshot files', () => {
    createScreenshotFile(1, 'I1-UXR-001.png');
    const dir = ensureScreenshotsDir(1);
    writeFileSync(join(dir, 'readme.txt'), 'not a screenshot');
    writeFileSync(join(dir, 'random.png'), 'not valid naming');

    const result = listScreenshots(1);
    expect(result).toEqual(['I1-UXR-001.png']);
  });

  it('returns sorted results', () => {
    createScreenshotFile(1, 'I1-UXR-003.png');
    createScreenshotFile(1, 'I1-UXR-001.png');
    createScreenshotFile(1, 'I1-UXR-002.png');

    const result = listScreenshots(1);
    expect(result).toEqual(['I1-UXR-001.png', 'I1-UXR-002.png', 'I1-UXR-003.png']);
  });
});

describe('getScreenshotsForFinding', () => {
  it('returns screenshots for a specific finding', () => {
    createScreenshotFile(1, 'I1-UXR-001.png');
    createScreenshotFile(1, 'I1-UXR-002.png');
    createScreenshotFile(1, 'I1-UXR-003.png');

    const result = getScreenshotsForFinding(1, 'I1-UXR-002');
    expect(result).toEqual(['I1-UXR-002.png']);
  });

  it('returns all screenshots for a finding including suffixed ones', () => {
    createScreenshotFile(1, 'I1-UXR-001.png');
    createScreenshotFile(1, 'I1-UXR-001-a.png');
    createScreenshotFile(1, 'I1-UXR-001-b.png');
    createScreenshotFile(1, 'I1-UXR-002.png');

    const result = getScreenshotsForFinding(1, 'I1-UXR-001');
    expect(result).toEqual(['I1-UXR-001-a.png', 'I1-UXR-001-b.png', 'I1-UXR-001.png']);
  });

  it('returns empty array when finding has no screenshots', () => {
    createScreenshotFile(1, 'I1-UXR-001.png');

    const result = getScreenshotsForFinding(1, 'I1-UXR-099');
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist', () => {
    const result = getScreenshotsForFinding(99, 'I99-UXR-001');
    expect(result).toEqual([]);
  });
});

describe('buildScreenshotInstructions', () => {
  it('includes the screenshots directory path', () => {
    const instructions = buildScreenshotInstructions(1, '/tmp/instance-1/screenshots');
    expect(instructions).toContain('/tmp/instance-1/screenshots');
  });

  it('includes instance-specific naming examples', () => {
    const instructions = buildScreenshotInstructions(2, '/tmp/screenshots');
    expect(instructions).toContain('I2-UXR-001.png');
    expect(instructions).toContain('I2-UXR-NNN.png');
  });

  it('includes multi-screenshot suffix convention', () => {
    const instructions = buildScreenshotInstructions(1, '/tmp/screenshots');
    expect(instructions).toContain('-a.png');
    expect(instructions).toContain('-b.png');
  });

  it('mentions Playwright MCP for screenshot capture', () => {
    const instructions = buildScreenshotInstructions(1, '/tmp/screenshots');
    expect(instructions).toContain('Playwright MCP');
  });

  it('requires every finding to have a screenshot', () => {
    const instructions = buildScreenshotInstructions(1, '/tmp/screenshots');
    expect(instructions).toContain('Every finding MUST have at least one screenshot');
  });

  it('requires PNG format', () => {
    const instructions = buildScreenshotInstructions(1, '/tmp/screenshots');
    expect(instructions).toContain('PNG format');
  });

  it('includes guidance on when to use multiple screenshots', () => {
    const instructions = buildScreenshotInstructions(1, '/tmp/screenshots');
    expect(instructions).toContain('Before/after');
    expect(instructions).toContain('viewport');
  });
});

describe('verification: mock instance run with screenshots', () => {
  it('simulates a full instance run with single screenshots per finding', () => {
    // Simulate what Claude would do: create screenshot files during analysis
    createScreenshotFile(1, 'I1-UXR-001.png');
    createScreenshotFile(1, 'I1-UXR-002.png');
    createScreenshotFile(1, 'I1-UXR-003.png');

    // Verify screenshots exist in the instance's screenshots directory
    const screenshots = listScreenshots(1);
    expect(screenshots).toHaveLength(3);
    expect(screenshots).toContain('I1-UXR-001.png');
    expect(screenshots).toContain('I1-UXR-002.png');
    expect(screenshots).toContain('I1-UXR-003.png');

    // Verify all follow the naming convention
    for (const name of screenshots) {
      expect(isValidScreenshotName(name)).toBe(true);
    }

    // Verify each finding maps to its screenshot
    expect(getScreenshotsForFinding(1, 'I1-UXR-001')).toEqual(['I1-UXR-001.png']);
    expect(getScreenshotsForFinding(1, 'I1-UXR-002')).toEqual(['I1-UXR-002.png']);
    expect(getScreenshotsForFinding(1, 'I1-UXR-003')).toEqual(['I1-UXR-003.png']);
  });

  it('simulates a full instance run with multiple screenshots per finding', () => {
    // Finding 1: single screenshot
    createScreenshotFile(1, 'I1-UXR-001.png');

    // Finding 2: multiple screenshots (before/after state)
    createScreenshotFile(1, 'I1-UXR-002.png');
    createScreenshotFile(1, 'I1-UXR-002-a.png');
    createScreenshotFile(1, 'I1-UXR-002-b.png');

    // Finding 3: multiple screenshots (responsive issue across viewports)
    createScreenshotFile(1, 'I1-UXR-003.png');
    createScreenshotFile(1, 'I1-UXR-003-a.png');

    // Verify total screenshots
    const allScreenshots = listScreenshots(1);
    expect(allScreenshots).toHaveLength(6);

    // Verify all follow the naming convention
    for (const name of allScreenshots) {
      expect(isValidScreenshotName(name)).toBe(true);
    }

    // Verify finding 1 has 1 screenshot
    const finding1Shots = getScreenshotsForFinding(1, 'I1-UXR-001');
    expect(finding1Shots).toHaveLength(1);
    expect(finding1Shots).toContain('I1-UXR-001.png');

    // Verify finding 2 has 3 screenshots (primary + 2 additional)
    const finding2Shots = getScreenshotsForFinding(1, 'I1-UXR-002');
    expect(finding2Shots).toHaveLength(3);
    expect(finding2Shots).toContain('I1-UXR-002.png');
    expect(finding2Shots).toContain('I1-UXR-002-a.png');
    expect(finding2Shots).toContain('I1-UXR-002-b.png');

    // Verify finding 3 has 2 screenshots (primary + 1 additional)
    const finding3Shots = getScreenshotsForFinding(1, 'I1-UXR-003');
    expect(finding3Shots).toHaveLength(2);
    expect(finding3Shots).toContain('I1-UXR-003.png');
    expect(finding3Shots).toContain('I1-UXR-003-a.png');
  });

  it('simulates multiple instances with independent screenshots', () => {
    // Instance 1 screenshots
    createScreenshotFile(1, 'I1-UXR-001.png');
    createScreenshotFile(1, 'I1-UXR-002.png');
    createScreenshotFile(1, 'I1-UXR-002-a.png');

    // Instance 2 screenshots
    createScreenshotFile(2, 'I2-UXR-001.png');
    createScreenshotFile(2, 'I2-UXR-001-a.png');
    createScreenshotFile(2, 'I2-UXR-001-b.png');
    createScreenshotFile(2, 'I2-UXR-002.png');

    // Verify instance 1 screenshots are isolated
    const inst1Shots = listScreenshots(1);
    expect(inst1Shots).toHaveLength(3);
    expect(inst1Shots.every((n) => n.startsWith('I1-'))).toBe(true);

    // Verify instance 2 screenshots are isolated
    const inst2Shots = listScreenshots(2);
    expect(inst2Shots).toHaveLength(4);
    expect(inst2Shots.every((n) => n.startsWith('I2-'))).toBe(true);

    // Verify per-finding queries work across instances
    expect(getScreenshotsForFinding(1, 'I1-UXR-002')).toHaveLength(2);
    expect(getScreenshotsForFinding(2, 'I2-UXR-001')).toHaveLength(3);
  });

  it('confirms screenshot filenames match finding IDs from buildScreenshotFilename', () => {
    const findingId = 'I1-UXR-005';
    const primaryName = buildScreenshotFilename(findingId);
    const extraName1 = buildMultiScreenshotFilename(findingId, 0);
    const extraName2 = buildMultiScreenshotFilename(findingId, 1);

    // Create the screenshots
    createScreenshotFile(1, primaryName);
    createScreenshotFile(1, extraName1);
    createScreenshotFile(1, extraName2);

    // All should be valid
    expect(isValidScreenshotName(primaryName)).toBe(true);
    expect(isValidScreenshotName(extraName1)).toBe(true);
    expect(isValidScreenshotName(extraName2)).toBe(true);

    // All should map back to the same finding ID
    expect(extractFindingId(primaryName)).toBe(findingId);
    expect(extractFindingId(extraName1)).toBe(findingId);
    expect(extractFindingId(extraName2)).toBe(findingId);

    // All should be discoverable via getScreenshotsForFinding
    const shots = getScreenshotsForFinding(1, findingId);
    expect(shots).toHaveLength(3);
    expect(shots).toContain(primaryName);
    expect(shots).toContain(extraName1);
    expect(shots).toContain(extraName2);
  });
});
