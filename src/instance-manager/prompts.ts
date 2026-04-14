import type { InstanceConfig } from './types.js';
import { getInstancePaths } from '../file-manager.js';
import { buildDiscoveryInstructions, buildDiscoveryContextPrompt, readDiscoveryContent } from '../discovery.js';
import { buildReportInstructions } from '../report.js';
import { buildScreenshotInstructions } from '../screenshots.js';

/**
 * Build the prompt sent to a Claude Code instance for UX analysis.
 *
 * Includes the intro doc, plan chunk, evaluation scope, and instructions
 * for writing to the instance's discovery doc, checkpoint file, and report doc.
 */
export function buildInstancePrompt(config: InstanceConfig): string {
  const paths = getInstancePaths(config.instanceNumber);
  const roundNumber = config.round ?? 1;

  // Build discovery context for round 2+
  let discoveryContext = '';
  if (roundNumber > 1) {
    const existingDiscovery = readDiscoveryContent(config.instanceNumber);
    if (existingDiscovery) {
      discoveryContext = '\n' + buildDiscoveryContextPrompt(existingDiscovery) + '\n';
    }
  }

  return `You are a UX analyst reviewing a web application. Your job is to navigate the app, evaluate the user experience, and document your findings.

## Target Application

URL: ${config.url}

## Application Context

${config.intro}

## Your Assigned Review Areas

${config.planChunk}

## Evaluation Scope

Evaluate the application against the following criteria:

${config.scope}
${discoveryContext}
## Output Instructions

You must continuously write to three files as you work. Do NOT wait until the end — update these files after each significant action.

Current round: ${roundNumber}

${buildDiscoveryInstructions(config.instanceNumber, paths.discovery)}

### 2. Checkpoint File: ${paths.checkpoint}
**CRITICAL: Update this checkpoint file FREQUENTLY.** Write to it after EVERY page navigation, EVERY screenshot taken, and EVERY finding recorded. Do NOT wait until an area is complete — update the checkpoint as you go, after each individual action. This file is how the user tracks your progress in real time, so frequent updates are essential for the user experience.

Write a JSON checkpoint with this EXACT structure:
\`\`\`json
{
  "instanceId": ${config.instanceNumber},
  "assignedAreas": ["area1", "area2"],
  "currentRound": ${roundNumber},
  "areas": [
    { "name": "area1", "status": "complete" },
    { "name": "area2", "status": "in-progress" },
    { "name": "area3", "status": "not-started" }
  ],
  "lastAction": "description of last completed step",
  "timestamp": "ISO timestamp"
}
\`\`\`
Each area's status must be exactly one of: "complete", "in-progress", or "not-started".

${buildReportInstructions(config.instanceNumber, paths.report)}

${buildScreenshotInstructions(config.instanceNumber, paths.screenshots)}

## Process

1. Start by reading any existing checkpoint file to see if you need to resume from a previous point.
2. Navigate to the target URL and follow the application context instructions.
3. Work through each of your assigned review areas systematically.
4. For each area, evaluate against every criterion in the evaluation scope.
5. Document findings immediately as you discover them.
6. Update the checkpoint after every navigation, screenshot, and finding — not just at area boundaries.
7. When all assigned areas are reviewed, ensure all files are fully written.

Begin your review now.`;
}

/**
 * Build the prompt sent to a Claude Code instance for discovery/exploration.
 *
 * Similar to buildInstancePrompt but removes report/findings instructions
 * and reframes the task as exploration and documentation rather than evaluation.
 */
export function buildDiscoveryPrompt(config: InstanceConfig): string {
  const paths = getInstancePaths(config.instanceNumber);
  const roundNumber = config.round ?? 1;

  const hasPlanChunk = config.planChunk.trim().length > 0;

  const areasSection = hasPlanChunk
    ? `## Areas to Explore

${config.planChunk}`
    : `## Exploration Scope

No specific areas have been assigned. Explore the entire site freely starting from the target URL. Systematically discover and document all pages, features, and UI elements you can find.`;

  const scopeSection = config.scope.trim().length > 0
    ? `## Exploration Guidance

The following topics describe things to look for during exploration. As you navigate, note what is relevant but do not produce findings or severity ratings — just document what you observe.

${config.scope}`
    : '';

  return `You are a UX explorer documenting a web application. Your job is to navigate the app, map out its structure, and document everything you find.

## Target Application

URL: ${config.url}

## Application Context

${config.intro}

${areasSection}
${scopeSection ? '\n' + scopeSection + '\n' : ''}
## Output Instructions

You must continuously write to two files as you work. Do NOT wait until the end — update these files after each significant action.

Current round: ${roundNumber}

${buildDiscoveryInstructions(config.instanceNumber, paths.discovery)}

### 2. Checkpoint File: ${paths.checkpoint}
**CRITICAL: Update this checkpoint file FREQUENTLY.** Write to it after EVERY page navigation, EVERY screenshot taken, and EVERY area explored. Do NOT wait until an area is complete — update the checkpoint as you go, after each individual action. This file is how the user tracks your progress in real time, so frequent updates are essential for the user experience.

Write a JSON checkpoint with this EXACT structure:
\`\`\`json
{
  "instanceId": ${config.instanceNumber},
  "assignedAreas": ["area1", "area2"],
  "currentRound": ${roundNumber},
  "areas": [
    { "name": "area1", "status": "complete" },
    { "name": "area2", "status": "in-progress" },
    { "name": "area3", "status": "not-started" }
  ],
  "lastAction": "description of last completed step",
  "timestamp": "ISO timestamp"
}
\`\`\`
Each area's status must be exactly one of: "complete", "in-progress", or "not-started".

${buildScreenshotInstructions(config.instanceNumber, paths.screenshots)}

## Process

1. Start by reading any existing checkpoint file to see if you need to resume from a previous point.
2. Navigate to the target URL and follow the application context instructions.
3. Systematically explore ${hasPlanChunk ? 'your assigned areas' : 'the entire site'}.
4. For each area: take screenshots, document navigation paths, list all UI elements and features you find.
5. Go deep — explore sub-pages, modals, dropdowns, tabs, settings panels, and any interactive elements.
6. Document everything in the discovery file.
7. Update the checkpoint after every navigation and screenshot.

Begin your exploration now.`;
}
