/**
 * Harness adapters: translate an agent harness's "the model wants to touch
 * this file" event into engine inputs, and the engine's verdict back into
 * whatever that harness understands.
 *
 * Two protocols ship in 0.1.0:
 *
 *   - `claude-code` — a PreToolUse hook event (`{tool_name, tool_input}`)
 *     in, a `hookSpecificOutput.permissionDecision` JSON answer out.
 *   - `generic` — `{path, op?}` in, `{decision, zone, reason}` out with the
 *     allow/block/ask exit-code triad; the adapter of last resort for any
 *     harness that can run a command.
 *
 * Parsing is defensive: an event this module does not recognize maps to
 * "not a file change" (null), never to a crash.
 */

import type { CheckItem, Decision, Op, Verdict } from "./types.js";
import { ALL_OPS, worseOf } from "./types.js";

/** A recognized file-touching event, ready for the engine. */
export interface HarnessEvent {
  tool: string;
  items: CheckItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Parse a Claude Code PreToolUse event. Returns null for tools that do not
 * touch files (the hook must let those through untouched). `exists` lets
 * the adapter tell a `Write` that creates a file from one that overwrites —
 * injected so tests stay filesystem-free.
 */
export function parseClaudeEvent(raw: unknown, exists: (path: string) => boolean): HarnessEvent | null {
  if (!isRecord(raw)) return null;
  const tool = str(raw.tool_name);
  const input = isRecord(raw.tool_input) ? raw.tool_input : {};
  if (tool === null) return null;

  switch (tool) {
    case "Edit":
    case "MultiEdit": {
      const path = str(input.file_path);
      return path === null ? null : { tool, items: [{ path, op: "edit" }] };
    }
    case "Write": {
      const path = str(input.file_path);
      if (path === null) return null;
      return { tool, items: [{ path, op: exists(path) ? "edit" : "create" }] };
    }
    case "NotebookEdit": {
      const path = str(input.notebook_path);
      return path === null ? null : { tool, items: [{ path, op: "edit" }] };
    }
    default:
      return null;
  }
}

/** Parse a generic-protocol event: `{"path": "...", "op": "edit"}`. */
export function parseGenericEvent(raw: unknown): HarnessEvent | { error: string } {
  if (!isRecord(raw)) return { error: "event must be a JSON object" };
  const path = str(raw.path);
  if (path === null) return { error: `event.path: required, a non-empty string` };
  let op: Op = "edit";
  if (raw.op !== undefined) {
    if (typeof raw.op !== "string" || !(ALL_OPS as readonly string[]).includes(raw.op)) {
      return { error: `event.op: must be one of ${ALL_OPS.map((o) => `"${o}"`).join(", ")}` };
    }
    op = raw.op as Op;
  }
  for (const key of Object.keys(raw)) {
    if (key !== "path" && key !== "op") return { error: `event.${key}: unknown key` };
  }
  return { tool: "generic", items: [{ path, op }] };
}

/** The worst decision across an event's verdicts, with the verdict that set it. */
export function summarize(verdicts: Verdict[]): { decision: Decision; verdict: Verdict | null } {
  let worst: Verdict | null = null;
  for (const verdict of verdicts) {
    if (worst === null || worseOf(worst.decision, verdict.decision) !== worst.decision) worst = verdict;
  }
  return { decision: worst?.decision ?? "allow", verdict: worst };
}

/** One human sentence explaining a verdict, used in every harness reply. */
export function verdictSentence(verdict: Verdict): string {
  const zone = verdict.zone !== null ? ` [zone ${verdict.zone}]` : "";
  const hint = verdict.hint !== null ? ` — ${verdict.hint}` : "";
  return `fenceline: "${verdict.path}" (${verdict.op})${zone}: ${verdict.reason}${hint}`;
}

/**
 * Render the Claude Code PreToolUse JSON answer, or null when the hook
 * should stay silent (a plain allow). `block` maps to a hard deny, `ask`
 * defers to the human, and `warn` allows but surfaces the reason.
 */
export function claudeHookReply(verdicts: Verdict[]): string | null {
  const { decision, verdict } = summarize(verdicts);
  if (decision === "allow" || verdict === null) return null;
  const permission = decision === "block" ? "deny" : decision === "ask" ? "ask" : "allow";
  const reply = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: permission,
      permissionDecisionReason: verdictSentence(verdict),
    },
  };
  return JSON.stringify(reply);
}

/** Render the generic-protocol JSON answer (always emitted). */
export function genericReply(verdicts: Verdict[]): string {
  const { decision, verdict } = summarize(verdicts);
  const reply = {
    decision,
    zone: verdict?.zone ?? null,
    reason: verdict !== null ? verdictSentence(verdict) : "fenceline: no zone matched",
  };
  return JSON.stringify(reply);
}

/** Exit code for the generic protocol: allow/warn 0, block 1, ask 3. */
export function exitCodeFor(decision: Decision): number {
  if (decision === "block") return 1;
  if (decision === "ask") return 3;
  return 0;
}
