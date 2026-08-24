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
