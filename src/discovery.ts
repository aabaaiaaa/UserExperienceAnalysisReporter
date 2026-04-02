import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { getInstancePaths } from './file-manager.js';

/**
 * A single discovery entry representing one UI area visited during analysis.
 */
export interface DiscoveryEntry {
  /** Name of the UI area (e.g., "Navigation Bar", "Dashboard") */
  area: string;
  /** ISO timestamp of when the area was visited */
  visitedAt: string;
  /** How the analyst navigated to this area */
  navigationPath: string;
  /** Specific UI elements, components, and features observed */
  elementsObserved: string[];
  /** What evaluation criteria were checked in this area */
  checked: string[];
}

/**
 * A collection of discovery entries for a single round.
 */
export interface DiscoveryRound {
  roundNumber: number;
  entries: DiscoveryEntry[];
}

/**
 * The full discovery document for an instance, spanning all rounds.
 */
export interface DiscoveryDocument {
  instanceNumber: number;
  rounds: DiscoveryRound[];
}

/**
 * Format a single discovery entry as markdown text.
 */
export function formatDiscoveryEntry(entry: DiscoveryEntry): string {
  const lines: string[] = [
    `### ${entry.area}`,
    `- **Visited**: ${entry.visitedAt}`,
    `- **Navigation Path**: ${entry.navigationPath}`,
    '- **Elements Observed**:',
  ];

  for (const element of entry.elementsObserved) {
    lines.push(`  - ${element}`);
  }

  lines.push('- **Checked**:');
  for (const item of entry.checked) {
    lines.push(`  - ${item}`);
  }

  return lines.join('\n');
}

/**
 * Format a full round of discovery entries as markdown text.
 */
