/**
 * code/index.ts
 *
 * Public entry for the BREAK 7 CodeAgent package.
 */

export {
  CodeActInterpreter,
  extractBlame,
  cleanupWorkspace,
  type CodeActOptions,
  type CodeCellResult,
} from "./interpreter.js";

export {
  isLikelySandboxDenied,
  suggestedEscalation,
  type CommandOutputLike,
} from "./sandbox_heuristic.js";

export {
  makeSearchTool,
  makeDocTool,
  makeSymbolNavTool,
  makeFormatTool,
  makeApplyPatchTool,
  parsePatch,
  type ParsedHunk,
  type SymbolResolution,
} from "./tools/index.js";

export {
  SelfDebugLoop,
  type SelfDebugOptions,
  type SelfDebugOutcome,
  type SelfDebugReasoner,
  type FailureContext,
} from "./self_debug.js";

export * as Reasoners from "./reasoners/index.js";

export {
  // P0-1 — linter-guarded edit
  linterGuardedEdit,
  noopLinter,
  regexLinter,
  type LinterFn,
  type LinterRunResult,
  // P0-2 — Testing Agent
  generateFail2PassTests,
  type TestCase,
  type TestingAgentDeps,
  // P1-3 — Episode Budget
  makeEpisodeBudget,
  type EpisodeBudgetOptions,
  type EpisodeBudgetState,
  // P1-4 — State Snapshot
  writeSnapshot,
  readSnapshot,
  capturePrimitives,
  type KernelSnapshot,
  type GlobalsSnapshot,
  // P1-5 — Observation Compressor
  compressObservations,
  type CompressOptions,
  // P1-6 — JoyCode Voting
  scorePatch,
  voteBest,
  JOYCODE_WEIGHTS,
  type PatchCandidate,
  // P2-7 — Feedback Event
  buildFeedbackEvent,
  isNameError,
  isImportError,
  type FeedbackEvent,
  // P2-8 — Fuzzy Patch
  fuzzyFind,
  applyFuzzy,
  // P2-9 — Docker Isolation
  isDockerAvailable,
  dockerRunPython,
  type DockerRunOptions,
  // P3-10 — Mini Variant
  makeMiniVariant,
  makeMiniEditFile,
  makeMiniToolSet,
  type MiniTool,
  type MiniVariantOptions,
} from "./v02.js";
