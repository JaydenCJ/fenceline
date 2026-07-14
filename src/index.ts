/**
 * fenceline — declarative protected-path rules for repositories, enforced
 * as agent hooks and a standalone checker.
 *
 * Programmatic surface: load a fence file (or build one as data), compile
 * it once, then ask for verdicts. Everything is pure and synchronous; the
 * only I/O in this library is `loadPolicy` reading the file you name.
 */

export { VERSION } from "./version.js";
export {
  ACTIONS,
  ALL_OPS,
  DECISIONS,
  worseOf,
  type Action,
  type CheckItem,
  type Decision,
  type Op,
  type OutsideMode,
  type Policy,
  type PolicyTest,
  type TraceStep,
  type Verdict,
  type Zone,
} from "./types.js";
export { loadPolicy, parsePolicy, PolicyError } from "./policy.js";
export { compilePolicy, evaluate, evaluateAll, type CompiledPolicy } from "./engine.js";
export { compilePattern, expandBraces, matchPattern, validatePattern, type CompiledPattern } from "./glob.js";
export { normalizePath, type NormalizedPath } from "./paths.js";
export { parseDiff, unquotePath } from "./diff.js";
export {
  claudeHookReply,
  exitCodeFor,
  genericReply,
  parseClaudeEvent,
  parseGenericEvent,
  summarize,
  verdictSentence,
  type HarnessEvent,
} from "./harness.js";
export {
  claudeHookEntry,
  claudeSettingsSnippet,
  genericProtocolHelp,
  gitPreCommitScript,
  mergeClaudeSettings,
} from "./emit.js";
export { runPolicyTests, type TestReport, type TestResult } from "./selftest.js";
export { presetPolicy, PRESET_NAMES } from "./presets.js";
