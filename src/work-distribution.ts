import { writeFileSync } from 'node:fs';
import { runClaude } from './claude-cli.js';
import { getWorkDistributionPath } from './file-manager.js';

export interface WorkDistributionResult {
  /** The plan chunks, one per instance (indexed 0..N-1) */
  chunks: string[];
  /** Whether the Claude CLI was called to split the plan */
  usedClaude: boolean;
}

/**
 * Build the prompt that asks Claude to split a review plan into N chunks.
 */
export function buildDistributionPrompt(plan: string, instanceCount: number): string {
  return `You are a work distribution assistant. Your job is to divide a UX review plan into ${instanceCount} self-contained chunks for parallel execution by separate reviewers.

RULES:
- Each chunk must be a self-contained set of areas/flows to review.
- Minimize overlap between chunks — each area should appear in exactly one chunk.
- Ensure full coverage — every item in the original plan must appear in exactly one chunk.
- Keep related items together (e.g., a page and its sub-flows belong in the same chunk).
- Balance the chunks so each has roughly equal work.

OUTPUT FORMAT:
Respond with exactly ${instanceCount} chunks, separated by the delimiter line "---CHUNK---".
Each chunk should contain the relevant sections of the plan as-is (preserve the original text).
Do NOT add commentary, headers, or explanations — only the plan text for each chunk, separated by the delimiter.

REVIEW PLAN TO SPLIT:

${plan}`;
}

/**
 * Parse Claude's response into individual chunks.
 * Expects chunks separated by "---CHUNK---" delimiter lines.
 */
export function parseDistributionResponse(response: string, expectedCount: number): string[] {
  const chunks = response
    .split(/^---CHUNK---$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length !== expectedCount) {
    throw new Error(
      `Work distribution expected ${expectedCount} chunks but got ${chunks.length}. ` +
        `Claude may have produced malformed output.`,
    );
  }

  return chunks;
}

/**
 * Format the work distribution result as markdown for storage.
 */
function formatDistributionMarkdown(chunks: string[], usedClaude: boolean): string {
  const lines: string[] = ['# Work Distribution', ''];

  if (!usedClaude) {
    lines.push('Single instance — full plan passed through directly (no Claude call).', '');
  } else {
    lines.push(`Plan split into ${chunks.length} chunks via Claude.`, '');
  }

  for (let i = 0; i < chunks.length; i++) {
    lines.push(`## Instance ${i + 1}`, '');
    lines.push(chunks[i], '');
  }

  return lines.join('\n');
}

/**
 * Distribute a review plan across N instances.
 *
 * - If instanceCount is 1, returns the full plan directly without calling Claude.
 * - If instanceCount > 1, calls Claude to split the plan into logical chunks.
 *
 * Writes the distribution result to `.uxreview-temp/work-distribution.md`.
 */
export async function distributePlan(
  plan: string,
  instanceCount: number,
): Promise<WorkDistributionResult> {
  if (instanceCount < 1) {
    throw new Error('Instance count must be at least 1');
  }

  // Single instance: skip Claude call, pass full plan through
  if (instanceCount === 1) {
    const result: WorkDistributionResult = {
      chunks: [plan],
      usedClaude: false,
    };

    const markdown = formatDistributionMarkdown(result.chunks, result.usedClaude);
    writeFileSync(getWorkDistributionPath(), markdown, 'utf-8');

    return result;
  }

  // Multiple instances: call Claude to split the plan
  const prompt = buildDistributionPrompt(plan, instanceCount);
  const cliResult = await runClaude({ prompt });

  if (!cliResult.success) {
    throw new Error(
      `Claude CLI failed during work distribution (exit code ${cliResult.exitCode}): ${cliResult.stderr}`,
    );
  }

  const chunks = parseDistributionResponse(cliResult.stdout, instanceCount);

  const result: WorkDistributionResult = {
    chunks,
    usedClaude: true,
  };

  const markdown = formatDistributionMarkdown(result.chunks, result.usedClaude);
  writeFileSync(getWorkDistributionPath(), markdown, 'utf-8');

  return result;
}
