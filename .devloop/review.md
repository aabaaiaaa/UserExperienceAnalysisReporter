# Iteration 12 — Final Code Review

**Date**: 2026-04-16
**Reviewer**: Claude (code-review pass)
**Scope**: Verification of iteration 12 requirements and tasks against the actual codebase state on `main` @ `181a140`.

---

## Executive Summary

**Status: ❌ Iteration 12 is INCOMPLETE. Two of six tasks are marked `done` in `tasks.md` but were never implemented in the source. The critical safety bug that motivated this iteration is only partially mitigated.**

| Task | Marked | Actually Implemented | Notes |
|------|--------|----------------------|-------|
| TASK-001 — change `plan` default `--output` to `./uxreview-plan` | done | ✅ Yes | Verified in `src/cli.ts:405` and `:84`, `README.md:148`, `tests/cli.test.ts` |
| TASK-002 — skip output-dir cleanup in plan mode | done | ❌ **NO** | `src/plan-orchestrator.ts:93` still calls `initWorkspace(args.instances, args.output)` — no `append` argument |
| TASK-003 — refuse-to-delete safety guard in `initOutputDir` | done | ❌ **NO** | No `assertSafeRemovalTarget` helper exists anywhere; `src/file-manager.ts:154-166` is unchanged from iteration 11; no home/cwd/root checks; no new tests in `tests/file-manager.test.ts` (still only 16 tests) |
| TASK-004 — raise `spawning.ts` branch coverage | done | ✅ Yes (but pre-existing) | Tests at `tests/instance-manager.test.ts:445-502` cover the three gaps. These were actually added in iteration 11 (commit `770f8dc`), not this iteration — the task was already satisfied before iteration 12 started |
| TASK-005 — raise `rounds.ts` branch coverage | done | ✅ Yes | Tests at `tests/coverage-gaps.test.ts:211-260` added in commit `17662a0` |
| TASK-006 — global `testTimeout: 10000` | done | ✅ Yes | `vitest.config.ts:7` |

The progress log at `.devloop/progress.md:38-45` confirms iteration 4 only completed `TASK-001, TASK-005, TASK-006`. **TASK-002, TASK-003, and TASK-004 were never attempted by the automated executor in iteration 12.** The `Status: done` flags in `tasks.md` for TASK-002 and TASK-003 are false — no commit in this iteration modifies either `src/plan-orchestrator.ts` (beyond unrelated iteration-11 import-path changes) or adds a safety guard to `src/file-manager.ts`.

---

## Requirements vs Implementation

### Part A — The rmdir CWD bug (the critical motivator of this iteration)

**Verdict: PARTIALLY FIXED. The tool is safer than before, but the layered defense described in the requirements was not built.**

- **A1 (default change)**: ✅ Implemented correctly. A user running `uxreview plan` without `--output` no longer points at cwd. This alone prevents the specific failure reported in the bug.
- **A2 (skip `rmSync` in plan mode)**: ❌ **NOT IMPLEMENTED**. `src/plan-orchestrator.ts:93` still invokes `initWorkspace(args.instances, args.output)`, so `initOutputDir` still runs `rmSync` on the output path whenever plan mode is used. A user who explicitly passes `--output <somedir>` to `plan` will still have `<somedir>` wiped before the run, which is surprising behavior for a discovery-only subcommand that writes a small fixed file set. Requirements explicitly called out this defense layer as "the lowest-risk change" and the rationale is valid — wiping is unnecessary.
- **A3 (refuse-to-delete guard)**: ❌ **NOT IMPLEMENTED**. This was the backbone of the defense-in-depth plan: a guard that protects *any* code path, including the main `uxreview` subcommand. Without it, the critical failure mode described at `requirements.md:41-44` ("on macOS/Linux the rmSync would succeed and the user would lose every file in the directory") is still reachable if a user passes `--output .` (or `--output ~`, or `--output /`) to either subcommand. For the `plan` subcommand, the A1 default change hides the gun, but the gun is still loaded. For the main `uxreview` subcommand, nothing changed at all.

### Part B — Carryover items

- **B1 (`spawning.ts` coverage)**: ✅ Already satisfied by iteration 11 work (see table above). No new code in iteration 12.
- **B2 (`rounds.ts` coverage)**: ✅ New test added in `tests/coverage-gaps.test.ts:211-260` covering lines 176-182, 217, 225 of `rounds.ts` via the empty-stderr + exitCode-0 scenario. Correctly asserts all three callbacks and retry error entries receive `'Unknown error'`.
- **B3 (`testTimeout`)**: ✅ `vitest.config.ts:7` adds `testTimeout: 10000`. Minimal, correct, and low-risk.

