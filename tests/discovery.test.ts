import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  DiscoveryEntry,
  DiscoveryRound,
  DiscoveryDocument,
  formatDiscoveryEntry,
  formatDiscoveryRound,
  formatDiscoveryDocument,
  parseDiscoveryDocument,
  writeDiscoveryDocument,
  appendDiscoveryRound,
  readDiscoveryDocument,
  readDiscoveryContent,
  buildDiscoveryInstructions,
  buildDiscoveryContextPrompt,
  extractDiscoveryItems,
} from '../src/discovery.js';

// Use a test-specific temp directory
const TEST_TEMP_DIR = resolve('.uxreview-temp-discovery-test');

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

const SAMPLE_ENTRY: DiscoveryEntry = {
  area: 'Navigation Bar',
  visitedAt: '2026-04-02T10:00:00.000Z',
  navigationPath: 'Direct URL → Home page',
  elementsObserved: [
    'Main navigation links (Home, Dashboard, Settings)',
    'Logo/brand image',
    'Search bar',
    'User avatar dropdown',
  ],
  checked: [
    'Layout consistency',
    'Hover states on nav items',
    'Accessibility (focus management)',
  ],
};

const SAMPLE_ENTRY_2: DiscoveryEntry = {
  area: 'Dashboard',
  visitedAt: '2026-04-02T10:15:00.000Z',
  navigationPath: 'Navigation Bar → Dashboard link',
  elementsObserved: [
    'Card grid (4 cards)',
    'Statistics summary section',
    'Recent activity feed',
  ],
  checked: [
    'Card spacing consistency',
    'Loading states',
    'Empty state handling',
  ],
};

const SAMPLE_ROUND_1: DiscoveryRound = {
  roundNumber: 1,
  entries: [SAMPLE_ENTRY, SAMPLE_ENTRY_2],
};

const SAMPLE_ROUND_2: DiscoveryRound = {
  roundNumber: 2,
  entries: [
    {
      area: 'Settings Page',
      visitedAt: '2026-04-02T11:00:00.000Z',
      navigationPath: 'Navigation Bar → Settings',
      elementsObserved: [
        'Profile form with name and email fields',
        'Save button',
        'Cancel link',
        'Notification preferences toggles',
      ],
      checked: [
        'Form validation feedback',
        'Button consistency',
        'Terminology consistency',
      ],
    },
  ],
};

beforeEach(() => {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_TEMP_DIR)) {
    rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  }
});

describe('formatDiscoveryEntry', () => {
  it('formats an entry with all fields', () => {
    const result = formatDiscoveryEntry(SAMPLE_ENTRY);

    expect(result).toContain('### Navigation Bar');
    expect(result).toContain('- **Visited**: 2026-04-02T10:00:00.000Z');
    expect(result).toContain('- **Navigation Path**: Direct URL → Home page');
    expect(result).toContain('- **Elements Observed**:');
    expect(result).toContain('  - Main navigation links (Home, Dashboard, Settings)');
    expect(result).toContain('  - Logo/brand image');
    expect(result).toContain('  - Search bar');
    expect(result).toContain('  - User avatar dropdown');
    expect(result).toContain('- **Checked**:');
    expect(result).toContain('  - Layout consistency');
    expect(result).toContain('  - Hover states on nav items');
    expect(result).toContain('  - Accessibility (focus management)');
  });

  it('handles empty lists', () => {
    const entry: DiscoveryEntry = {
      area: 'Empty Area',
      visitedAt: '2026-04-02T10:00:00.000Z',
      navigationPath: 'Direct',
      elementsObserved: [],
      checked: [],
    };

    const result = formatDiscoveryEntry(entry);
    expect(result).toContain('### Empty Area');
    expect(result).toContain('- **Elements Observed**:');
    expect(result).toContain('- **Checked**:');
  });
});

describe('formatDiscoveryRound', () => {
  it('formats a round with multiple entries', () => {
    const result = formatDiscoveryRound(SAMPLE_ROUND_1);

    expect(result).toContain('## Round 1');
    expect(result).toContain('### Navigation Bar');
    expect(result).toContain('### Dashboard');
  });

  it('formats a round with a single entry', () => {
    const round: DiscoveryRound = { roundNumber: 3, entries: [SAMPLE_ENTRY] };
    const result = formatDiscoveryRound(round);

    expect(result).toContain('## Round 3');
    expect(result).toContain('### Navigation Bar');
  });
});

