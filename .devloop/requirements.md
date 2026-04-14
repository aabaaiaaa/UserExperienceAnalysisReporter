# UX Analysis Reporter — Iteration 9 Requirements

## Overview

This iteration addresses all remaining items from the iteration 8 code review: three "should fix" consistency/correctness issues, three "nice to have" improvements, and a bug in the e2e test that opens the HTML report in the browser during test runs.

No new features are added. All changes are bug fixes, consistency fixes, test coverage improvements, and refactoring.

The prior iteration left the project at 1020/1020 tests passing across 42 test files with 98.49% statement, 95.75% branch, 99.48% function coverage — all above the 95% threshold.

---

## Item 0: Fix e2e test missing `suppressOpen` and other required fields

### Problem

`tests/e2e.test.ts:89-99` constructs a `ParsedArgs` object missing five required fields: `verbose`, `suppressOpen`, `maxRetries`, `instanceTimeout`, and `rateLimitRetries`. At runtime, `args.suppressOpen` is `undefined` (falsy), so `!args.suppressOpen` is `true` and `openInBrowser(reportPath)` fires — actually launching the HTML report in the default browser during the test run.

The other missing fields (`verbose`, `maxRetries`, `instanceTimeout`, `rateLimitRetries`) default to `undefined` at runtime, which happens to work because the orchestrator treats them as falsy/0, but this is fragile and technically a type violation.

### Fix

Add the missing fields to the `ParsedArgs` object in `tests/e2e.test.ts:89-99`:

```typescript
const args: ParsedArgs = {
  url: serverUrl,
  intro: E2E_INTRO,
  plan: E2E_PLAN,
  scope: DEFAULT_SCOPE,
  instances: 2,
  rounds: 1,
  output: E2E_OUTPUT_DIR,
  keepTemp: false,
  append: false,
  dryRun: false,
  verbose: false,
  suppressOpen: true,
  maxRetries: 3,
  instanceTimeout: 30,
  rateLimitRetries: 10,
};
```

The key fix is `suppressOpen: true` which prevents browser opening. The other fields match CLI defaults for completeness and type correctness.

### Verification

Run `npx tsc --noEmit tests/e2e.test.ts` to confirm no type errors. Visually inspect the args object has all `ParsedArgs` fields.

---

## Item 1: Extract inline `formatDuration` from `orchestrator.ts`

### Problem

The plan orchestrator correctly imports `formatDuration` from `progress-display.ts` (fixed in iteration 8), but the main orchestrator at `orchestrator.ts:395-400` still defines its own inline version. The two implementations differ slightly: the inline version uses unpadded seconds (`1m 5s`) while `progress-display.ts` uses padded seconds (`1m05s`). This is a consistency issue.

### Fix

Remove the inline `formatDuration` definition at `orchestrator.ts:395-400` and import `formatDuration` from `progress-display.ts` instead. The import already exists for `ProgressDisplay` at line 27, so `formatDuration` can be added to that import.

The slight formatting change (unpadded to padded seconds) is acceptable — padded seconds like `1m05s` are more readable than `1m 5s`.

### Verification

Run `npx vitest run tests/orchestrator.test.ts` — all tests pass. Grep to confirm no remaining inline `formatDuration` definitions in orchestrator files:
```
grep -n "const formatDuration" src/orchestrator.ts src/plan-orchestrator.ts
```
Should return zero matches.

---

## Item 2: Handle signal interrupts gracefully in `index.ts`

### Problem

`index.ts:13-14` and `index.ts:20-21` catch all errors from `runPlanDiscovery()` and `orchestrate()` with a `"Fatal error:"` prefix. When the user presses Ctrl+C, the `SignalInterruptError` or `PlanSignalInterruptError` is caught and printed as "Fatal error: Process interrupted by SIGINT". This is misleading — signal interrupts are normal user-initiated exits, not fatal errors.

### Fix

