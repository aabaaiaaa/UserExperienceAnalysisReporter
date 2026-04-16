# UX Analysis Reporter — Iteration 13 Requirements

## Overview

Iteration 12 shipped only three of six planned tasks correctly. The critical data-loss hazard that motivated that iteration — `rmSync` silently wiping a user's current working directory on macOS/Linux when `--output .` is passed — is only partially mitigated. A1 (changing the plan subcommand default) landed, but A2 (skipping `rmSync` in plan mode) and A3 (the refuse-to-delete guard) were marked `done` without any implementation.

The full review for iteration 12 lives at `.devloop/archive/iteration-10/review.md`. It confirms:

- `src/plan-orchestrator.ts:93` still calls `initWorkspace(args.instances, args.output)` with no third argument, so `initOutputDir` still wipes the resolved output path.
- No `assertSafeRemovalTarget` helper exists. `src/file-manager.ts:154-166` is unchanged from iteration 11. No cwd/home/root checks exist. No new tests.
- The main `uxreview` subcommand is entirely unchanged — `uxreview --url X --output .` still reaches the `rmSync` path.

Iteration 13 is a **focused follow-up iteration** that completes the A2/A3 work and lands two small quality-of-life improvements the iteration 12 reviewer flagged as non-blocking polish. Part B of iteration 12 (coverage carryovers, global test timeout) is already complete and is not revisited here.

---

## Scope

Five changes, all narrow:

1. **Rename `append` → `cleanExisting` with inverted polarity** in `initOutputDir` and `initWorkspace`. The boolean flag currently means "preserve existing" to callers and "skip `rmSync`" to the implementation — a footgun. Inverting to `cleanExisting` (with `false` as the safe/preserve default) makes call sites self-documenting and, importantly, lets us implement A2 cleanly as `cleanExisting: false` at the plan call site.
2. **Implement A2** (`src/plan-orchestrator.ts:93`): pass `cleanExisting: false` so the plan subcommand never wipes the output directory. This fold-in is part of change 1 above.
3. **Implement A3**: add `assertSafeRemovalTarget` to `src/file-manager.ts`, called immediately before `rmSync`, refusing to delete cwd / ancestor-of-cwd / home / filesystem root.
4. **Debug log before `rmSync`**: add a `debug()` line immediately before the destructive removal so future bug reports can correlate.
5. **Integration-style test**: verify the main `uxreview` subcommand also refuses `--output .` (not only plan), since A3 protects every entry point but only plan had an explicit bug report.

Also: add a regression test that verifies `plan-orchestrator` passes `cleanExisting: false` to `initWorkspace`. The iteration 12 reviewer specifically noted that no test catches `plan-orchestrator.ts:93`'s call-signature shape — mock-based tests in `tests/plan-orchestrator.test.ts` don't detect it.

---

## Part A — Rename `append` → `cleanExisting` (inverted polarity)

### Current shape

`src/file-manager.ts:154-166`:

```typescript
export function initOutputDir(outputPath?: string, append?: boolean): string {
  const outputDir = resolve(outputPath || DEFAULT_OUTPUT_DIR);
  debug(`Initializing output directory: ${outputDir}${append ? ' (append mode)' : ''}`);

  if (existsSync(outputDir) && !append) {
    rmSync(outputDir, { recursive: true, force: true });
  }

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });

  return outputDir;
}
```

`src/file-manager.ts:172-182` forwards the same flag to `initOutputDir`:

```typescript
export async function initWorkspace(instanceCount: number, outputPath?: string, append?: boolean): Promise<WorkspaceLayout> {
  const tempDir = await initTempDir(instanceCount);
  const outputDir = initOutputDir(outputPath, append);
  ...
}
```

Call sites today:

- `src/orchestrator.ts:115` — `await initWorkspace(args.instances, args.output, args.append)`. Main subcommand passes the CLI `--append` flag straight through.
- `src/plan-orchestrator.ts:93` — `await initWorkspace(args.instances, args.output)`. No third arg; `append` is undefined/falsy; output dir gets wiped.

### Target shape