describe('formatDiscoveryDocument', () => {
  it('formats a full document with header', () => {
    const doc: DiscoveryDocument = {
      instanceNumber: 1,
      rounds: [SAMPLE_ROUND_1],
    };

    const result = formatDiscoveryDocument(doc);

    expect(result).toContain('# Discovery Document - Instance 1');
    expect(result).toContain('## Round 1');
    expect(result).toContain('### Navigation Bar');
    expect(result).toContain('### Dashboard');
  });

  it('formats multi-round document', () => {
    const doc: DiscoveryDocument = {
      instanceNumber: 2,
      rounds: [SAMPLE_ROUND_1, SAMPLE_ROUND_2],
    };

    const result = formatDiscoveryDocument(doc);

    expect(result).toContain('# Discovery Document - Instance 2');
    expect(result).toContain('## Round 1');
    expect(result).toContain('## Round 2');
    expect(result).toContain('### Settings Page');
  });
});

describe('parseDiscoveryDocument', () => {
  it('parses a formatted document back to structured data', () => {
    const doc: DiscoveryDocument = {
      instanceNumber: 1,
      rounds: [SAMPLE_ROUND_1],
    };
    const formatted = formatDiscoveryDocument(doc);
    const parsed = parseDiscoveryDocument(formatted, 1);

    expect(parsed).not.toBeNull();
    expect(parsed!.instanceNumber).toBe(1);
    expect(parsed!.rounds).toHaveLength(1);
    expect(parsed!.rounds[0].roundNumber).toBe(1);
    expect(parsed!.rounds[0].entries).toHaveLength(2);
  });

  it('round-trips entry fields correctly', () => {
    const doc: DiscoveryDocument = {
      instanceNumber: 1,
      rounds: [{ roundNumber: 1, entries: [SAMPLE_ENTRY] }],
    };
    const formatted = formatDiscoveryDocument(doc);
    const parsed = parseDiscoveryDocument(formatted, 1);

    const entry = parsed!.rounds[0].entries[0];
    expect(entry.area).toBe('Navigation Bar');
    expect(entry.visitedAt).toBe('2026-04-02T10:00:00.000Z');
    expect(entry.navigationPath).toBe('Direct URL → Home page');
    expect(entry.elementsObserved).toEqual([
      'Main navigation links (Home, Dashboard, Settings)',
      'Logo/brand image',
      'Search bar',
      'User avatar dropdown',
    ]);
    expect(entry.checked).toEqual([
      'Layout consistency',
      'Hover states on nav items',
      'Accessibility (focus management)',
    ]);
  });

  it('parses multi-round documents', () => {
    const doc: DiscoveryDocument = {
      instanceNumber: 1,
      rounds: [SAMPLE_ROUND_1, SAMPLE_ROUND_2],
    };
    const formatted = formatDiscoveryDocument(doc);
    const parsed = parseDiscoveryDocument(formatted, 1);

    expect(parsed!.rounds).toHaveLength(2);
    expect(parsed!.rounds[0].roundNumber).toBe(1);
    expect(parsed!.rounds[0].entries).toHaveLength(2);
    expect(parsed!.rounds[1].roundNumber).toBe(2);
    expect(parsed!.rounds[1].entries).toHaveLength(1);
    expect(parsed!.rounds[1].entries[0].area).toBe('Settings Page');
  });

  it('returns null for empty content', () => {
    expect(parseDiscoveryDocument('', 1)).toBeNull();
    expect(parseDiscoveryDocument('   ', 1)).toBeNull();
  });

  it('returns null for content without round headers', () => {
    expect(parseDiscoveryDocument('# Just a title\nNo rounds here.', 1)).toBeNull();
  });
});

