# UX Analysis Reporter — Iteration 12 Requirements

## Overview

This iteration is driven by a critical safety bug discovered when the user ran `uxreview plan --url http://localhost:5173 --intro "..."` from a project directory (`SpaceAgencySimDocs/`) and got:

```
Fatal error: EBUSY: resource busy or locked, rmdir 'C:\Users\jeastaugh\source\repos\Experiments\SpaceAgencySimDocs'
```

The tool was attempting to **recursively delete the user's current working directory**. On Windows, the OS-level lock on the cwd surfaced an `EBUSY` error and saved the user's files. **On macOS or Linux, the same code path would have silently wiped the entire directory** — including any uncommitted work.

This iteration also picks up three carryover items from the iteration 11 review (currently the latest archived review at `.devloop/archive/iteration-9/review.md`): two branch-coverage gaps that emerged from the iteration 11 instance-manager split, plus a global test timeout config.

The prior iteration left the project at 1036/1036 tests passing across 43 test files, with overall coverage at 99.18% statements, 96.61% branches, 99.48% functions, 99.18% lines. Two submodules sit below the 95% per-file branch threshold: `instance-manager/spawning.ts` (89.28%) and `instance-manager/rounds.ts` (93.15%).

---

## Part A — The rmdir CWD bug

### Root cause

A four-step trace explains the failure:

1. **`src/cli.ts:403-405`** — `parsePlanArgs` defaults `--output` to `'.'` when the flag isn't provided:
   ```typescript
   output: (() => {
     const outputRaw = raw.get('output');
     return typeof outputRaw === 'string' ? outputRaw : '.';
   })(),
   ```
2. **`src/plan-orchestrator.ts:93`** — `runPlanDiscovery` passes that string straight through to `initWorkspace`:
   ```typescript
   const workspace = await initWorkspace(args.instances, args.output);
   ```
   Note no `append` argument, so `append` is `undefined`/falsy.
3. **`src/file-manager.ts:154-160`** — `initOutputDir` resolves the path (yielding the cwd) and unconditionally `rmSync`s it when `append` is falsy:
   ```typescript
   const outputDir = resolve(outputPath || DEFAULT_OUTPUT_DIR);
   if (existsSync(outputDir) && !append) {
     rmSync(outputDir, { recursive: true, force: true });
   }
   ```
4. On Windows the `rmSync` fails with `EBUSY` because the cwd is locked. On Unix-like systems the `rmSync` would succeed and the user would lose every file in the directory.

The main subcommand (`uxreview` without `plan`) is unaffected by the default — it defaults `--output` to `'./uxreview-output'`, a dedicated subdirectory. Only the `plan` subcommand has the dangerous default. However, the underlying `initOutputDir` would still happily wipe a user's directory if anyone passed `--output .` (or any other dangerous path) explicitly. We must address both the surface bug and the underlying hazard.

### Severity

**Critical** — potential silent loss of user data. The only reason the user did not lose their `SpaceAgencySimDocs` files is that they were on Windows. This is a "fix immediately" bug.

### Three layered fixes

The fix is intentionally layered to provide defense in depth: the default change makes the common case safe, the plan-mode behavior change removes the destructive operation entirely from a flow that doesn't need it, and the safety guard catches every other path through the code.

#### A1. Change the `plan` subcommand default for `--output`

The default `'.'` was unsafe by design. Change it to a dedicated subdirectory matching the main command's pattern.

- **`src/cli.ts:403-405`** — change the default from `'.'` to `'./uxreview-plan'`.
- **`src/cli.ts:84`** — update help text from `(default: . current directory)` to `(default: ./uxreview-plan)`.
- **`tests/cli.test.ts:264, 322-325, 454`** — three assertions currently expect `'.'`. Update to `'./uxreview-plan'`. Rename the test at line 322 (`'defaults output to "."'`) to `'defaults output to "./uxreview-plan"'`.
- **`README.md`** — search for any mention of the `.` default for `plan` and update.

The plan subcommand's emitted "Tip" line at `plan-orchestrator.ts:255` will now print `uxreview --url <X> --plan ./uxreview-plan/plan.md`, which is still a valid chained command.

