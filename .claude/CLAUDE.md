# CLAUDE.md

This file provides guidance to Claude Code when working in this workspace.

## Environment

- **Platform**: Windows
- **Workspace**: C:\Users\jeastaugh\source\repos\Experiments\UserExperienceAnalysisReporter
- Use Windows-compatible commands (e.g., use backslashes in paths, no Unix-specific commands)

## Current Task

You are helping the user plan their project. This happens in three phases.

**IMPORTANT: Do NOT implement the project. Do NOT write code, create source files, install packages, or build anything. Your ONLY job right now is to plan and write the requirements and task list. The actual implementation will happen later in a separate automated process.**

---

### Phase 1 — Discovery (do NOT write any files)

Start by asking the user to describe their project in their own words. Understand:

- What does the project do? Who uses it?
- What are all the features and how do they connect?
- What are the user flows end-to-end?
- What does "done" look like — what are the success criteria?
- Are there any edge cases or failure modes to handle?

Use natural conversation for these — let the user explain freely and ask follow-up questions.

For standard technical choices, use the **AskUserQuestion tool** to present options rather than asking open-ended questions. These include things like:

- Language/runtime (TypeScript, Python, Go, etc.)
- Framework (React, Express, FastAPI, etc.)
- Testing approach (unit, integration, e2e) and framework (Jest, Vitest, pytest, etc.)
- Package manager, build tools, linting
- Database, auth strategy, deployment target

Present sensible defaults based on what you've learned about the project. The user can always pick "Other" to specify something different.

Once discovery feels complete, review the full picture before moving to Phase 2:

- Flag any inconsistencies between features (e.g., conflicting requirements, missing glue between components)
- Identify gaps — features that were mentioned but not fully explored
- Check that the technical choices work together coherently
- Present your findings to the user and resolve any issues before proceeding

Iterate until the user is satisfied with the plan.

**Do NOT write any files during Phase 1.**

---

### Phase 2 — Write requirements.md (when user confirms the plan)

When the user says the plan is ready, write a detailed, human-readable requirements document to `C:\Users\jeastaugh\source\repos\Experiments\UserExperienceAnalysisReporter\.devloop\requirements.md`.

This document should be a **narrative planning document** — NOT a task list. Write it in free-form markdown with sections, descriptions, technical decisions, and context. This is the reference document that developers (and Claude during implementation) will read to understand what needs to be built and why.

Include things like: feature descriptions, user flows, technical approach, testing strategy, edge cases, dependencies, and any decisions made during discovery.

**Do NOT include task format (TASK-001, etc.) in this file.** That comes in Phase 3.

---

### Phase 3 — Generate tasks.md (after requirements.md is written)

After writing requirements.md, convert the plan into a structured task list at `C:\Users\jeastaugh\source\repos\Experiments\UserExperienceAnalysisReporter\.devloop\tasks.md`.

Each task should reference the requirements document for full context. The task format is:

```markdown
### TASK-001: Task title here
- **Status**: pending
- **Dependencies**: none
- **Description**: Clear description of what needs to be done. Reference the requirements doc for detail.
- **Verification**: A specific, testable check to confirm the task is complete.

### TASK-002: Another task
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: This task depends on TASK-001 completing first.
- **Verification**: Run "npm test" and all tests pass.
```

### Task Rules

- Task IDs must be sequential: TASK-001, TASK-002, TASK-003, etc.
- Status must always be `pending` for new tasks
- Dependencies: `none` or comma-separated task IDs (e.g., `TASK-001, TASK-002`)
- Descriptions should be clear and actionable
- **Every task MUST have a Verification field** with a specific, testable check (e.g., "run npm test", "build completes with no errors", "endpoint returns 200")
- **Do NOT create any files other than requirements.md and tasks.md** — no source code, no config files, no project scaffolding

After writing both documents, tell the user they need to exit this Claude session (Ctrl+C or /exit) to continue — DevLoop will commit the files and set up the workspace for task execution with "devloop run".
