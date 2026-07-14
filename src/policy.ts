/**
 * Strict policy loading. A fence file is a security artifact, so the loader
 * refuses anything it does not fully understand: unknown keys, duplicate
 * zone ids, empty pattern lists and uncompilable globs are hard errors, each
 * reported with its JSON path. A policy that parses is a policy whose every
 * key is doing what the author thinks it is.
 */

import { readFileSync } from "node:fs";
import {
  ACTIONS,
  ALL_OPS,
  DECISIONS,
  type Action,
  type Decision,
  type Op,
  type OutsideMode,
  type Policy,
  type PolicyTest,
  type Zone,
} from "./types.js";
import { validatePattern } from "./glob.js";

/** All problems found in a policy document, each with its JSON path. */
export class PolicyError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.name = "PolicyError";
    this.problems = problems;
  }
}

const ZONE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const TOP_KEYS = new Set(["version", "outside", "zones", "tests"]);
const ZONE_KEYS = new Set(["id", "action", "paths", "except", "ops", "reason", "hint"]);
const TEST_KEYS = new Set(["name", "path", "op", "expect", "zone"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse and validate a raw (already JSON-decoded) policy document. */
export function parsePolicy(raw: unknown): Policy {
  const problems: string[] = [];
  if (!isRecord(raw)) throw new PolicyError(["policy: must be a JSON object"]);

  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.has(key)) problems.push(`policy.${key}: unknown key`);
  }
  if (raw.version !== 1) problems.push(`policy.version: must be 1`);

  let outside: OutsideMode = "ignore";
  if (raw.outside !== undefined) {
    if (raw.outside === "ignore" || raw.outside === "block") outside = raw.outside;
    else problems.push(`policy.outside: must be "ignore" or "block"`);
  }

  const zones: Zone[] = [];
  const seenIds = new Set<string>();
  if (!Array.isArray(raw.zones) || raw.zones.length === 0) {
    problems.push(`policy.zones: must be a non-empty array — a fence with no zones protects nothing`);
  } else {
    raw.zones.forEach((rawZone, i) => {
      const zone = parseZone(rawZone, `zones[${i}]`, problems);
      if (zone !== null) {
        if (seenIds.has(zone.id)) problems.push(`zones[${i}].id: duplicate zone id "${zone.id}"`);
        seenIds.add(zone.id);
        zones.push(zone);
      }
    });
  }

  const tests: PolicyTest[] = [];
  if (raw.tests !== undefined) {
    if (!Array.isArray(raw.tests)) {
      problems.push(`policy.tests: must be an array`);
    } else {
      raw.tests.forEach((rawTest, i) => {
        const test = parseTest(rawTest, `tests[${i}]`, seenIds, problems);
        if (test !== null) tests.push(test);
      });
    }
  }

  if (problems.length > 0) throw new PolicyError(problems);
  return { version: 1, outside, zones, tests };
}

function parseZone(raw: unknown, at: string, problems: string[]): Zone | null {
  if (!isRecord(raw)) {
    problems.push(`${at}: must be an object`);
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (!ZONE_KEYS.has(key)) problems.push(`${at}.${key}: unknown key`);
  }

  let id = "";
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    problems.push(`${at}.id: required, a non-empty string`);
  } else if (!ZONE_ID.test(raw.id)) {
    problems.push(`${at}.id: must match ${ZONE_ID} (lowercase letters, digits, ., _, -)`);
  } else {
    id = raw.id;
  }

  let action: Action = "block";
  if (typeof raw.action !== "string" || !(ACTIONS as readonly string[]).includes(raw.action)) {
    problems.push(`${at}.action: required, one of ${ACTIONS.map((a) => `"${a}"`).join(", ")}`);
  } else {
    action = raw.action as Action;
  }

  const paths = parsePatternList(raw.paths, `${at}.paths`, problems, true);
  const except = raw.except === undefined ? [] : parsePatternList(raw.except, `${at}.except`, problems, false);

  let ops: Op[] = [...ALL_OPS];
  if (raw.ops !== undefined) {
    if (!Array.isArray(raw.ops) || raw.ops.length === 0) {
      problems.push(`${at}.ops: must be a non-empty array of operations`);
    } else {
      const parsed: Op[] = [];
      raw.ops.forEach((op, i) => {
        if (typeof op !== "string" || !(ALL_OPS as readonly string[]).includes(op)) {
          problems.push(`${at}.ops[${i}]: must be one of ${ALL_OPS.map((o) => `"${o}"`).join(", ")}`);
        } else if (parsed.includes(op as Op)) {
          problems.push(`${at}.ops[${i}]: duplicate operation "${op}"`);
        } else {
          parsed.push(op as Op);
        }
      });
      ops = parsed;
    }
  }

  const reason = parseOptionalString(raw.reason, `${at}.reason`, problems);
  const hint = parseOptionalString(raw.hint, `${at}.hint`, problems);

  return { id, action, paths, except, ops, reason, hint };
}