```typescript
export function initOutputDir(outputPath?: string, cleanExisting: boolean = true): string {
  const outputDir = resolve(outputPath || DEFAULT_OUTPUT_DIR);
  debug(`Initializing output directory: ${outputDir}${cleanExisting ? '' : ' (preserve mode)'}`);

  if (existsSync(outputDir) && cleanExisting) {
    assertSafeRemovalTarget(outputDir);
    debug(`Removing existing output directory: ${outputDir}`);
    rmSync(outputDir, { recursive: true, force: true });
  }

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });

  return outputDir;
}

export async function initWorkspace(
  instanceCount: number,
  outputPath?: string,
  cleanExisting: boolean = true,
): Promise<WorkspaceLayout> {
  const tempDir = await initTempDir(instanceCount);
  const outputDir = initOutputDir(outputPath, cleanExisting);
  ...
}
```

Key choices:

- **Default is `true`** (clean existing) to preserve current behavior for every call site that omits the argument. Changing the default to `false` would silently turn every subcommand into append-mode.
- **Polarity inverts.** Old `append: true` ≡ new `cleanExisting: false`. Old `append: false` (or undefined) ≡ new `cleanExisting: true`.
- **Call site updates**:
  - `src/orchestrator.ts:115` — `await initWorkspace(args.instances, args.output, !args.append)`. The CLI flag `--append` keeps its user-facing name and meaning ("preserve existing"); internally we invert at the call boundary.
  - `src/plan-orchestrator.ts:93` — `await initWorkspace(args.instances, args.output, false)`. Add a comment explaining the intent:
    ```typescript
    // cleanExisting: false — the plan subcommand only writes a small fixed set of files
    // (plan.md, discovery.html, discovery.md, screenshots/). mkdirSync is idempotent and
    // writeFileSync overwrites in place, so wiping the output directory is unnecessary and
    // dangerous (see requirements.md Part A and the A3 safety guard).
    const workspace = await initWorkspace(args.instances, args.output, false);
    ```

### Test updates

Only `tests/file-manager.test.ts` passes the flag directly. Two call sites at lines 142 and 149:

- Line 142: `initOutputDir(undefined, true);` — was "enter append mode". Flip to `initOutputDir(undefined, false);` (cleanExisting=false ≡ preserve).
- Line 149: `initOutputDir('./test-output-custom', true);` → `initOutputDir('./test-output-custom', false);`.

Also rename the describe/it strings if they reference "append mode" explicitly — use "preserve mode" or similar.

All other tests mock `initWorkspace` entirely and don't care about the flag shape.

### Rejected alternatives

- **Keep `append`, just implement A2.** Leaves the footgun polarity in place; a future reader of `plan-orchestrator.ts` still has to mentally translate `true` → "skip rmSync" → "don't destroy my output dir". User explicitly chose the rename.
- **Discriminated union `{mode: 'clean'} | {mode: 'preserve'}`.** More ceremonial than the problem warrants. Boolean with an unambiguous positive name is enough.

---

## Part B — Safety guard (A3)

Add a private helper in `src/file-manager.ts` that refuses to delete a set of dangerous paths. Call it immediately before `rmSync` inside `initOutputDir`.

### Paths to refuse

