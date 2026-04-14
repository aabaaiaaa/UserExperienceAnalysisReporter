# Iteration 10 Tasks

### TASK-001: Stabilize flaky consolidation-resume checkpoint preservation test
- **Status**: done
- **Dependencies**: none
- **Description**: Fix the intermittently failing test "preserves consolidation checkpoint when initTempDir is called on existing temp dir" in `tests/consolidation-resume.test.ts:788-821`. The test fails on Windows due to filesystem timing — `initTempDir(2)` called twice in quick succession sometimes deletes the checkpoint file despite `hasExistingCheckpointData()` returning true. Either add a filesystem settle delay between the write and re-initialization, or restructure the test to verify the preservation logic more directly without relying on rapid sequential filesystem operations. See requirements.md Item 1 for full analysis.
- **Verification**: Run `npx vitest run tests/consolidation-resume.test.ts` three times — all tests must pass every time.

### TASK-002: Raise instance-manager.ts branch coverage — scope-empty path
- **Status**: done
- **Dependencies**: none
- **Description**: Add a targeted test to `tests/instance-manager.test.ts` for the uncovered branch at `src/instance-manager.ts:166` — the `buildDiscoveryPrompt` scope-empty path. Call `buildDiscoveryPrompt` with an empty/whitespace-only scope string and verify the returned prompt does NOT contain "Exploration Guidance". See requirements.md Item 2.
- **Verification**: Run `npx vitest run --coverage tests/instance-manager.test.ts` and confirm branch coverage is above 95%.

### TASK-003: Raise html-report.ts branch coverage — screenshot encoding fallbacks
- **Status**: done
- **Dependencies**: none
- **Description**: Add targeted tests to the html-report test file covering: (1) `encodeScreenshotBase64` with a non-existent file path returns `null`, (2) `encodeScreenshotBase64` when `readFileSync` throws returns `null`, (3) `renderScreenshots` when all screenshot refs fail to encode falls back to escaped plain text. See requirements.md Item 3 for line numbers and details.
- **Verification**: Run `npx vitest run --coverage tests/html-report.test.ts` and confirm branch coverage is above 95%.

### TASK-004: Raise progress-display.ts branch coverage — edge states
- **Status**: done
- **Dependencies**: none
- **Description**: Add targeted tests to `tests/progress-display.test.ts` covering: (1) corrupt/unparseable checkpoint file — verify `findingsCount` still updates from filesystem without crashing (lines 431-432), (2) timer setup via `start()` — verify polling interval is created and callbacks fire using `vi.useFakeTimers()` (lines 440-441). See requirements.md Item 4.
- **Verification**: Run `npx vitest run --coverage tests/progress-display.test.ts` and confirm branch coverage is above 95%.

### TASK-005a: Extract consolidation types into consolidation/types.ts
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Create `src/consolidation/` directory. Extract all shared interfaces and type definitions from the top of `src/consolidation.ts` (lines ~1-50) into `src/consolidation/types.ts`. This includes `DuplicateGroup`, `DeduplicationResult`, `ConsolidationResult`, and any other shared types. Keep the original `consolidation.ts` intact for now — just create the new types file. Other submodules will import from this file.
- **Verification**: Run `npx tsc --noEmit src/consolidation/types.ts` — no type errors.

### TASK-005b: Extract deduplication logic into consolidation/deduplication.ts
- **Status**: done
- **Dependencies**: TASK-005a
- **Description**: Move deduplication functions from `src/consolidation.ts` (lines ~51-313) into `src/consolidation/deduplication.ts`. Functions: `buildDeduplicationPrompt`, `parseDeduplicationResponse`, `mergeDuplicateGroup`, `applyDeduplication`, `collectFindings`, `detectDuplicates`, `consolidateReports`. Import types from `./types.ts`. Keep original functions in `consolidation.ts` for now (they'll be removed in TASK-005f).
- **Verification**: Run `npx tsc --noEmit src/consolidation/deduplication.ts` — no type errors.

### TASK-005c: Extract ID reassignment logic into consolidation/reassignment.ts
- **Status**: done
- **Dependencies**: TASK-005a
- **Description**: Move ID reassignment and screenshot functions from `src/consolidation.ts` (lines ~315-662) into `src/consolidation/reassignment.ts`. Functions: `buildFinalId`, `parseScreenshotRefs`, `extractInstanceFromScreenshot`, `buildNewScreenshotFilenames`, `parseConsolidatedReport`, `detectCrossRunDuplicates`, `filterCrossRunDuplicates`, `parseExistingReportIds`, `reassignIds`, `copyScreenshots`, `reassignAndRemapScreenshots`. Import types from `./types.ts`.
- **Verification**: Run `npx tsc --noEmit src/consolidation/reassignment.ts` — no type errors.

### TASK-005d: Extract hierarchy logic into consolidation/hierarchy.ts
- **Status**: done
- **Dependencies**: TASK-005a
- **Description**: Move hierarchical grouping functions from `src/consolidation.ts` (lines ~664-969) into `src/consolidation/hierarchy.ts`. Functions: `groupFindingsByArea`, `buildHierarchyPrompt`, `parseHierarchyResponse`, `buildHierarchy`, `determineHierarchy`, `organizeHierarchically`, `formatFindingMetadata`, `renderHierarchicalFindingMd`, `formatConsolidatedReport`. Import types from `./types.ts`.
- **Verification**: Run `npx tsc --noEmit src/consolidation/hierarchy.ts` — no type errors.

### TASK-005e: Extract discovery consolidation into consolidation/discovery.ts
- **Status**: done
- **Dependencies**: TASK-005a
- **Description**: Move discovery consolidation functions from `src/consolidation.ts` (lines ~971-1153) into `src/consolidation/discovery.ts`. Functions: `readAllDiscoveryDocs`, `buildDiscoveryConsolidationPrompt`, `consolidateDiscoveryDocs`, `writeConsolidatedDiscovery`, `generatePlanTemplate`. Import types from `./types.ts`.
- **Verification**: Run `npx tsc --noEmit src/consolidation/discovery.ts` — no type errors.

### TASK-005f: Create barrel index.ts, update all imports, delete original consolidation.ts
- **Status**: done
- **Dependencies**: TASK-005b, TASK-005c, TASK-005d, TASK-005e
- **Description**: Create `src/consolidation/index.ts` that re-exports all public APIs from the submodules (types, deduplication, reassignment, hierarchy, discovery). Update ALL import paths throughout the codebase that reference `./consolidation.js` to reference `./consolidation/index.js`. Update ALL test file imports (`tests/consolidation.test.ts`, `tests/consolidation-resume.test.ts`, and any others) to use the new paths. Delete the original `src/consolidation.ts`. Verify the barrel file exports match exactly what the old file exported — no public API changes.
- **Verification**: Run `npx vitest run tests/consolidation.test.ts tests/consolidation-resume.test.ts` — all tests pass. Run `npx tsc --noEmit` — no type errors across the entire project. Grep for any remaining imports of the old path: `grep -rn "from.*['\"].*\/consolidation\.js['\"]" src/` should return zero matches outside `src/consolidation/`.