#### A2. Don't wipe the output directory in plan mode

The `plan` subcommand only writes a small, fixed set of files (`plan.md`, `discovery.html`, `discovery.md`, plus the `screenshots/` subdirectory). There is no reason to wipe the entire output directory before writing them — `writeFileSync` will overwrite files in place, and `mkdirSync({recursive: true})` is idempotent.

The simplest, lowest-risk change is to pass `append: true` when `plan-orchestrator` calls `initWorkspace`:

- **`src/plan-orchestrator.ts:93`** — change to:
  ```typescript
  // Pass append=true to skip output-dir cleanup. The plan subcommand only writes
  // a small fixed set of files; wiping the output directory is unnecessary and
  // dangerous (see A1/A3 — the default output is the current working directory's
  // child, but a misconfigured run could still target a sensitive location).
  const workspace = await initWorkspace(args.instances, args.output, true);
  ```

**Tradeoff acknowledged:** If a previous `plan` run wrote screenshots that have unique filenames, those stale files persist alongside new ones in the `screenshots/` subdirectory. They are not referenced by the new `plan.md` / `discovery.html` / `discovery.md`, so they don't affect correctness — they just take disk space. This is acceptable. (Users who care can manually delete the output directory between runs.)

**Alternative considered and rejected:** Renaming `initOutputDir`'s `append` parameter to `preserveExisting` for clarity. Rejected to keep iteration scope tight; the existing semantics already do exactly what we need, and a comment at the call site makes the intent clear.

#### A3. Refuse-to-delete safety guard in `initOutputDir`

Add a defensive check that throws a descriptive error before `rmSync` if the resolved target is a path it should never delete. This protects the main subcommand and any future code path that calls `initOutputDir`.

