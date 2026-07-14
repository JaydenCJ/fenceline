/**
 * The decision engine: one path in, one verdict out. Zones are evaluated in
 * file order and the first zone that matches decides — so narrow carve-outs
 * belong in `except`, and more specific zones belong above broader ones.
 * The engine is pure: it never reads the filesystem it rules on.
 */

import { compilePattern, type CompiledPattern } from "./glob.js";
import { normalizePath } from "./paths.js";
import type { CheckItem, Op, Policy, TraceStep, Verdict, Zone } from "./types.js";

interface CompiledZone {
  zone: Zone;
  paths: CompiledPattern[];
  except: CompiledPattern[];
}

/** A policy with its patterns compiled once, reusable across many paths. */
export interface CompiledPolicy {
  policy: Policy;
  zones: CompiledZone[];
}

export function compilePolicy(policy: Policy): CompiledPolicy {
  return {
    policy,
    zones: policy.zones.map((zone) => ({
      zone,
      paths: zone.paths.map(compilePattern),
      except: zone.except.map(compilePattern),
    })),
  };
}

function zoneReason(zone: Zone): string {
  return zone.reason ?? `protected by zone "${zone.id}"`;
}

/**
 * Decide one proposed change. `root` is the absolute fenced root; relative
 * paths in `item` are interpreted against it.
 */
export function evaluate(compiled: CompiledPolicy, item: CheckItem, root: string): Verdict {
  const op: Op = item.op ?? "edit";
  const normalized = normalizePath(item.path, root);

  if (normalized.invalid !== null) {
    return {
      decision: "block",
      zone: null,
      reason: `unusable path: ${normalized.invalid}`,
      hint: null,
      path: item.path,
      op,
      outside: false,
      trace: [],
    };
  }

  if (normalized.outside) {
    const blocked = compiled.policy.outside === "block";
    return {
      decision: blocked ? "block" : "allow",
      zone: null,
      reason: blocked
        ? `path resolves outside the fenced root (policy "outside" is "block")`
        : `path resolves outside the fenced root; not fenceline's concern (policy "outside" is "ignore")`,
      hint: null,
      path: normalized.rel,
      op,
      outside: true,
      trace: [],
    };
  }

  const trace: TraceStep[] = [];
  for (const { zone, paths, except } of compiled.zones) {
    const matched = paths.find((p) => p.test(normalized.segments));
    if (matched === undefined) {
      trace.push({ zone: zone.id, action: zone.action, outcome: "no-match", detail: "no pattern matched" });
      continue;
    }
    if (!zone.ops.includes(op)) {
      trace.push({
        zone: zone.id,
        action: zone.action,
        outcome: "op-skipped",
        detail: `matched "${matched.source}" but zone only covers ${zone.ops.join("/")} (proposed: ${op})`,
      });
      continue;
    }
    const excepted = except.find((p) => p.test(normalized.segments));
    if (excepted !== undefined) {
      trace.push({
        zone: zone.id,
        action: zone.action,
        outcome: "excepted",
        detail: `matched "${matched.source}" but excepted by "${excepted.source}"`,
      });
      continue;
    }
    trace.push({
      zone: zone.id,
      action: zone.action,
      outcome: "matched",
      detail: `matched "${matched.source}" (op: ${op})`,
    });
    return {
      decision: zone.action,
      zone: zone.id,
      reason: zoneReason(zone),
      hint: zone.hint,
      path: normalized.rel,
      op,
      outside: false,
      trace,
    };
  }

  return {
    decision: "allow",
    zone: null,
    reason: "no zone matched",
    hint: null,
    path: normalized.rel,
    op,
    outside: false,
    trace,
  };
}

/** Decide many paths at once, preserving input order. */
export function evaluateAll(compiled: CompiledPolicy, items: CheckItem[], root: string): Verdict[] {
  return items.map((item) => evaluate(compiled, item, root));
}