export function formatDiscoveryRound(round: DiscoveryRound): string {
  const lines: string[] = [`## Round ${round.roundNumber}`, ''];

  for (let i = 0; i < round.entries.length; i++) {
    lines.push(formatDiscoveryEntry(round.entries[i]));
    if (i < round.entries.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format a complete discovery document as markdown text.
 */
export function formatDiscoveryDocument(doc: DiscoveryDocument): string {
  const lines: string[] = [`# Discovery Document - Instance ${doc.instanceNumber}`, ''];

  for (let i = 0; i < doc.rounds.length; i++) {
    lines.push(formatDiscoveryRound(doc.rounds[i]));
    if (i < doc.rounds.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Parse a markdown discovery document back into structured data.
 * Returns null if the content cannot be parsed.
 */
export function parseDiscoveryDocument(content: string, instanceNumber: number): DiscoveryDocument | null {
  if (!content.trim()) {
    return null;
  }

  const doc: DiscoveryDocument = { instanceNumber, rounds: [] };
  const roundRegex = /^## Round (\d+)/gm;
  const roundMatches: { roundNumber: number; startIndex: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = roundRegex.exec(content)) !== null) {
    roundMatches.push({ roundNumber: parseInt(match[1], 10), startIndex: match.index });
  }

  if (roundMatches.length === 0) {
    return null;
  }

  for (let i = 0; i < roundMatches.length; i++) {
    const start = roundMatches[i].startIndex;
    const end = i < roundMatches.length - 1 ? roundMatches[i + 1].startIndex : content.length;
    const roundContent = content.slice(start, end);

    const round: DiscoveryRound = {
      roundNumber: roundMatches[i].roundNumber,
      entries: parseRoundEntries(roundContent),
    };
    doc.rounds.push(round);
  }

  return doc;
}

/**
 * Parse discovery entries from a single round's markdown content.
 */
function parseRoundEntries(roundContent: string): DiscoveryEntry[] {
  const entries: DiscoveryEntry[] = [];
  const entryRegex = /^### (.+)$/gm;
  const entryMatches: { area: string; startIndex: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(roundContent)) !== null) {
    entryMatches.push({ area: match[1], startIndex: match.index });
  }

  for (let i = 0; i < entryMatches.length; i++) {
    const start = entryMatches[i].startIndex;
    const end = i < entryMatches.length - 1 ? entryMatches[i + 1].startIndex : roundContent.length;
    const entryContent = roundContent.slice(start, end);

    entries.push(parseEntryContent(entryMatches[i].area, entryContent));
  }

  return entries;
}

/**
 * Parse a single entry's content from markdown.
 */
function parseEntryContent(area: string, content: string): DiscoveryEntry {
  const visitedMatch = content.match(/\*\*Visited\*\*:\s*(.+)/);
  const navMatch = content.match(/\*\*Navigation Path\*\*:\s*(.+)/);

  const elementsObserved = parseListItems(content, 'Elements Observed');
  const checked = parseListItems(content, 'Checked');

  return {
    area,
    visitedAt: visitedMatch ? visitedMatch[1].trim() : '',
    navigationPath: navMatch ? navMatch[1].trim() : '',
    elementsObserved,
    checked,
  };
}

/**
 * Parse indented list items under a bold label from markdown content.
 */
function parseListItems(content: string, label: string): string[] {
  const items: string[] = [];
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sectionRegex = new RegExp(`\\*\\*${escapedLabel}\\*\\*:([\\s\\S]*?)(?=\\n- \\*\\*|$)`);
  const sectionMatch = content.match(sectionRegex);

  if (sectionMatch) {
    const lines = sectionMatch[1].split('\n');
    for (const line of lines) {
      const itemMatch = line.match(/^\s{2}- (.+)/);
      if (itemMatch) {
        items.push(itemMatch[1].trim());
      }
    }
  }

  return items;
}

/**
 * Write a complete discovery document to the instance's discovery.md file.
 * Overwrites any existing content.
 */
export function writeDiscoveryDocument(instanceNumber: number, doc: DiscoveryDocument): void {
  const paths = getInstancePaths(instanceNumber);
  const content = formatDiscoveryDocument(doc);
  writeFileSync(paths.discovery, content, 'utf-8');
}

/**
 * Append a new round of discovery entries to the instance's discovery.md file.
 * If the file doesn't exist, creates it with the header and the round.
 * If the file exists, appends the new round below existing content.
 */
export function appendDiscoveryRound(instanceNumber: number, round: DiscoveryRound): void {
  const paths = getInstancePaths(instanceNumber);

  if (!existsSync(paths.discovery)) {
    // Create the file with header and first round
    const doc: DiscoveryDocument = { instanceNumber, rounds: [round] };
    writeFileSync(paths.discovery, formatDiscoveryDocument(doc), 'utf-8');
  } else {
    // Append the new round to the existing file
    const roundText = '\n' + formatDiscoveryRound(round) + '\n';
    appendFileSync(paths.discovery, roundText, 'utf-8');
  }
}

/**
 * Read and parse the discovery document for an instance.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export function readDiscoveryDocument(instanceNumber: number): DiscoveryDocument | null {
  const paths = getInstancePaths(instanceNumber);

  if (!existsSync(paths.discovery)) {
    return null;
  }

  try {
    const content = readFileSync(paths.discovery, 'utf-8');
    return parseDiscoveryDocument(content, instanceNumber);
  } catch {
    return null;
  }
}

/**
 * Read the raw content of the discovery document for an instance.
 * Returns null if the file doesn't exist.
 * This is used to pass existing discovery content to Claude in round 2+.
 */
export function readDiscoveryContent(instanceNumber: number): string | null {
  const paths = getInstancePaths(instanceNumber);

  if (!existsSync(paths.discovery)) {
    return null;
  }

  try {
    return readFileSync(paths.discovery, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Build the discovery document format instructions for a Claude instance prompt.
 * This tells Claude exactly how to structure discovery entries.
 */
export function buildDiscoveryInstructions(instanceNumber: number, discoveryPath: string): string {
  return `### Discovery Document: ${discoveryPath}

Track what you explore using this exact markdown format. For each UI area you visit, add an entry:

\`\`\`markdown
### [Area Name]
- **Visited**: [ISO timestamp]
- **Navigation Path**: [How you got here, e.g., "Home → Settings → Profile"]
- **Elements Observed**:
  - [Element 1]
  - [Element 2]
  - [Element 3]
- **Checked**:
  - [What you evaluated, e.g., "Layout consistency"]
  - [Another criterion, e.g., "Form validation feedback"]
\`\`\`

Group entries under round headings. Start with:

\`\`\`markdown
# Discovery Document - Instance ${instanceNumber}

## Round [N]
\`\`\`

Append new entries as you go. This document accumulates across rounds — never overwrite previous round entries.`;
}

/**
 * Extract a flat list of granular items from the discovery document.
 * Each item is a specific element within an area (formatted as "Area: Element").
 * If an area has no observed elements, the area name itself is used.
 * Deduplicates across rounds so each unique item appears once.
 * Returns null if no discovery document exists or has no entries.
 *
 * Used to recalibrate the progress scale in round 2+, where the discovery doc
 * provides a more detailed breakdown than the original plan items.
 */
export function extractDiscoveryItems(instanceNumber: number): string[] | null {
  const doc = readDiscoveryDocument(instanceNumber);
  if (!doc || doc.rounds.length === 0) return null;

  const items: string[] = [];
  const seen = new Set<string>();

  for (const round of doc.rounds) {
    for (const entry of round.entries) {
      if (entry.elementsObserved.length > 0) {
        for (const element of entry.elementsObserved) {
          const key = `${entry.area}: ${element}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push(key);
          }
        }
      } else {
        if (!seen.has(entry.area)) {
          seen.add(entry.area);
          items.push(entry.area);
        }
      }
    }
  }

  return items.length > 0 ? items : null;
}

/**
 * Build a prompt section that provides existing discovery content for round 2+.
 * Instructs Claude to review what was already covered and focus on gaps.
 */
export function buildDiscoveryContextPrompt(existingContent: string): string {
  return `## Previous Discovery (from earlier rounds)

The following areas have already been explored in previous rounds. Review this to understand what has been covered, then focus on:
- Areas or sub-areas that were not visited
- Elements that were observed but not thoroughly checked
- Evaluation criteria that were missed in previously visited areas
- Deeper investigation of areas where only surface-level checks were done

${existingContent}

Use this information to guide your analysis. Do NOT re-document areas you've already covered unless you find new elements or issues. Add new entries for newly discovered areas and append to existing area entries if you check additional criteria.`;
}