### Scope creep

None detected — no features outside the iteration requirements were added.

---

## Code Quality

### Critical: data-loss hazard still reachable

The entire point of iteration 12 was to close the `EBUSY/rmdir cwd` hazard. The closure is incomplete:

1. **Main subcommand is unchanged.** `uxreview --url X --output .` still reaches `src/file-manager.ts:158-160`:
   ```ts
   if (existsSync(outputDir) && !append) {
     rmSync(outputDir, { recursive: true, force: true });
   }
   ```
   On macOS/Linux this silently deletes the current working directory's files. On Windows it throws `EBUSY`. Users who pass `--output ~` or `--output /` get the same behavior targeted at their home/root.
2. **Plan subcommand leaks the hazard via explicit `--output`.** A1 changed only the *default*. A user following README guidance who types `uxreview plan --url X --output .` gets exactly the failure mode from the original bug report — because A2 was never implemented.

These are not hypothetical edge cases; they are exactly the failure paths the requirements document identified. They need to be fixed before this iteration can be considered closed.

### Existing code (not regressed by this iteration)

The code that was touched *is* correct:

- `src/cli.ts:403-406` correctly defaults to `'./uxreview-plan'` and reads the `output` flag with a sensible type guard.
- `src/cli.ts:84` help text is aligned with the new default.
- `tests/cli.test.ts` updates are consistent — all three assertions and the test name now reflect `'./uxreview-plan'`.
- `tests/coverage-gaps.test.ts:211-260` is a focused, well-structured test. It mocks `runClaude` to consistently return `{success: false, exitCode: 0, stdout: '', stderr: ''}`, sets `maxRetries: 1`, and asserts each of `onFailure`, `onPermanentlyFailed`, and `retries[0].errors` receive the `'Unknown error'` literal — precisely what the requirement described.
- `vitest.config.ts:7` is a one-line, correct addition.

### Minor observations (pre-existing, not new regressions)

- `src/file-manager.ts:154` — `initOutputDir` still takes `append?: boolean`. Requirements A2 notes renaming it to `preserveExisting` was considered and rejected, which is fine; but the boolean-flag anti-pattern is worth revisiting.
- `src/file-manager.ts:155` — `resolve(outputPath || DEFAULT_OUTPUT_DIR)` is permissive: it treats `''`, `'.'`, `'/'`, `'~'` (not expanded), and any valid path the same way. A3 would have been the right place to harden this.

### Security concerns

- **Data loss**: the unimplemented A2/A3 remain the top concern (see above). Severity: critical.
- `src/browser-open.ts` was migrated to `execFile()` in iteration 11 — verified still in place. No regression.
- No new external input is handled in this iteration; no new attack surface.

---

## Testing

### What works

- Targeted test runs verified: `tests/cli.test.ts` and `tests/file-manager.test.ts` both pass.
- `tests/file-manager.test.ts` has 16 tests — unchanged from iteration 11.
- Coverage for `instance-manager/spawning.ts` and `instance-manager/rounds.ts` appears raised via the new/pre-existing focused tests; I did not run the full `--coverage` pass to compute exact numbers, but the branches called out in the requirements (176-182, 217, 225 for rounds; 85, 105, 109 for spawning) are all exercised by tests now present in the suite.

### Gaps

- **No tests exist for the refuse-to-delete guard** (TASK-003). Requirements specified seven distinct test cases covering cwd, ancestor-of-cwd, home, filesystem root, Windows case-insensitivity, the safe-subdirectory happy path, and the error message content. None exist because the guard itself doesn't exist.
- **No regression test** verifies plan mode no longer deletes the output directory (TASK-002). `tests/plan-orchestrator.test.ts` passes because it mocks `initWorkspace`, so it can't catch the call-signature change that was supposed to happen.
- **No manual sanity check** described at `requirements.md:246-254` has been performed because the code changes to make that check pass were never merged.

---

## Recommendations

Blocking before this iteration can be considered complete:

1. **Implement TASK-002.** Change `src/plan-orchestrator.ts:93` to `await initWorkspace(args.instances, args.output, true);` with a leading comment explaining why (per the requirements exactly). Verify with `npx vitest run tests/plan-orchestrator.test.ts`.
2. **Implement TASK-003.** Add the `assertSafeRemovalTarget` private helper in `src/file-manager.ts` per requirements A3, including:
   - Realpath canonicalization with a `path.resolve` fallback
   - Case-insensitive comparison on Windows
   - `path.sep` ancestor check
   - Refuse on cwd, ancestor-of-cwd, home, and filesystem root
   - Clear error messages naming the offending category
   - Call it immediately before `rmSync` at line 159