describe('writeDiscoveryDocument', () => {
  it('writes a discovery document to the instance directory', () => {
    ensureInstanceDir(1);
    const doc: DiscoveryDocument = {
      instanceNumber: 1,
      rounds: [SAMPLE_ROUND_1],
    };

    writeDiscoveryDocument(1, doc);

    const path = join(TEST_TEMP_DIR, 'instance-1', 'discovery.md');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('# Discovery Document - Instance 1');
    expect(content).toContain('## Round 1');
    expect(content).toContain('### Navigation Bar');
  });
});

describe('readDiscoveryDocument', () => {
  it('reads and parses an existing discovery document', () => {
    ensureInstanceDir(1);
    const doc: DiscoveryDocument = {
      instanceNumber: 1,
      rounds: [SAMPLE_ROUND_1],
    };
    writeDiscoveryDocument(1, doc);

    const result = readDiscoveryDocument(1);

    expect(result).not.toBeNull();
    expect(result!.instanceNumber).toBe(1);
    expect(result!.rounds).toHaveLength(1);
    expect(result!.rounds[0].entries).toHaveLength(2);
  });

  it('returns null when no discovery file exists', () => {
    ensureInstanceDir(5);
    const result = readDiscoveryDocument(5);
    expect(result).toBeNull();
  });

  it('returns null for invalid content', () => {
    const dir = ensureInstanceDir(3);
    writeFileSync(join(dir, 'discovery.md'), 'not a valid discovery doc', 'utf-8');
    const result = readDiscoveryDocument(3);
    expect(result).toBeNull();
  });
});

describe('readDiscoveryContent', () => {
  it('reads raw content from the discovery file', () => {
    ensureInstanceDir(1);
    const doc: DiscoveryDocument = {
      instanceNumber: 1,
      rounds: [SAMPLE_ROUND_1],
    };
    writeDiscoveryDocument(1, doc);

    const content = readDiscoveryContent(1);
    expect(content).not.toBeNull();
    expect(content).toContain('# Discovery Document - Instance 1');
  });

  it('returns null when file does not exist', () => {
    ensureInstanceDir(2);
    const content = readDiscoveryContent(2);
    expect(content).toBeNull();
  });
});

describe('appendDiscoveryRound', () => {
  it('creates the file with header when no file exists', () => {
    ensureInstanceDir(1);

    appendDiscoveryRound(1, SAMPLE_ROUND_1);

    const content = readDiscoveryContent(1);
    expect(content).not.toBeNull();
    expect(content).toContain('# Discovery Document - Instance 1');
    expect(content).toContain('## Round 1');
    expect(content).toContain('### Navigation Bar');
    expect(content).toContain('### Dashboard');
  });

  it('appends a second round to an existing document', () => {
    ensureInstanceDir(1);

    // Write round 1
    appendDiscoveryRound(1, SAMPLE_ROUND_1);

    // Append round 2
    appendDiscoveryRound(1, SAMPLE_ROUND_2);

    const content = readDiscoveryContent(1)!;
    expect(content).toContain('## Round 1');
    expect(content).toContain('### Navigation Bar');
    expect(content).toContain('### Dashboard');
    expect(content).toContain('## Round 2');
    expect(content).toContain('### Settings Page');
  });

  it('preserves round 1 entries after appending round 2', () => {
    ensureInstanceDir(1);

    appendDiscoveryRound(1, SAMPLE_ROUND_1);
    appendDiscoveryRound(1, SAMPLE_ROUND_2);

    const doc = readDiscoveryDocument(1);
    expect(doc).not.toBeNull();
    expect(doc!.rounds).toHaveLength(2);

    // Round 1 entries are preserved
    expect(doc!.rounds[0].roundNumber).toBe(1);
    expect(doc!.rounds[0].entries).toHaveLength(2);
    expect(doc!.rounds[0].entries[0].area).toBe('Navigation Bar');
    expect(doc!.rounds[0].entries[0].elementsObserved).toHaveLength(4);
    expect(doc!.rounds[0].entries[1].area).toBe('Dashboard');
    expect(doc!.rounds[0].entries[1].elementsObserved).toHaveLength(3);

    // Round 2 entries are present
    expect(doc!.rounds[1].roundNumber).toBe(2);
    expect(doc!.rounds[1].entries).toHaveLength(1);
    expect(doc!.rounds[1].entries[0].area).toBe('Settings Page');
    expect(doc!.rounds[1].entries[0].elementsObserved).toHaveLength(4);
  });

  it('accumulates three rounds correctly', () => {
    ensureInstanceDir(1);

    appendDiscoveryRound(1, SAMPLE_ROUND_1);
    appendDiscoveryRound(1, SAMPLE_ROUND_2);

    const round3: DiscoveryRound = {
      roundNumber: 3,
      entries: [
        {
          area: 'User Profile',
          visitedAt: '2026-04-02T12:00:00.000Z',
          navigationPath: 'Settings → Profile link',
          elementsObserved: ['Avatar upload', 'Bio text area'],
          checked: ['Form usability', 'Image upload handling'],
        },
      ],
    };
    appendDiscoveryRound(1, round3);

    const doc = readDiscoveryDocument(1);
    expect(doc).not.toBeNull();
    expect(doc!.rounds).toHaveLength(3);
    expect(doc!.rounds[0].roundNumber).toBe(1);
    expect(doc!.rounds[1].roundNumber).toBe(2);
    expect(doc!.rounds[2].roundNumber).toBe(3);
    expect(doc!.rounds[2].entries[0].area).toBe('User Profile');
  });
});