Import both error classes and check for them before printing:

```typescript
import { orchestrate, SignalInterruptError } from './orchestrator.js';
import { runPlanDiscovery, PlanSignalInterruptError } from './plan-orchestrator.js';

// In both catch handlers:
.catch((err) => {
  if (err instanceof SignalInterruptError || err instanceof PlanSignalInterruptError) {
    // Normal exit — signal handler already set process.exitCode
    return;
  }
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

The plan handler only needs to check `PlanSignalInterruptError`; the main handler only needs to check `SignalInterruptError`. But importing both into the file is harmless and makes the pattern clear.

### Verification

Run `npx vitest run tests/index.test.ts` (if it exists) or `npx vitest run` and confirm all tests pass. Add a targeted test: mock `orchestrate` to reject with `SignalInterruptError`, verify that `console.error` is NOT called and `process.exit(1)` is NOT called.

---

## Item 3: Remove dead auto-detect code in `plan-orchestrator.ts`

### Problem

`plan-orchestrator.ts:93-101` checks `args.instances === 0` to trigger auto-detection from plan areas. But `parsePlanArgs()` in `cli.ts` defaults instances to `1` (not `0`), and CLI validation requires positive integers. The auto-detect block can never trigger for the plan subcommand via normal CLI usage.

### Fix

Remove the dead code block at lines 93-101 (the `if (args.instances === 0 ...)` block and its `else if` branch). The code directly after it (`initWorkspace`, progress display setup) works correctly without this block since `args.instances` is always >= 1.

Also remove the `extractAreasFromPlanChunk` import if it becomes unused (check whether it's used elsewhere in the file), and the `MAX_AUTO_INSTANCES` import if it becomes unused.

### Verification

Run `npx vitest run tests/plan-orchestrator.test.ts` — all tests pass. Grep to confirm no dead references:
```
grep -n "args.instances === 0" src/plan-orchestrator.ts
```
Should return zero matches.

---

## Item 4: Add end-to-end test for the plan subcommand

### Problem

The main command has `tests/e2e.test.ts` but there's no equivalent for `uxreview plan`. The plan flow is tested via mocked integration tests but no test exercises the full plan flow from CLI args through output file generation with real Claude instances.

### Fix

Create `tests/e2e-plan.test.ts` that mirrors the structure of `tests/e2e.test.ts`:

1. Start the test fixture web app (`tests/fixtures/e2e-app/server.js`)
2. Construct `ParsedPlanArgs` with all required fields (including `suppressOpen: true`)
3. Call `runPlanDiscovery(args)` with 1-2 instances, 1 round
4. Verify output files exist:
   - `discovery.html` exists and has content
   - `plan.md` exists and has content
   - `discovery.html` contains at least one discovery area heading
   - `plan.md` contains structured plan template sections
5. Clean up output and temp directories

The test should be in the same `test:e2e` test config (or a separate `test:e2e-plan` script) so it doesn't run in the normal `vitest run` suite (it requires Claude CLI and takes time).

### Verification

Run `npx vitest run tests/e2e-plan.test.ts` (requires Claude CLI). The test should pass and produce plan output without opening the browser.

---

## Item 5: Raise `instance-manager.ts` branch coverage

### Problem

`instance-manager.ts` has the lowest branch coverage in the project at 88.78%. Key uncovered paths:

- Lines 277-279: `Promise.allSettled` rejection path in `runParallelInstances()` — when a spawned instance's promise is rejected (not just returns a failure status)
- Lines 435-440: Synthetic failure path in `runSingleInstanceWithRetries()` — when `respawn()` internally catches an error and `latestState.result` is undefined, the code creates a synthetic failure result

### Fix

Add targeted tests to `tests/instance-manager.test.ts`:

1. **Promise rejection in `runParallelInstances`**: Mock `spawnInstance` to throw/reject (not return a failure result). Verify the `settled.map` handler at line 277 creates a proper failed result with the rejection reason.

2. **Synthetic failure in retry loop**: Set up a scenario where `respawn()` catches an error internally (e.g., `runClaude` throws) and `latestState.result` is undefined but `latestState.error` is set. Verify the synthetic failure object is created with the correct fields.

### Verification

Run `npx vitest run --coverage tests/instance-manager.test.ts` and confirm branch coverage is above 95%.

---

## Item 6: Shared arg parser for CLI

### Problem

`parseRawArgs()` (cli.ts:140-167) and `parsePlanRawArgs()` (cli.ts:309-336) are structurally identical. Both:
1. Iterate over argv
2. Check for `--` prefix
3. Match against a set of boolean flags (no value needed)
4. Treat all other flags as key-value pairs
5. Call a usage/exit function on errors

The only differences are:
- The boolean flag sets (`show-default-scope`, `help`, `version`, `keep-temp`, `append`, `dry-run`, `verbose`, `suppress-open` vs `help`, `keep-temp`, `dry-run`, `verbose`, `suppress-open`, `append`)
- The error function called (`printUsageAndExit` vs `printPlanUsageAndExit`)

### Fix

Create a shared `parseRawArgv()` function parameterized by boolean flag set and error handler:

```typescript
function parseRawArgv(
  argv: string[],
  booleanFlags: Set<string>,
  onError: (msg: string) => never,
): Map<string, string | true> {
  const args = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      onError(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (booleanFlags.has(key)) {
      args.set(key, true);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      onError(`Missing value for --${key}`);
    }
    args.set(key, next);
    i++;
  }
  return args;
}
```

Then `parseRawArgs` and `parsePlanRawArgs` become one-line wrappers:

```typescript
function parseRawArgs(argv: string[]): Map<string, string | true> {
  return parseRawArgv(argv, MAIN_BOOLEAN_FLAGS, printUsageAndExit);
}

