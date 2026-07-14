/**
 * Shared types for the fenceline policy engine. Everything here is plain
 * data: the engine takes paths and a compiled policy, never file handles,
 * so decisions stay pure, deterministic and unit-testable.
 */

/** What a zone does to a path it protects. */
export type Action = "block" | "ask" | "warn";

/** The final verdict for one path — a zone action, or `allow` when unfenced. */
export type Decision = "allow" | Action;

/** The kind of change being proposed against a path. */
export type Op = "edit" | "create" | "delete" | "rename";

export const ALL_OPS: readonly Op[] = ["edit", "create", "delete", "rename"];
export const ACTIONS: readonly Action[] = ["block", "ask", "warn"];
export const DECISIONS: readonly Decision[] = ["allow", "block", "ask", "warn"];

/** One protected zone, compiled from the policy file. */
export interface Zone {
  /** Unique identifier, named in every decision that this zone makes. */
  id: string;
  action: Action;
  /** Patterns the zone protects (gitignore-flavored globs, see docs). */
  paths: string[];
  /** Patterns carved out of the zone — matching paths fall through. */
  except: string[];
  /** Operations the zone applies to; others fall through to later zones. */
  ops: Op[];
  /** Human explanation surfaced with every decision. */
  reason: string | null;
  /** Optional remediation hint ("run npm install instead"). */
  hint: string | null;
}

/** How to treat paths that resolve outside the fenced root. */
export type OutsideMode = "ignore" | "block";

/** A pinned expectation, run by `fenceline test`. */
export interface PolicyTest {
  name: string;
  path: string;
  op: Op;
  expect: Decision;
  /** When set, the deciding zone must also match. */
  zone: string | null;
}

/** A fully validated, compiled policy. */
export interface Policy {
  version: 1;
  outside: OutsideMode;
  zones: Zone[];
  tests: PolicyTest[];
}

/** One path (plus the proposed operation) to check. */
export interface CheckItem {
  path: string;
  op?: Op;
}

/** Why a particular zone did or did not decide, in evaluation order. */
export interface TraceStep {
  zone: string;
  action: Action;
  outcome: "matched" | "excepted" | "op-skipped" | "no-match";
  detail: string;
}

/** The engine's answer for one path. */
export interface Verdict {
  decision: Decision;
  /** Deciding zone id, or null for allow / outside / invalid paths. */
  zone: string | null;
  reason: string;
  hint: string | null;
  /** The normalized root-relative path the decision was made on. */
  path: string;
  op: Op;
  /** True when the path resolved outside the fenced root. */
  outside: boolean;
  trace: TraceStep[];
}

/** Severity order used when one event carries several paths. */
export function worseOf(a: Decision, b: Decision): Decision {
  const rank: Record<Decision, number> = { allow: 0, warn: 1, ask: 2, block: 3 };
  return rank[b] > rank[a] ? b : a;
}