- The current working directory (`process.cwd()`)
- Any ancestor of the current working directory
- The user's home directory (`os.homedir()`)
- A filesystem root (`path.parse(target).root` — e.g. `C:\`, `D:\`, `/`)

### Implementation notes

- **Canonicalize.** Resolve both the target path and each comparison path through `fs.realpathSync.native()` so symlinks and `..` segments don't sneak past the check. Fall back to `path.resolve()` when `realpathSync` throws — which can happen if the path doesn't exist on disk. In our case the guard runs after an `existsSync` check so `realpathSync` should succeed on the target, but `homedir()` / cwd / root are virtually guaranteed to resolve.
- **Case-insensitive on Windows.** When `process.platform === 'win32'`, lowercase both sides before string comparison. Unix stays case-sensitive.
- **Ancestor check.** Use `path.sep` — `cwd.startsWith(target + path.sep)` — not a hardcoded `'/'`. A simple `startsWith` is not enough because `/foo/barbaz` starts with `/foo/bar` but is not an ancestor relationship.
- **No `--force` override.** A user with a legitimate reason to wipe a dangerous path can use `rm -rf` themselves.

### Error messages

The thrown `Error` must state *which* dangerous category matched and tell the user how to recover. Suggested format:

```
Refusing to delete output directory <target>: <reason>.
Choose a different --output path (e.g. --output ./uxreview-output).
```

Where `<reason>` is one of:

- `it is the current working directory`
- `it is an ancestor of the current working directory`
- `it is the user's home directory`
- `it is a filesystem root`

### Imports to add

```typescript
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { parse as parsePath, sep } from 'node:path';
```

Merge with the existing `node:fs` / `node:path` imports at the top of the file.

### Debug log addition

Inside the same `if` block that calls `rmSync`, immediately before the `assertSafeRemovalTarget(outputDir)` call, add:

```typescript
debug(`Removing existing output directory: ${outputDir}`);
```

This provides a breadcrumb in logs for any future data-loss investigation. The exact ordering (debug → assert → rmSync) is important: if the assertion throws, users still see the log line and know what path the tool tried to delete.

---

## Part C — Testing

### Unit tests for the safety guard

Add to `tests/file-manager.test.ts` (new describe block, ideally grouped with the existing `initOutputDir` tests):

1. **Refuses when target equals cwd.** Call `initOutputDir('.')` from within a temp directory and expect it to throw. Error message must contain "current working directory".
2. **Refuses when target is an ancestor of cwd.** Chdir into a nested temp subdirectory, then call `initOutputDir('..')` (or similar resolving upward). Expect throw; error message must contain "ancestor".
3. **Refuses when target equals home.** Call `initOutputDir(os.homedir())`. Expect throw; error message must contain "home directory".
4. **Refuses when target equals a filesystem root.** Call `initOutputDir` with `path.parse(process.cwd()).root` (which resolves to `C:\` on Windows or `/` on Unix). Expect throw; error message must contain "filesystem root".
5. **Case-insensitive on Windows.** Only runs on Windows (`it.runIf(process.platform === 'win32')` or skip on non-Windows). Call `initOutputDir` with cwd lowercased/uppercased; expect the same throw as test 1.
6. **Safe target does NOT throw.** Call `initOutputDir('./test-output-safe')` in a temp subdirectory; expect no throw; expect the directory to be created and `screenshots/` subdirectory present.
7. **Error message contains actionable recovery hint.** Trigger any of the failures above and assert the message contains `--output` (the CLI-level hint).

Use the existing `beforeEach/afterEach` patterns in `tests/file-manager.test.ts` that create/clean a test-output directory. Be careful in test 2 not to actually delete the parent directory — the throw should happen *before* `rmSync` fires.

### Regression test for the A2 fix

Add to `tests/plan-orchestrator.test.ts`. The existing test file already mocks `initWorkspace`, so we can spy on the call and assert its arguments:

```typescript
it('calls initWorkspace with cleanExisting=false to preserve output directory', async () => {
  // ...standard test setup...
  await runPlanDiscovery(args);
  expect(mockInitWorkspace).toHaveBeenCalledWith(
    expect.any(Number),   // instances
    expect.any(String),   // output path
    false,                // cleanExisting — preserve existing output
  );
});
```

This test fails if someone in a future iteration removes the third argument or flips it to `true`. It is the specific regression the iteration 12 reviewer flagged as missing.

### Integration test: main subcommand refuses `--output .`

Add a focused integration test that proves the guard protects the main `uxreview` subcommand, not only the plan flow. The cleanest place is a new describe block in `tests/file-manager.test.ts` titled "main subcommand protection":

```typescript
it('main orchestrator path: initOutputDir("." ) refuses with descriptive error', () => {
  // Simulates the chain: CLI --output . → orchestrator → initWorkspace → initOutputDir
  // We test at initOutputDir directly since orchestrator mocks file-manager in all
  // other tests. This test verifies the protection is enforced at the single
  // chokepoint that every subcommand flows through.
  expect(() => initOutputDir('.')).toThrow(/current working directory/i);
});
```

Rationale: the orchestrator tests all mock `file-manager` entirely, so we cannot meaningfully assert the throw bubbles up through `runOrchestrator`. But since `initOutputDir` is the single chokepoint that every subcommand invokes (via `initWorkspace`), a direct test at that boundary proves the protection for every entry point. The comment above makes the test's framing explicit.

*(Alternative considered and rejected: spawning a real `node dist/cli.js --url X --output .` subprocess. Too slow for normal test runs, and fragile on CI.)*

---

## File change summary

| File | Change |
|------|--------|
| `src/file-manager.ts` | Rename `append` → `cleanExisting` with inverted polarity on `initOutputDir` and `initWorkspace`; add `assertSafeRemovalTarget` helper; add debug log before `rmSync`; add imports for `realpathSync`, `homedir`, `parse`, `sep` |
| `src/orchestrator.ts:115` | Update call to `initWorkspace(args.instances, args.output, !args.append)` |
| `src/plan-orchestrator.ts:93` | Update call to `initWorkspace(args.instances, args.output, false)` with explanatory comment |
| `tests/file-manager.test.ts` | Update 2 existing call sites (lines 142, 149) to new polarity; add 7 guard unit tests; add 1 main-subcommand protection test |
| `tests/plan-orchestrator.test.ts` | Add regression test asserting `initWorkspace` receives `cleanExisting: false` |

No CLI flag names change. No user-facing docs change. `README.md` is unaffected.

---

## Out of scope

Remains deferred (no change from prior iterations):

- Shell metacharacter risk in `browser-open.ts` — already migrated to `execFile()` in iteration 11.
- `Number() || fallback` masking instance 0 in `checkpoint.ts:54` (unreachable).
- `rate-limit.ts` at 75% function coverage (methodology artifact).
- Finding severity filtering (`--min-severity`).
- Claude Agent SDK migration.
- Structured IPC (replacing file-based communication).
- Report diffing for `--append` mode.
- `validate-plan` subcommand.
- `--from-plan` pipeline flag.
- Incremental discovery (`--append` for plan mode).
- Consolidation as a separate CLI subcommand.
- AbortController for cancellation.
- Large dataset / performance testing.
- Concurrent write race condition tests.
- Base orchestrator / composition pattern (plan vs main orchestrator duplication).
- Persistent rate-limit retry budget across sequential runs.
- Lightweight arg parsing library migration (`node:util parseArgs`).
- A `--force` override for the safety guard (intentionally not exposed).
- Reorganizing test-file layout along domain boundaries.

### Deliberately not carried forward from the iteration 12 reviewer's recommendations

- **Correcting `.devloop/archive/iteration-10/tasks.md`** — that file is a historical artifact; patching it does not affect correctness. Not worth a commit.
- **Investigating the devloop automation that silently skipped tasks** — out of scope for this repository (lives in the DevLoop tool itself, not UserExperienceAnalysisReporter).

---

## Verification strategy

### Per-task verification

Each task has a targeted verification command in `tasks.md`. No task runs the full suite.

### End-of-iteration sanity check

After all tasks land, a reviewer should confirm:

1. `npx tsc --noEmit` passes (full type-check — this is cheap).
2. `npx vitest run tests/file-manager.test.ts tests/orchestrator.test.ts tests/plan-orchestrator.test.ts` passes — the suites touched by the rename.
3. Overall coverage remains above the 95% branch threshold (not measured per-task to keep task runtimes tight).

### Manual post-merge validation

From a non-project directory containing arbitrary files, run:

```
uxreview plan --url http://localhost:5173 --intro "..."
```

Confirm:

1. The directory is not wiped.
2. A `./uxreview-plan/` subdirectory is created with the expected files.
3. `uxreview plan --url X --output .` exits with a clear "refusing to delete … current working directory" error.
4. `uxreview --url X --output .` (main subcommand, no `plan`) exits with the same error.
