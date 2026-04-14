// Barrel file — re-exports all public APIs from consolidation submodules.

// Types and shared definitions
export {
  Finding,
  DuplicateGroup,
  DeduplicationResult,
  ConsolidationResult,
  SEVERITY_RANK,
} from './types.js';

// Deduplication
export {
  buildDeduplicationPrompt,
  parseDeduplicationResponse,
  mergeDuplicateGroup,
  applyDeduplication,
  collectFindings,
  detectDuplicates,
  consolidateReports,
} from './deduplication.js';

// ID Reassignment & Screenshots
export {
  ScreenshotCopyOp,
  ReassignmentResult,
  buildFinalId,
  parseScreenshotRefs,
  extractInstanceFromScreenshot,
  buildNewScreenshotFilenames,
  parseConsolidatedReport,
  detectCrossRunDuplicates,
  filterCrossRunDuplicates,
  parseExistingReportIds,
  reassignIds,
  copyScreenshots,
  reassignAndRemapScreenshots,
} from './reassignment.js';

// Hierarchical organization
export {
  HierarchicalFinding,
  UIAreaGroup,
  groupFindingsByArea,
  buildHierarchyPrompt,
  parseHierarchyResponse,
  buildHierarchy,
  determineHierarchy,
  organizeHierarchically,
  formatConsolidatedReport,
} from './hierarchy.js';

// Discovery consolidation
export {
  DiscoveryConsolidationResult,
  readAllDiscoveryDocs,
  buildDiscoveryConsolidationPrompt,
  consolidateDiscoveryDocs,
  writeConsolidatedDiscovery,
  generatePlanTemplate,
} from './discovery.js';