The guard refuses removal when the target equals or is an ancestor of:
- The current working directory (`process.cwd()`)
- The user's home directory (`os.homedir()`)
- A filesystem root (`C:\`, `D:\`, `/`, etc. — derived via `path.parse(target).root`)

**Implementation notes:**
- Resolve both the target path and the comparison paths through `fs.realpathSync.native()` to canonicalize symlinks. Fall back to `path.resolve()` if `realpathSync` throws (e.g., the target was just resolved but doesn't exist on disk yet — though in our case the guard runs after an `existsSync` check, so realpath should succeed).
- On Windows, paths are case-insensitive. Lowercase both sides before string comparison when `process.platform === 'win32'`.
- Use `path.sep` (not a hardcoded `'/'`) when checking the ancestor relationship — i.e., `cwd.startsWith(target + path.sep)`.
- The thrown error must clearly state which dangerous category triggered the refusal and tell the user how to recover. Example:
  ```
  Refusing to delete output directory C:\Users\jeastaugh\source\repos\Experiments\SpaceAgencySimDocs:
  it is the current working directory.
  Choose a different --output path (e.g. --output ./uxreview-output).
  ```

**Not overridable.** No `--force` flag. If a user has a legitimate reason to wipe their cwd or home, they can do it themselves with `rm -rf`. The guard exists for situations where something has gone wrong.

**File changes:**
- **`src/file-manager.ts`** — add a private helper (e.g., `assertSafeRemovalTarget(targetPath: string): void`) and call it before `rmSync(outputDir, ...)` at line 159. Add `import { homedir } from 'node:os';` and `import { realpathSync } from 'node:fs';` (or merge with existing imports).

**Test changes:**
- **`tests/file-manager.test.ts`** — add tests covering:
  - Throws when target equals cwd
  - Throws when target is an ancestor of cwd
  - Throws when target equals home
  - Throws when target equals a filesystem root
  - On Windows: throws when target equals cwd with different case
  - Does NOT throw for a safe target (e.g., a fresh `./uxreview-output` subdirectory)
  - Throws message matches the expected pattern (test the error message contains the offending category name)

---

## Part B — Iteration 11 review carryovers

These items were flagged as "should fix" in `.devloop/archive/iteration-9/review.md` (despite the file path saying iteration-9, the document is the iteration 11 review per its own header). They are independent of Part A and of each other.

### B1. Raise `instance-manager/spawning.ts` branch coverage above 95%

Current: **89.28%** branch coverage. Uncovered lines: 85, 105, 109.

**Line 85** — `const basePrompt = config.promptBuilder?.(config) ?? buildInstancePrompt(config);` inside `spawnInstanceWithResume`. The truthy branch of the optional chaining call is not exercised. (Line 20 in `spawnInstance` has a similar expression; tests at `tests/instance-manager.test.ts:276` and `:445` already exercise that path, but neither triggers `spawnInstanceWithResume` with a custom `promptBuilder`.)

**Lines 105, 109** — the `catch (err)` block in `spawnInstanceWithResume`:
```typescript
} catch (err) {
  state.status = 'failed';
  state.error = err instanceof Error ? err.message : String(err);
}
```
The `Error` and non-`Error` branches of the ternary are both untested for the resume code path.

**Test additions** in `tests/instance-manager.test.ts` (or, if there's a dedicated `tests/spawning.test.ts`, there):
1. Call `spawnInstanceWithResume` with a config that includes a custom `promptBuilder`. Assert the builder was called and its result was used (e.g., spy on `runClaude` and inspect the `prompt` argument).
2. Mock `runClaude` to throw a real `Error` instance. Call `spawnInstanceWithResume`. Assert the returned state has `status: 'failed'` and `error` matches the thrown message.
3. Mock `runClaude` to throw a non-`Error` value (string or plain object). Call `spawnInstanceWithResume`. Assert `error` matches `String(thrownValue)`.

### B2. Raise `instance-manager/rounds.ts` branch coverage above 95%

Current: **93.15%** branch coverage. Uncovered lines: 176-182, 217, 225.

**Lines 176-182** — entry into the failure block after `state = await handleRateLimitRetries(...)` returns a still-failed state. Specifically:
```typescript
if (state.status === 'failed') {
  cb?.onFailure?.(config.instanceNumber, round, state.error || 'Unknown error');

  const retryInfo: RetryInfo = {
    round,
    attempts: 0,
    succeeded: false,
    errors: [state.error || 'Unknown error'],
  };
```
The `state.error || 'Unknown error'` fallback (the falsy `state.error` branch) is the gap.

**Line 217** — `retryInfo.errors.push(state.error || 'Unknown error');` inside the retry loop after a retry attempt fails again. Same falsy-`state.error` branch.

**Line 225** — `cb?.onPermanentlyFailed?.(config.instanceNumber, state.error || 'Unknown error');` after retries exhaust. Same falsy-`state.error` branch.

**Investigate first.** `tests/round-execution.test.ts`, `tests/coverage-gaps.test.ts`, and `tests/instance-manager.test.ts` all have tests touching the retry-exhaust path. The previous iteration added tests for permanent failure (`tests/coverage-gaps.test.ts` was used for similar branches). The remaining gap is likely the `state.error` being falsy (empty string, null, undefined) — a configuration where `runClaude` returns a failed result with no `stderr` and `exitCode` produces an empty error string. Add a focused test in `tests/coverage-gaps.test.ts` (or `tests/round-execution.test.ts`) that:
1. Mocks `runClaude` to consistently return `{success: false, exitCode: 0, stdout: '', stderr: ''}` (resulting in a falsy `state.error`).
2. Configures `maxRetries: 1` (or low) so the retry loop exhausts quickly.
3. Calls `runInstanceRounds` and asserts:
   - `cb.onFailure` was called with `'Unknown error'` as the error string
   - `cb.onPermanentlyFailed` was called with `'Unknown error'`
   - `result.retries[0].errors` contains `'Unknown error'` entries

### B3. Add global test timeout to `vitest.config.ts`

Add `testTimeout: 10000` to the `test` block. This prevents recurrence of the iteration 10 plan-signal-test timeout regression as the codebase grows.

**Change** to `vitest.config.ts:4-18`:
```typescript
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e.test.ts', 'tests/e2e-plan.test.ts'],
    testTimeout: 10000,
    coverage: {
      // ... unchanged
    },
  },
});
```

No source or test changes needed. Verification: run the existing test suite — all tests should still pass (10s is well above any individual test's actual runtime).

---

## Dependencies between items

```
A1 (default change)         — independent
A2 (plan skip rmSync)       — independent
A3 (safety guard)           — independent of A1/A2 but complements them
B1 (spawning.ts coverage)   — independent
B2 (rounds.ts coverage)     — independent
B3 (test timeout config)    — independent
```

Suggested execution order: A1 → A3 → A2, then B1, B2, B3 (or any order within B). A1 and A3 should land before A2 so that even if A2 has issues the user is no longer at risk.

---

## Testing strategy

### Coverage

All changes must keep overall coverage above the 95% threshold (currently 96.61% branch). B1 and B2 should raise the per-file branch coverage of `instance-manager/spawning.ts` and `instance-manager/rounds.ts` above 95%.

### New tests

| Item | Test file | What it covers |
|------|-----------|----------------|
| A3 | `tests/file-manager.test.ts` | `initOutputDir` refuses dangerous targets with descriptive error |
| B1 | `tests/instance-manager.test.ts` (or `tests/spawning.test.ts` if introduced) | `spawnInstanceWithResume` calls custom `promptBuilder`; catch block handles `Error` and non-`Error` throws |
| B2 | `tests/coverage-gaps.test.ts` (or `tests/round-execution.test.ts`) | `state.error` falsy fallback in retry loop reports `'Unknown error'` to all three callbacks |

### Modified tests

| File | Change |
|------|--------|
| `tests/cli.test.ts` | Three assertions of `result.output === '.'` (lines 264, 322-325, 454) updated to `'./uxreview-plan'`; test name at line 322 updated |

### Verification commands

| Item | Command |
|------|---------|
| A1 | `npx vitest run tests/cli.test.ts` |
| A2 | `npx vitest run tests/plan-orchestrator.test.ts` (verify nothing breaks) |
| A3 | `npx vitest run tests/file-manager.test.ts` |
| B1 | `npx vitest run --coverage tests/instance-manager.test.ts tests/spawning.test.ts` (verify branch coverage of `instance-manager/spawning.ts` is > 95%) |
| B2 | `npx vitest run --coverage tests/round-execution.test.ts tests/coverage-gaps.test.ts tests/instance-manager.test.ts` (verify branch coverage of `instance-manager/rounds.ts` is > 95%) |
| B3 | `npx vitest run` (full suite still green; reporter shows the timeout config taking effect) |

### Manual sanity check (after merge)

From a non-project directory containing arbitrary files, run:
```
uxreview plan --url http://localhost:5173 --intro "..."
```
Confirm:
1. The directory is **not** wiped.
2. A `./uxreview-plan/` subdirectory is created with the expected files.
3. If the user explicitly passes `--output .` (without `--keep-temp`), the tool refuses with a clear error about the cwd being unsafe.

---

## Out of scope

The following remain deferred (no change from prior iterations):

- Shell metacharacter risk in `browser-open.ts` — already migrated to `execFile()` in iteration 11; no further action needed.
- `Number() || fallback` masking instance 0 in `checkpoint.ts:54` (unreachable, instance numbering starts at 1)
- `rate-limit.ts` at 75% function coverage (`sleep()` always mocked — methodology artifact)
- Finding severity filtering (`--min-severity`)
- Claude Agent SDK migration
- Structured IPC (replacing file-based communication)
- Report diffing for `--append` mode
- `validate-plan` subcommand
- `--from-plan` pipeline flag
- Incremental discovery (`--append` for plan mode)
- Consolidation as a separate CLI subcommand
- AbortController for cancellation
- Large dataset / performance testing
- Concurrent write race condition tests
- Base orchestrator / composition pattern
- Persistent rate-limit retry budget across sequential runs
- Lightweight arg parsing library migration (`node:util parseArgs`)
- Renaming `initOutputDir`'s `append` parameter (semantic clarity, low value)
- A `--force` override for the safety guard (intentionally not exposed)
