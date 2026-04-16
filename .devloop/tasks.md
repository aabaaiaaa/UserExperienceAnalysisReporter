# Tasks — Iteration 12

### TASK-001: Change plan subcommand default for --output to ./uxreview-plan
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/cli.ts:403-405`, change the `parsePlanArgs` default for `output` from `'.'` to `'./uxreview-plan'`. Update the help text at `src/cli.ts:84` from `(default: . current directory)` to `(default: ./uxreview-plan)`. Update the three assertions in `tests/cli.test.ts` that currently expect `'.'` (lines 264, 322-325, 454) to expect `'./uxreview-plan'`, and rename the test name at line 322 from `'defaults output to "."'` to `'defaults output to "./uxreview-plan"'`. Search `README.md` for any mention of the `.` default for plan and update. See requirements.md → Part A → A1 for full context and rationale.
- **Verification**: `npx vitest run tests/cli.test.ts` — all tests pass, including the renamed/updated assertions.

### TASK-002: Skip output-dir cleanup in plan mode
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/plan-orchestrator.ts:93`, change `await initWorkspace(args.instances, args.output)` to `await initWorkspace(args.instances, args.output, true)` to pass `append=true`, which causes `initOutputDir` to skip the destructive `rmSync` call. Add a comment above the call explaining the rationale: the plan subcommand only writes a fixed small set of files (`plan.md`, `discovery.html`, `discovery.md`, `screenshots/`), and `writeFileSync`/`mkdirSync({recursive: true})` are idempotent, so wiping is unnecessary and dangerous. See requirements.md → Part A → A2 for full context and rationale (including the acknowledged tradeoff about stale screenshots).
- **Verification**: `npx vitest run tests/plan-orchestrator.test.ts` — all existing tests pass with no behavior regression.

### TASK-003: Add refuse-to-delete safety guard in initOutputDir
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/file-manager.ts`, add a new private helper `assertSafeRemovalTarget(targetPath: string): void` that throws a descriptive `Error` if the resolved target is the cwd, an ancestor of the cwd, the user's home directory, or a filesystem root. Call it from `initOutputDir` immediately before the `rmSync(outputDir, ...)` line (`src/file-manager.ts:159`). Use `fs.realpathSync.native()` to canonicalize symlinks (with fallback to `path.resolve` if it throws). On Windows (`process.platform === 'win32'`), lowercase both sides for case-insensitive comparison. Use `path.sep` for ancestor checks. Add the necessary imports: `homedir` from `node:os` and `realpathSync` from `node:fs`. Add tests in `tests/file-manager.test.ts` covering: throws when target equals cwd; throws when target is an ancestor of cwd; throws when target equals home; throws when target equals a filesystem root; on Windows, throws when target equals cwd with different case (skip on non-Windows or guard with `process.platform`); does NOT throw for a safe target like a subdirectory; error message contains the offending category name. See requirements.md → Part A → A3 for full implementation notes and example error message.
- **Verification**: `npx vitest run tests/file-manager.test.ts` — all tests pass, including the new safety-guard tests.

### TASK-004: Raise instance-manager/spawning.ts branch coverage above 95%
- **Status**: done
- **Dependencies**: none
- **Description**: Add tests in `tests/instance-manager.test.ts` (or create `tests/spawning.test.ts` if a dedicated file is preferred) covering the three uncovered branches in `src/instance-manager/spawning.ts`: (1) Line 85 — call `spawnInstanceWithResume` with a config that includes a custom `promptBuilder`; spy on `runClaude` and assert the prompt argument contains the custom builder's output. (2) Line 105 — mock `runClaude` to throw a real `Error` instance; call `spawnInstanceWithResume` with a valid checkpoint; assert returned state is `{status: 'failed', error: <message>}`. (3) Line 109 — mock `runClaude` to throw a non-Error value (e.g., a string `'string rejection reason'`); assert `state.error === 'string rejection reason'`. See requirements.md → Part B → B1 for line numbers and rationale.
- **Verification**: `npx vitest run --coverage tests/instance-manager.test.ts` — confirm `instance-manager/spawning.ts` branch coverage is above 95% (was 89.28%).

### TASK-005: Raise instance-manager/rounds.ts branch coverage above 95%
- **Status**: done
- **Dependencies**: none
- **Description**: Add a focused test (preferably in `tests/coverage-gaps.test.ts`, or alternatively `tests/round-execution.test.ts`) that triggers the falsy-`state.error` branches at lines 176-182, 217, and 225 of `src/instance-manager/rounds.ts`. The test should: (1) mock `runClaude` to consistently return `{success: false, exitCode: 0, stdout: '', stderr: ''}` so `state.error` is undefined/falsy; (2) configure `maxRetries: 1` so the retry loop exhausts quickly; (3) call `runInstanceRounds` and assert that `cb.onFailure`, `cb.onPermanentlyFailed`, and entries in `result.retries[0].errors` all receive the literal string `'Unknown error'` (the falsy fallback). Investigate the existing tests in `tests/round-execution.test.ts`, `tests/coverage-gaps.test.ts`, and `tests/instance-manager.test.ts` first to avoid duplicating tests already present. See requirements.md → Part B → B2 for line numbers and rationale.
- **Verification**: `npx vitest run --coverage tests/round-execution.test.ts tests/coverage-gaps.test.ts tests/instance-manager.test.ts` — confirm `instance-manager/rounds.ts` branch coverage is above 95% (was 93.15%).

### TASK-006: Add global test timeout to vitest.config.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `vitest.config.ts`, add `testTimeout: 10000` to the `test` block (between the `exclude` line and the `coverage` block). This sets a 10-second per-test timeout to prevent recurrence of the iteration 10 plan-signal-test timeout regression as the codebase grows. No source or other test changes needed. See requirements.md → Part B → B3 for full context.
- **Verification**: `npx vitest run tests/cli.test.ts` — config loads and tests run without error (a small targeted run is sufficient to confirm the config change is valid).