describe('buildDiscoveryInstructions', () => {
  it('includes the discovery file path', () => {
    const instructions = buildDiscoveryInstructions(1, '/tmp/instance-1/discovery.md');
    expect(instructions).toContain('/tmp/instance-1/discovery.md');
  });

  it('includes the structured format example', () => {
    const instructions = buildDiscoveryInstructions(1, '/tmp/discovery.md');
    expect(instructions).toContain('### [Area Name]');
    expect(instructions).toContain('**Visited**');
    expect(instructions).toContain('**Navigation Path**');
    expect(instructions).toContain('**Elements Observed**');
    expect(instructions).toContain('**Checked**');
  });

  it('includes round heading instruction', () => {
    const instructions = buildDiscoveryInstructions(1, '/tmp/discovery.md');
    expect(instructions).toContain('## Round [N]');
  });

  it('uses the correct instance number in the header example', () => {
    const instructions = buildDiscoveryInstructions(3, '/tmp/discovery.md');
    expect(instructions).toContain('# Discovery Document - Instance 3');
  });

  it('instructs not to overwrite previous rounds', () => {
    const instructions = buildDiscoveryInstructions(1, '/tmp/discovery.md');
    expect(instructions).toContain('never overwrite previous round entries');
  });
});

describe('buildDiscoveryContextPrompt', () => {
  it('includes the existing discovery content', () => {
    const content = '# Discovery Document - Instance 1\n\n## Round 1\n\n### Nav Bar\n...';
    const prompt = buildDiscoveryContextPrompt(content);
    expect(prompt).toContain(content);
  });

  it('instructs to focus on gaps', () => {
    const prompt = buildDiscoveryContextPrompt('some content');
    expect(prompt).toContain('Areas or sub-areas that were not visited');
    expect(prompt).toContain('Elements that were observed but not thoroughly checked');
    expect(prompt).toContain('Evaluation criteria that were missed');
  });

  it('has a header indicating previous discovery', () => {
    const prompt = buildDiscoveryContextPrompt('some content');
    expect(prompt).toContain('## Previous Discovery');
  });

  it('instructs not to re-document covered areas', () => {
    const prompt = buildDiscoveryContextPrompt('some content');
    expect(prompt).toContain('Do NOT re-document areas');
  });
});

