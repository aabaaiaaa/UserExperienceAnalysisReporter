# Iteration 13 Tasks

See `.devloop/requirements.md` for full narrative context. Each task references the relevant section(s) there.

### TASK-001: Rename `append` → `cleanExisting` with inverted polarity in file-manager
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/file-manager.ts`, rename the `append?: boolean` parameter to `cleanExisting: boolean = true` on both `initOutputDir` (line 154) and `initWorkspace` (line 172). Invert polarity: the old meaning of `append: true` becomes `cleanExisting: false`. Update the `rmSync` guard at line 158 from `if (existsSync(outputDir) && !append)` to `if (existsSync(outputDir) && cleanExisting)`. Update the `debug(...)` line 156 to reflect the new flag (e.g., `${cleanExisting ? '' : ' (preserve mode)'}`). Update `initWorkspace` to forward the new flag. Also update both JSDoc blocks to reflect the new parameter name, default, and meaning. Default MUST be `true` to preserve existing behavior for callers that omit the arg. Do NOT change any call sites in this task — that's TASK-002. See requirements.md "Part A".
- **Verification**: `npx tsc --noEmit src/file-manager.ts` exits 0 and no errors are reported for file-manager.ts itself. (Call sites in orchestrator.ts/plan-orchestrator.ts will still pass old-shape args and may compile cleanly since `append` was optional and `cleanExisting` has a default — type-check should still succeed.)

### TASK-002: Update call sites in orchestrator and plan-orchestrator (implements A2)
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: Update the two `initWorkspace` call sites to use the new `cleanExisting` parameter:
  - `src/orchestrator.ts:115` — change `await initWorkspace(args.instances, args.output, args.append)` to `await initWorkspace(args.instances, args.output, !args.append)`. The CLI `--append` flag keeps its external meaning ("preserve existing output"); we invert at the call boundary.
  - `src/plan-orchestrator.ts:93` — change `await initWorkspace(args.instances, args.output)` to `await initWorkspace(args.instances, args.output, false)`. Add a brief comment above the line explaining that `cleanExisting: false` preserves the output directory because the plan subcommand only writes a small fixed file set and wiping is unnecessary and dangerous (reference requirements.md Part A / safety guard A3).
  This single change implements A2 from iteration 12 — the plan subcommand will no longer invoke `rmSync` on the output path. See requirements.md "Part A — Call site updates".
- **Verification**: `npx tsc --noEmit` exits 0 (full project type-check — cheap, validates the rename cleanly integrates at both call sites).

### TASK-003: Update existing file-manager tests for the renamed parameter
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: In `tests/file-manager.test.ts`, update the two call sites that pass the boolean flag directly:
  - Line 142: `initOutputDir(undefined, true);` → `initOutputDir(undefined, false);` (preserve-mode invocation under inverted polarity)
  - Line 149: `initOutputDir('./test-output-custom', true);` → `initOutputDir('./test-output-custom', false);`
  Also rename any surrounding describe/it strings that reference "append mode" to "preserve mode" or equivalent to keep intent clear. Do NOT add new tests in this task — TASK-005 and TASK-006 handle that.
- **Verification**: `npx vitest run tests/file-manager.test.ts` — all existing tests pass (16 tests, same count as before).

### TASK-004: Add assertSafeRemovalTarget helper in file-manager (A3 guard + debug log)
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: In `src/file-manager.ts`, add a private helper `assertSafeRemovalTarget(targetPath: string): void` that throws a descriptive Error when `targetPath` resolves to any of:
  - The current working directory (`process.cwd()`)
  - An ancestor of the current working directory
  - The user's home directory (`os.homedir()`)
  - A filesystem root (derived via `path.parse(target).root`)
  Implementation requirements:
  - Canonicalize both the target and each comparison path via `fs.realpathSync.native()`; fall back to `path.resolve()` when `realpathSync` throws.
  - On Windows (`process.platform === 'win32'`), lowercase both sides before comparison. Unix stays case-sensitive.
  - Use `path.sep` (not a hardcoded `'/'`) for the ancestor check: `cwd.startsWith(target + sep)`.
  - Error messages must name the offending category and tell the user how to recover. Example: `Refusing to delete output directory <target>: it is the current working directory. Choose a different --output path (e.g. --output ./uxreview-output).`
  Add required imports at the top of the file: `realpathSync` from `node:fs`, `homedir` from `node:os`, `parse as parsePath` and `sep` from `node:path` (merge with existing imports from `node:fs` and `node:path`).
  Call `assertSafeRemovalTarget(outputDir)` inside `initOutputDir`, immediately before `rmSync` at line 159 (but inside the existing `if` block). Add a `debug('Removing existing output directory: ${outputDir}')` call on the line immediately before the `assertSafeRemovalTarget` call. Order must be: `debug(...)` → `assertSafeRemovalTarget(...)` → `rmSync(...)`. See requirements.md "Part B".
- **Verification**: `npx tsc --noEmit src/file-manager.ts` exits 0 with no errors.

### TASK-005: Add unit tests for the safety guard in file-manager.test.ts
- **Status**: pending
- **Dependencies**: TASK-004, TASK-003
- **Description**: Add a new describe block in `tests/file-manager.test.ts` (grouped near the existing `initOutputDir` tests) with seven tests per requirements.md "Part C — Unit tests for the safety guard":
  1. Refuses when target equals cwd (call `initOutputDir('.')`, assert throw with message matching `/current working directory/i`).
  2. Refuses when target is an ancestor of cwd (chdir into a nested temp dir then call with `'..'` or equivalent; assert throw matching `/ancestor/i`).
  3. Refuses when target equals home (`initOutputDir(os.homedir())`; assert throw matching `/home directory/i`).
  4. Refuses when target equals a filesystem root (`initOutputDir(path.parse(process.cwd()).root)`; assert throw matching `/filesystem root/i`).
  5. Case-insensitive on Windows only (use `it.runIf(process.platform === 'win32')` or skip helper; call with cwd lowercased/uppercased; assert throw).
  6. Safe target does NOT throw (call `initOutputDir('./test-output-safe')` in a clean temp dir; assert the directory exists and contains a `screenshots/` subdirectory).
  7. Error message contains the `--output` recovery hint (trigger any failure above; assert message contains `--output`).
  Use the existing `beforeEach/afterEach` patterns in the test file for temp directory setup/cleanup. Be careful in test 2: the guard throws BEFORE `rmSync` fires, so the parent directory is never actually deleted — but assert no removal occurred just in case (e.g., verify the parent still exists after the throw).
- **Verification**: `npx vitest run tests/file-manager.test.ts` — all tests pass, test count increases by at least 6 (test 5 is Windows-only and may skip on CI).

### TASK-006: Add regression test + main-subcommand protection test
- **Status**: pending
- **Dependencies**: TASK-002, TASK-005
- **Description**: Two small tests, each in the file that corresponds to the protected code path:
  1. **In `tests/plan-orchestrator.test.ts`**: add a test named something like `'calls initWorkspace with cleanExisting=false to preserve output directory'`. Use the existing `mockInitWorkspace` (line 148). Run through `runPlanDiscovery` with standard fixture args and assert `expect(mockInitWorkspace).toHaveBeenCalledWith(expect.any(Number), expect.any(String), false)`. This is the regression test for TASK-002 — if someone later drops the third argument or flips it to `true`, this test fails.
  2. **In `tests/file-manager.test.ts`** (new describe block "main subcommand protection" or similar): add a test confirming `initOutputDir('.')` throws with `/current working directory/i`. Include a comment in the test body explaining that `initOutputDir` is the single chokepoint every subcommand (plan or main) flows through, so a direct test here proves end-to-end protection for the main `uxreview` subcommand. See requirements.md "Part C — Integration test".
- **Verification**: `npx vitest run tests/plan-orchestrator.test.ts tests/file-manager.test.ts` — all tests pass; test count increases by 2.