3. **Add the seven tests** in `tests/file-manager.test.ts` called for by the requirements.
4. **Correct `.devloop/tasks.md`.** The `Status: done` flags on TASK-002 and TASK-003 are misleading and block future audits. Either flip them back to `pending` and re-run, or add a correction note. The progress log (`.devloop/progress.md`) is the authoritative record and should be the basis for any regeneration.
5. **Investigate the devloop automation.** The iteration completed "successfully" with two tasks silently skipped. Whatever process flipped the status to `done` without a verification commit produced a false-positive signal. Worth a look before running iteration 13.

Non-blocking polish:

- Once A3 is in place, consider an explicit test that the main `uxreview` subcommand also refuses `--output .`. Requirements framed A3 as the guard for "every other path through the code," but there's no coverage that actually exercises that protection from the main-command entry point.
- Consider whether `initOutputDir` should log (via `debug()`) the fact that it's about to `rmSync` a non-trivial path. Low value but would have made the original bug easier to diagnose.

---

## Future Considerations

### Features / improvements to consider next

- **`validate-plan` subcommand** and **`--from-plan` pipeline flag** (already listed as deferred in requirements) — these would make the plan-mode workflow more composable.
- **Report diffing for `--append` mode** — currently `--append` preserves but doesn't diff. With the refuse-to-delete guard in place, append would be a safer default for more flows.
- **Finding severity filtering (`--min-severity`)** — pragmatic ergonomic win; small scope.
- **Structured IPC replacing file-based communication** — the checkpoint-file + report-file + screenshots-dir protocol is simple but fragile under concurrent writes and harder to test in-memory. Would enable proper concurrency tests.
- **Claude Agent SDK migration** — Anthropic's SDK now covers much of what `claude-cli.ts` reimplements. Revisit when the SDK's prompt/tool-use story is stable enough for the retry-and-resume patterns used here.

### Architectural decisions worth revisiting

- **`initOutputDir`'s destructive default.** The real lesson of this bug is that "clean slate before every run" was the wrong default. Appending/upserting is safer; a separate `--clean` flag would express intent explicitly. A3 plus a refactor away from destructive-by-default would harden this permanently.
- **Boolean flag `append`.** It means "preserve existing" to the caller and "skip rmSync" to the implementation. A discriminated union (`{mode: 'clean'} | {mode: 'preserve'}`) or an explicit `cleanExisting: boolean` with inverted polarity would reduce foot-gun risk at call sites. Requirements rejected the rename to keep scope tight — fine for now, revisit.
- **Plan vs main orchestrator duplication.** `src/plan-orchestrator.ts` and `src/orchestrator.ts` still share a large surface (workspace init, progress callback wiring, cleanup). A shared base (noted in "out of scope" across iterations) would have prevented the asymmetric default bug that caused this iteration in the first place: the plan subcommand's `'.'` default only existed because the two init paths were written independently.
- **Test-file scale.** 43 test files, >1000 tests, ~99% coverage. The test suite is a significant asset; equally, the test-file layout is starting to show seams (`coverage-gaps.test.ts`, `round-execution.test.ts`, `instance-manager.test.ts` all overlap). A reorganization along domain boundaries (matching the submodule splits from iterations 9-11) would help future contributors.

### Technical debt introduced or left in place

- **Silent "task done" state divergence.** The mismatch between `tasks.md` and the actual repo state is the new debt this iteration introduces. It needs a correction commit and, ideally, a process-level fix.
- **Plan-mode default relies on the absence of a fix that should have been done.** A1 alone is not a fix — it's a mitigation that happens to cover the one reported case. The iteration requirements explicitly framed this as defense-in-depth; shipping only layer 1 leaves the hazard in place for any user who passes `--output` explicitly.
- **`instance-manager/spawning.ts` coverage was already satisfied before iteration 12 began.** TASK-004 was effectively a no-op. Future iterations should measure coverage before writing tasks to avoid scheduling work that's already complete.
- **No integration test** covers the plan subcommand's interaction with `initOutputDir`. `tests/e2e-plan.test.ts` exists but is excluded from normal runs. A small unit/integration test around `plan-orchestrator → initWorkspace` would have caught TASK-002 being skipped.

---

## Bottom Line

Three of six tasks actually did real work in this iteration. Two of those (the default change and the testTimeout config) are correct and low-risk; one (the rounds.ts coverage test) is well-constructed. The two tasks that address the root of the critical data-loss bug — wiping cwd / home / root — were **not implemented**, despite being marked `done`. The iteration cannot be considered complete until TASK-002 and TASK-003 are built and verified. The remaining work is small and well-scoped by the existing requirements; recommend a focused follow-up before any further iteration is opened.