describe('extractDiscoveryItems', () => {
  it('returns null when no discovery file exists', () => {
    ensureInstanceDir(5);
    expect(extractDiscoveryItems(5)).toBeNull();
  });

  it('extracts elements as "Area: Element" items', () => {
    ensureInstanceDir(1);
    appendDiscoveryRound(1, SAMPLE_ROUND_1);

    const items = extractDiscoveryItems(1);
    expect(items).not.toBeNull();
    // SAMPLE_ENTRY has 4 elements, SAMPLE_ENTRY_2 has 3 elements => 7 items
    expect(items).toHaveLength(7);
    expect(items).toContain('Navigation Bar: Main navigation links (Home, Dashboard, Settings)');
    expect(items).toContain('Navigation Bar: Logo/brand image');
    expect(items).toContain('Navigation Bar: Search bar');
    expect(items).toContain('Navigation Bar: User avatar dropdown');
    expect(items).toContain('Dashboard: Card grid (4 cards)');
    expect(items).toContain('Dashboard: Statistics summary section');
    expect(items).toContain('Dashboard: Recent activity feed');
  });

  it('falls back to area name when entry has no elements', () => {
    ensureInstanceDir(1);
    const round: DiscoveryRound = {
      roundNumber: 1,
      entries: [
        {
          area: 'Simple Area',
          visitedAt: '2026-04-02T10:00:00Z',
          navigationPath: 'Home',
          elementsObserved: [],
          checked: ['Layout consistency'],
        },
      ],
    };
    appendDiscoveryRound(1, round);

    const items = extractDiscoveryItems(1);
    expect(items).not.toBeNull();
    expect(items).toHaveLength(1);
    expect(items).toContain('Simple Area');
  });

  it('deduplicates items across rounds', () => {
    ensureInstanceDir(1);

    const round1: DiscoveryRound = {
      roundNumber: 1,
      entries: [
        {
          area: 'Navigation',
          visitedAt: '2026-04-02T10:00:00Z',
          navigationPath: 'Home',
          elementsObserved: ['Logo', 'Search bar'],
          checked: ['Layout'],
        },
      ],
    };
    appendDiscoveryRound(1, round1);

    const round2: DiscoveryRound = {
      roundNumber: 2,
      entries: [
        {
          area: 'Navigation',
          visitedAt: '2026-04-02T11:00:00Z',
          navigationPath: 'Home',
          elementsObserved: ['Logo', 'Hamburger menu'], // Logo is duplicate
          checked: ['Accessibility'],
        },
      ],
    };
    appendDiscoveryRound(1, round2);

    const items = extractDiscoveryItems(1);
    expect(items).not.toBeNull();
    // Logo appears in both rounds but should only appear once
    expect(items).toHaveLength(3);
    expect(items).toContain('Navigation: Logo');
    expect(items).toContain('Navigation: Search bar');
    expect(items).toContain('Navigation: Hamburger menu');
  });

  it('combines items from multiple areas and rounds', () => {
    ensureInstanceDir(1);

    appendDiscoveryRound(1, SAMPLE_ROUND_1);
    appendDiscoveryRound(1, SAMPLE_ROUND_2);

    const items = extractDiscoveryItems(1);
    expect(items).not.toBeNull();
    // Round 1: Nav (4 elements) + Dashboard (3 elements) = 7
    // Round 2: Settings Page (4 elements) = 4
    // Total: 11
    expect(items).toHaveLength(11);
    expect(items).toContain('Navigation Bar: Search bar');
    expect(items).toContain('Dashboard: Card grid (4 cards)');
    expect(items).toContain('Settings Page: Save button');
  });

  it('returns null for empty discovery document', () => {
    ensureInstanceDir(1);
    const paths = join(TEST_TEMP_DIR, 'instance-1', 'discovery.md');
    writeFileSync(paths, '', 'utf-8');
    expect(extractDiscoveryItems(1)).toBeNull();
  });
});

