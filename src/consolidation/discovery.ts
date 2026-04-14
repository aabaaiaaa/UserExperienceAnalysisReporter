import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from '../claude-cli.js';
import { withRateLimitRetry, sleep, RateLimitRetryState } from '../rate-limit.js';
import { debug } from '../logger.js';
import { readDiscoveryContent } from '../discovery.js';

// ---- Discovery Document Consolidation (TASK-021) ----

/**
 * Result of the discovery document consolidation.
 */
export interface DiscoveryConsolidationResult {
  /** The consolidated discovery document content (markdown) */
  content: string;
  /** Number of instance discovery docs that were read */
  instanceCount: number;
  /** Whether Claude CLI was called for consolidation */
  usedClaude: boolean;
}

/**
 * Read all per-instance discovery documents and return them as
 * an array of { instanceNumber, content } pairs.
 *
 * Skips instances whose discovery doc is missing or empty.
 */
export function readAllDiscoveryDocs(
  instanceNumbers: number[],
): { instanceNumber: number; content: string }[] {
  const docs: { instanceNumber: number; content: string }[] = [];

  for (const num of instanceNumbers) {
    const content = readDiscoveryContent(num);
    if (content && content.trim()) {
      docs.push({ instanceNumber: num, content });
    }
  }

  return docs;
}

/**
 * Build the prompt that asks Claude to merge multiple per-instance discovery
 * documents into a single consolidated, deduplicated, hierarchical document.
 *
 * The output format is designed to be reusable as a review plan for future runs.
 */
export function buildDiscoveryConsolidationPrompt(
  docs: { instanceNumber: number; content: string }[],
): string {
  const docsList = docs
    .map(
      (d) =>
        `--- INSTANCE ${d.instanceNumber} DISCOVERY ---\n${d.content}\n--- END INSTANCE ${d.instanceNumber} ---`,
    )
    .join('\n\n');

  return `You are a document consolidation assistant. Below are discovery documents from ${docs.length} independent reviewers who each explored parts of the same web application. Each document lists UI areas visited, elements observed, and what was checked.

Your job is to merge these into a SINGLE consolidated discovery document that:

1. DEDUPLICATES overlapping areas — if multiple instances visited the same area, merge their observations into one entry (combine elements observed and criteria checked, don't repeat).
2. STRUCTURES the output as an indented hierarchy of UI areas and their specific features/elements.
3. FORMATS the output so it can be reused as a review plan for a future run of the tool.

OUTPUT FORMAT:
Use this exact markdown format. Each top-level heading is a UI area. Under each area, list the specific features, elements, and sub-areas as a nested bullet list. Include what was checked for each.

\`\`\`
# [UI Area Name]

- [Feature/Element]
  - Checked: [what was evaluated]
- [Feature/Element]
  - Checked: [what was evaluated]
  - Sub-elements:
    - [Sub-element detail]

# [Another UI Area]

- [Feature/Element]
  - Checked: [what was evaluated]
\`\`\`

RULES:
- Merge observations from different instances for the same area into one section.
- Keep all unique elements and checks — do not discard observations, only deduplicate exact repetitions.
- Order areas logically (e.g., navigation first, then main content areas, then settings/footer).
- The document should read as a comprehensive map of what was explored, suitable for planning future review passes.
- Do NOT include instance numbers, timestamps, or navigation paths in the output — those are internal tracking details.
- Output ONLY the consolidated document in the format above. No commentary or explanation.

DISCOVERY DOCUMENTS:

${docsList}`;
}

/**
 * Consolidate multiple per-instance discovery documents into a single document.
 *
 * If only one instance produced a discovery doc, restructures it without a Claude call.
 * For multiple docs, uses Claude to merge, deduplicate, and hierarchically structure them.
 */
export async function consolidateDiscoveryDocs(
  instanceNumbers: number[],
): Promise<DiscoveryConsolidationResult> {
  const docs = readAllDiscoveryDocs(instanceNumbers);

  if (docs.length === 0) {
    return { content: '', instanceCount: 0, usedClaude: false };
  }

  if (docs.length === 1) {
    // Single doc — still use Claude to restructure into the hierarchical plan format
    const prompt = buildDiscoveryConsolidationPrompt(docs);
    const result = await withRateLimitRetry(() => runClaude({ prompt }), { sleepFn: sleep });

    if (!result.success) {
      // Fallback: return the raw content if Claude fails
      return { content: docs[0].content, instanceCount: 1, usedClaude: false };
    }

    return { content: result.stdout.trim(), instanceCount: 1, usedClaude: true };
  }

  // Multiple docs — use Claude to merge and deduplicate
  const prompt = buildDiscoveryConsolidationPrompt(docs);
  const result = await withRateLimitRetry(() => runClaude({ prompt }), { sleepFn: sleep });

  if (!result.success) {
    throw new Error(
      `Claude CLI failed during discovery consolidation (exit code ${result.exitCode}): ${result.stderr}`,
    );
  }

  return { content: result.stdout.trim(), instanceCount: docs.length, usedClaude: true };
}

/**
 * Write the consolidated discovery document to the output directory.
 */
export function writeConsolidatedDiscovery(outputDir: string, content: string): void {
  const outputPath = join(outputDir, 'discovery.md');
  writeFileSync(outputPath, content + '\n', 'utf-8');
}

/**
 * Generate a plan template from consolidated discovery content using Claude.
 *
 * Transforms raw discovery content (areas, navigation paths, elements, sub-areas)
 * into a structured plan with `## Area` headings and `- Sub-area` bullets,
 * which is the format expected by `extractAreasFromPlanChunk()`.
 *
 * Falls back to returning the raw discovery content if the Claude call fails.
 */
export async function generatePlanTemplate(
  discoveryContent: string,
  retryState?: RateLimitRetryState,
): Promise<string> {
  const prompt = `You are a UX analysis planning assistant. Below is raw discovery content from analyzing a web application. It contains information about UI areas, navigation paths, interactive elements, and sub-areas.

Transform this into a clean plan template using the following format:
- Use ## headings for each top-level area (e.g., ## Navigation, ## Dashboard)
- Under each area heading, use bullet points (- ) for sub-areas or features
- Keep entries concise but include enough detail to know what each area covers
- Order logically: navigation/header first, then main content areas, then settings/footer last
- Output ONLY the plan document — no commentary, no instructions, no markdown fences

DISCOVERY CONTENT:

${discoveryContent}`;

  try {
    const result = await withRateLimitRetry(
      () => runClaude({ prompt }),
      { sleepFn: sleep, retryState },
    );

    if (!result.success) {
      debug(`generatePlanTemplate: Claude call failed (exit ${result.exitCode}): ${result.stderr}`);
      return discoveryContent;
    }

    return result.stdout;
  } catch (err) {
    debug(`generatePlanTemplate: exception during Claude call: ${err}`);
    return discoveryContent;
  }
}