function parsePatternList(raw: unknown, at: string, problems: string[], required: boolean): string[] {
  if (!Array.isArray(raw) || (required && raw.length === 0)) {
    problems.push(`${at}: must be a non-empty array of patterns`);
    return [];
  }
  const patterns: string[] = [];
  raw.forEach((pattern, i) => {
    if (typeof pattern !== "string") {
      problems.push(`${at}[${i}]: must be a string`);
      return;
    }
    const problem = validatePattern(pattern);
    if (problem !== null) {
      problems.push(`${at}[${i}]: ${problem}`);
      return;
    }
    patterns.push(pattern);
  });
  return patterns;
}

function parseOptionalString(raw: unknown, at: string, problems: string[]): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string" || raw.length === 0) {
    problems.push(`${at}: must be a non-empty string`);
    return null;
  }
  return raw;
}

function parseTest(raw: unknown, at: string, zoneIds: Set<string>, problems: string[]): PolicyTest | null {
  if (!isRecord(raw)) {
    problems.push(`${at}: must be an object`);
    return null;
  }
  for (const key of Object.keys(raw)) {
    if (!TEST_KEYS.has(key)) problems.push(`${at}.${key}: unknown key`);
  }
  const before = problems.length;

  if (typeof raw.name !== "string" || raw.name.length === 0) {
    problems.push(`${at}.name: required, a non-empty string`);
  }
  if (typeof raw.path !== "string" || raw.path.length === 0) {
    problems.push(`${at}.path: required, a non-empty string`);
  }
  let op: Op = "edit";
  if (raw.op !== undefined) {
    if (typeof raw.op !== "string" || !(ALL_OPS as readonly string[]).includes(raw.op)) {
      problems.push(`${at}.op: must be one of ${ALL_OPS.map((o) => `"${o}"`).join(", ")}`);
    } else {
      op = raw.op as Op;
    }
  }
  let expect: Decision = "allow";
  if (typeof raw.expect !== "string" || !(DECISIONS as readonly string[]).includes(raw.expect)) {
    problems.push(`${at}.expect: required, one of ${DECISIONS.map((d) => `"${d}"`).join(", ")}`);
  } else {
    expect = raw.expect as Decision;
  }
  let zone: string | null = null;
  if (raw.zone !== undefined) {
    if (typeof raw.zone !== "string" || !zoneIds.has(raw.zone)) {
      problems.push(`${at}.zone: must name an existing zone id`);
    } else {
      zone = raw.zone;
    }
  }

  if (problems.length > before) return null;
  return { name: raw.name as string, path: raw.path as string, op, expect, zone };
}

/** Read, JSON-decode and validate a policy file. I/O errors surface as-is. */
export function loadPolicy(file: string): Policy {
  const text = readFileSync(file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new PolicyError([`policy: not valid JSON — ${(err as Error).message}`]);
  }
  return parsePolicy(raw);
}