function parsePlanRawArgs(argv: string[]): Map<string, string | true> {
  return parseRawArgv(argv, PLAN_BOOLEAN_FLAGS, printPlanUsageAndExit);
}
```

The boolean flag sets should be defined as constants near their respective parsers for clarity.

### Verification

Run `npx vitest run tests/cli.test.ts` — all existing tests pass. The refactoring should be behavior-preserving.

---

## Dependencies Between Items

```
Item 0 (e2e test fix)          — independent
Item 1 (formatDuration)        — independent
Item 2 (signal interrupt)      — independent
Item 3 (dead auto-detect code) — independent
Item 4 (e2e plan test)         — independent (but should come after Item 0 to follow the same pattern)
Item 5 (instance-manager cov)  — independent
Item 6 (shared arg parser)     — independent
```

All items are independent of each other and can be done in any order. Item 4 (e2e plan test) should reference Item 0's pattern for constructing complete args objects.

---

## Testing Strategy

All changes must maintain the 95% coverage threshold (currently at 95.75% branch). This iteration should raise coverage slightly through Item 5.

### New test files
- `tests/e2e-plan.test.ts` — end-to-end test for plan subcommand (e2e suite, not normal suite)

### Modified test files
- `tests/e2e.test.ts` — add missing `ParsedArgs` fields (Item 0)
- `tests/instance-manager.test.ts` — new tests for uncovered branch paths (Item 5)
- `tests/index.test.ts` or `tests/orchestrator.test.ts` — test for graceful signal handling (Item 2)
- `tests/cli.test.ts` — existing tests validate shared parser refactoring (Item 6)

---

## Out of Scope

The following remain deferred:
- Shell metacharacter risk in `browser-open.ts:9-11` (pre-existing accepted risk, low severity)
- `Number() || fallback` masking instance 0 in `checkpoint.ts:54` (unreachable, instance numbering starts at 1)
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
- Base orchestrator / composition pattern for the two parallel orchestrators
- Persistent rate-limit retry budget across sequential runs
