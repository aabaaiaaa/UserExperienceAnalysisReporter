# Iteration 13 Review

**Scope reviewed:** `.devloop/requirements.md` (iteration 13), `.devloop/tasks.md` (6 tasks), relevant source (`src/file-manager.ts`, `src/orchestrator.ts:115`, `src/plan-orchestrator.ts:88-97`), tests (`tests/file-manager.test.ts`, `tests/plan-orchestrator.test.ts`).

**Headline:** Iteration 13 is a **clean completion** of the safety work that iteration 12 left half-done. All six tasks are implemented, all six verification commands pass, and the A2/A3 data-loss hazard that motivated the iteration is now closed at the single chokepoint every subcommand funnels through (`initOutputDir`). Test count grew by exactly the expected amount. This is ready to land.

---

## Requirements vs Implementation

### All five scope items are implemented

| Req | Location | Status |
|-----|----------|--------|
| Rename `append` → `cleanExisting` (inverted polarity) on `initOutputDir` / `initWorkspace` | `file-manager.ts:207, 230-234` | Done. Default `true`; polarity inverted as specified; JSDoc updated (`:198-206, :223-229`). |
| A2: pass `cleanExisting: false` in plan call site with explanatory comment | `plan-orchestrator.ts:93-97` | Done. Comment is verbatim from the requirements. |
| Main-subcommand call site preserves external `--append` flag meaning | `orchestrator.ts:115` | Done (`!args.append`). |
| A3: `assertSafeRemovalTarget` helper refusing cwd / ancestor / home / filesystem root | `file-manager.ts:147-196` | Done. Canonicalizes via `realpathSync.native` with `resolve()` fallback; case-insensitive on Windows via `normalizeForCompare`; uses `path.sep` for ancestor check. |
| Debug log before `rmSync` in order `debug → assert → rmSync` | `file-manager.ts:211-214` | Done. Ordering is exactly as specified. |
| Regression test: `plan-orchestrator` passes `cleanExisting: false` | `tests/plan-orchestrator.test.ts:375-403` | Done — exact assertion from requirements. |
| Integration-style test: main subcommand also protected | `tests/file-manager.test.ts:197-206` | Done. Comment in test body explains the framing (single chokepoint for every subcommand). |

### Guard unit tests — all seven present

`tests/file-manager.test.ts:156-195` contains the full set: cwd (`:157-159`), ancestor (`:161-167` — also asserts the parent still exists, which the requirements explicitly called out), home (`:169-171`), filesystem root (`:173-176`), Windows case-insensitive via `it.runIf` (`:178-184`), safe target creates the directory (`:186-190`), and `--output` recovery hint (`:192-194`).

### No scope creep detected

No tangential refactors, no new CLI flags, no `README` churn. The iteration stayed inside the five-item scope box.

### Verification passes