describe('verification: mock instance run and round accumulation', () => {
  it('simulates a full instance run producing a structured discovery doc', () => {
    ensureInstanceDir(1);

    // Simulate what a Claude instance would write during round 1
    const round1Entries: DiscoveryEntry[] = [
      {
        area: 'Home Page',
        visitedAt: '2026-04-02T10:00:00.000Z',
        navigationPath: 'Direct URL → https://example.com',
        elementsObserved: [
          'Hero banner with CTA button',
          'Feature cards (3 cards)',
          'Footer with links',
        ],
        checked: [
          'Layout consistency',
          'Responsiveness',
          'Navigation flow',
        ],
      },
      {
        area: 'Login Form',
        visitedAt: '2026-04-02T10:10:00.000Z',
        navigationPath: 'Home Page → Sign In button',
        elementsObserved: [
          'Email input field',
          'Password input field',
          'Submit button',
          'Forgot password link',
        ],
        checked: [
          'Form validation feedback',
          'Error messaging',
          'Accessibility (labels, focus)',
        ],
      },
    ];

    const round1: DiscoveryRound = { roundNumber: 1, entries: round1Entries };
    appendDiscoveryRound(1, round1);

    // Verify: discovery doc contains structured entries for visited areas and elements
    const doc = readDiscoveryDocument(1);
    expect(doc).not.toBeNull();
    expect(doc!.rounds).toHaveLength(1);
    expect(doc!.rounds[0].entries).toHaveLength(2);

    const homeEntry = doc!.rounds[0].entries[0];
    expect(homeEntry.area).toBe('Home Page');
    expect(homeEntry.visitedAt).toBeTruthy();
    expect(homeEntry.navigationPath).toContain('Direct URL');
    expect(homeEntry.elementsObserved.length).toBeGreaterThan(0);
    expect(homeEntry.checked.length).toBeGreaterThan(0);

    const loginEntry = doc!.rounds[0].entries[1];
    expect(loginEntry.area).toBe('Login Form');
    expect(loginEntry.elementsObserved).toContain('Email input field');
    expect(loginEntry.checked).toContain('Form validation feedback');
  });

  it('simulates round 2 accumulating new entries alongside round 1 entries', () => {
    ensureInstanceDir(1);

    // Round 1
    const round1: DiscoveryRound = {
      roundNumber: 1,
      entries: [
        {
          area: 'Dashboard',
          visitedAt: '2026-04-02T10:00:00.000Z',
          navigationPath: 'Login → Dashboard redirect',
          elementsObserved: ['Stats cards', 'Activity feed', 'Quick actions panel'],
          checked: ['Layout consistency', 'Loading states'],
        },
      ],
    };
    appendDiscoveryRound(1, round1);

    // Verify round 1 exists
    const afterRound1 = readDiscoveryDocument(1);
    expect(afterRound1!.rounds).toHaveLength(1);
    expect(afterRound1!.rounds[0].entries[0].area).toBe('Dashboard');

    // Round 2: new areas + deeper check on existing
    const round2: DiscoveryRound = {
      roundNumber: 2,
      entries: [
        {
          area: 'Settings Page',
          visitedAt: '2026-04-02T11:00:00.000Z',
          navigationPath: 'Dashboard → Sidebar → Settings',
          elementsObserved: ['Theme toggle', 'Language selector', 'Account deletion button'],
          checked: ['Interactive element consistency', 'Terminology consistency'],
        },
        {
          area: 'Dashboard (deeper check)',
          visitedAt: '2026-04-02T11:15:00.000Z',
          navigationPath: 'Settings → Back to Dashboard',
          elementsObserved: ['Filter dropdown', 'Date range picker'],
          checked: ['Accessibility basics', 'Error messaging'],
        },
      ],
    };
    appendDiscoveryRound(1, round2);

    // Verify: doc has accumulated new entries alongside round 1 entries
    const afterRound2 = readDiscoveryDocument(1);
    expect(afterRound2).not.toBeNull();
    expect(afterRound2!.rounds).toHaveLength(2);

    // Round 1 entries are still intact
    expect(afterRound2!.rounds[0].roundNumber).toBe(1);
    expect(afterRound2!.rounds[0].entries).toHaveLength(1);
    expect(afterRound2!.rounds[0].entries[0].area).toBe('Dashboard');
    expect(afterRound2!.rounds[0].entries[0].elementsObserved).toContain('Stats cards');

    // Round 2 entries are accumulated
    expect(afterRound2!.rounds[1].roundNumber).toBe(2);
    expect(afterRound2!.rounds[1].entries).toHaveLength(2);
    expect(afterRound2!.rounds[1].entries[0].area).toBe('Settings Page');
    expect(afterRound2!.rounds[1].entries[1].area).toBe('Dashboard (deeper check)');

    // Verify raw content has both rounds present
    const rawContent = readDiscoveryContent(1)!;
    expect(rawContent).toContain('## Round 1');
    expect(rawContent).toContain('### Dashboard');
    expect(rawContent).toContain('## Round 2');
    expect(rawContent).toContain('### Settings Page');
    expect(rawContent).toContain('### Dashboard (deeper check)');
  });
});