`npx vitest run tests/file-manager.test.ts tests/plan-orchestrator.test.ts` → **53/53 passing** (file-manager 24, plan-orchestrator 29). This matches the predicted deltas (file-manager +8 vs iteration 11's 16; plan-orchestrator +1).

---

## Code Quality

### Strengths

- **Defense-in-depth ordering.** Putting `debug(...)` before `assertSafeRemovalTarget(...)` means the log line appears even when the assertion fires — exactly the breadcrumb a future forensics run would need. The requirements anticipated this; the implementation respects it.
- **Canonicalization is correct.** `realpathSync.native()` with a `resolve()` fallback handles both the "path exists" happy path and the "path resolved but not yet realized on disk" edge. Because the guard runs inside `if (existsSync(outputDir) && cleanExisting)`, the target is guaranteed to exist when the guard fires — realpath should always succeed for `outputDir` — but the fallback is still correct defensive code for `homedir()` / `process.cwd()` which Node's own realpath can occasionally trip on in edge cases (removed on a running process, for instance).
- **Platform handling.** `normalizeForCompare` (`:155-157`) centralizes Windows case-folding, so a single helper change would fix any future platform nuance. Good isolation.
- **Root guard sanity.** `if (root !== '' && target === root)` defensively handles the (theoretically impossible after canonicalize) relative-path case. Cheap, clear.
- **JSDoc is accurate.** The doc block on `initOutputDir` (`:198-206`) correctly describes "when true (the default)" and "when false" behavior, matching the rename's new polarity.

### Minor observations (not blockers)

1. **Ancestor check only protects `cwd`.** The guard refuses ancestors of `process.cwd()` but not ancestors of `homedir()`. A target like `C:\Users` (on Windows) is an ancestor of home but not necessarily of cwd, and would pass the guard unless cwd happens to also be under `C:\Users`. In practice the cwd is almost always under the user profile on Windows, so the cwd-ancestor check transitively protects `C:\Users`. On Linux/macOS, `/home` or `/Users` is protected only when cwd is under it. This is acceptable (the requirements didn't mandate home-ancestor protection), but worth noting for future iterations.
2. **`rmSync` in `initTempDir` / `cleanupTempDir` is not gated by the guard.** The guard lives inside `initOutputDir`. The `cleanupTempDir` function at `file-manager.ts:58-80` operates on `getTempDir()` (a fixed `.uxreview-temp` subdirectory of cwd), so it can't hit cwd or home. But if a future change ever parameterizes the temp dir, the guard would need to be wired through. Consider extracting the guard to run at `rmSync` rather than at `initOutputDir` in a future iteration if the surface grows.
3. **Trailing period in error messages.** `Refusing to delete output directory X: it is Y. Choose a different --output path (e.g. --output ./uxreview-output).` Minor wording polish only — readable as-is.
4. **`canonicalize()` is synchronous** but used in a hot path only during init, so not a perf concern.

### Bugs / edge cases

None detected. The guard logic is correct for the specified cases. The A2 fix — passing `false` unconditionally from the plan orchestrator — is safe because `mkdirSync({recursive: true})` is idempotent and `writeFileSync` overwrites in place. The acknowledged tradeoff (stale screenshots from prior plan runs persist) is explicit in both requirements and code comments.

### Security

- No shell metacharacter regressions (`browser-open.ts` migration to `execFile` from iteration 11 is untouched).
- No new privilege-sensitive code paths introduced.
- The guard closes the data-loss hazard; it does not introduce a new one.

---

## Testing

### Coverage of new code is thorough

All four guard categories (cwd, ancestor, home, root) have dedicated tests. Windows case-insensitivity is gated via `it.runIf` so it runs only on Windows and is a no-op on Linux/macOS CI — correct conditional behavior. The "safe target does NOT throw" test at `:186-190` also validates the mkdir'd directory layout (screenshots subdir), which double-tests the happy path.

### Regression test is load-bearing

`tests/plan-orchestrator.test.ts:375-403` asserts `cleanExisting=false` directly against the mock. This is the exact test iteration 12's reviewer flagged as missing, and it would have caught the iteration 12 skip. If a future refactor drops or flips the third argument, this test fails immediately.

### Untested edge cases (acceptable)

- **Ancestor chain beyond one level.** Test 2 uses `'..'` (direct parent). It doesn't verify that `../..` or a grandparent chain is also caught. The `cwd.startsWith(target + sep)` check handles arbitrary ancestor depth, so this is implicit, but a single grandparent test would be a cheap addition.
- **Symlink canonicalization.** The guard uses `realpathSync.native` specifically to collapse symlinks (e.g., `~/symlink-to-home`). No test asserts this path. Building such a test cross-platform (Windows vs Unix symlink semantics differ) is genuinely tricky, so the omission is reasonable.
- **No end-to-end subprocess test.** Requirements explicitly rejected this as too slow and fragile for the normal test run. The manual post-merge steps in `requirements.md:300-313` cover it.

### Coverage threshold

Not measured per-task (intentional, per requirements `:298`). The added tests exercise multiple branches in the new helper, so overall coverage should remain ≥95% branch. Worth running `npm run test:coverage` once at end-of-iteration to confirm.

---

## Recommendations

Before shipping:

1. **Run the end-of-iteration sanity checks from `requirements.md:286-298`:**
   - `npx tsc --noEmit` — full type-check.
   - `npx vitest run tests/file-manager.test.ts tests/orchestrator.test.ts tests/plan-orchestrator.test.ts` — already confirmed passing for two of three; add `orchestrator.test.ts` to verify the renamed call site also holds up.
   - `npm run test:coverage` once to confirm the 95% branch threshold still holds.
2. **Perform the manual post-merge validation** listed in `requirements.md:300-313`. The automated tests cover the protection at the function level; the manual check confirms the protection actually surfaces to the user with a readable message when invoked via the CLI. These are the four scenarios:
   - `uxreview plan --url X --intro "..."` (default `./uxreview-plan` — no wipe).
   - `uxreview plan --url X --output .` (refuses with cwd message).
   - `uxreview --url X --output .` (main subcommand, same refuse).
   - `uxreview --url X` (default `./uxreview-output` — normal flow).

Nothing else is a blocker.

---

## Future Considerations

### Features / improvements to consider next

- **`--min-severity` filter** (deferred since iteration 11). Low-cost, high-visibility user improvement.
- **`validate-plan` subcommand.** The `plan` subcommand now preserves its output directory; a companion `validate-plan` that re-lints an existing `plan.md` without re-running discovery would compose cleanly.
- **`--from-plan` pipeline flag.** Glues `plan` → `main` into one command. Low-risk given the current separation.
- **Structured IPC** replacing file-based communication. The `.uxreview-temp/` convention is working but would be brittle under concurrent or remote execution.

### Architectural decisions to revisit

- **`plan-orchestrator.ts` vs `orchestrator.ts` duplication.** Both now diverge in a small, targeted way (`cleanExisting: false` vs `!args.append`). That divergence is healthy — it exposes that these two flows have different semantics. But the broader orchestration scaffolding around progress display, signal handling, and workspace init is still duplicated. A base-orchestrator / composition pattern (deferred across iterations) would pay off once either flow grows again.
- **File-based checkpoint and work-distribution.** The guard now protects output-dir wipes; the temp-dir has no analogous guard (mitigated by a fixed subdirectory name). If iteration 14+ introduces configurable temp paths, push the guard down so it runs before *any* `rmSync`, not only `initOutputDir`.
- **Rate-limit module coverage.** `rate-limit.ts` still sits at 75% function coverage (methodology artifact from mocking `sleep()`). Deferred but worth addressing once e2e-style tests are in scope.

### Technical debt introduced by this iteration

**Essentially none.** The rename is a cleanup, not a new debt. The `cleanExisting` default of `true` preserves prior behavior for every existing call site that omits the argument, so there's no hidden transition cost. One small nit:

- `canonicalize()` and `normalizeForCompare()` are private helpers inside `file-manager.ts`. If another module ever needs the same logic (e.g., a future destructive-cleanup path), extract them to a small `path-safety.ts` module. Not urgent.

### Remaining carryovers from prior iterations

Per `requirements.md:255-283`, the following stay deferred: shell metacharacter work (resolved), `checkpoint.ts:54` unreachable branch, rate-limit function coverage, report diffing for `--append`, Claude Agent SDK migration, AbortController cancellation, base-orchestrator pattern, `--force` override for the guard (intentional), and test-file reorganization.

---

## Summary

Iteration 13 is a clean completion of the safety hazard that iteration 12 partially delivered. Code is correct, tests are adequate and targeted, no scope creep, no regressions. The A2/A3 chain is closed at the right abstraction layer. Recommend landing after running the full-project type-check and coverage report, plus the short manual post-merge check from the requirements doc.
