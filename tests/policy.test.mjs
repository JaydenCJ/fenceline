// The loader is strict on purpose: a fence file with a typo that silently
// protects nothing is worse than no fence at all. Every rejection here
// must carry the JSON path of the offending key so the fix is one glance
// away.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPolicy, parsePolicy, PolicyError } from "../dist/policy.js";
import { rawPolicy, writePolicyFile, zone } from "./helpers.mjs";

function problemsOf(raw) {
  try {
    parsePolicy(raw);
  } catch (err) {
    assert.ok(err instanceof PolicyError, "expected a PolicyError");
    return err.problems;
  }
  assert.fail("expected the policy to be rejected");
}

test("a minimal valid policy parses with defaults filled in", () => {
  const policy = parsePolicy(rawPolicy([zone()]));
  assert.equal(policy.outside, "ignore");
  assert.deepEqual(policy.tests, []);
  const z = policy.zones[0];
  assert.deepEqual(z.except, []);
  assert.deepEqual(z.ops, ["edit", "create", "delete", "rename"]);
  assert.equal(z.reason, null);
  assert.equal(z.hint, null);
});

test("wrong versions and unknown keys are rejected with their JSON path", () => {
  assert.ok(problemsOf({ version: 2, zones: [zone()] }).some((p) => p.includes("policy.version")));
  assert.ok(
    problemsOf({ ...rawPolicy([zone()]), zonez: [] }).some((p) => p.includes("policy.zonez: unknown key")),
  );
  assert.ok(
    problemsOf(rawPolicy([zone({ pattern: "x" })])).some((p) => p.includes("zones[0].pattern: unknown key")),
  );
});

test("an empty zones array is an error — a fence must protect something", () => {
  assert.ok(problemsOf(rawPolicy([])).some((p) => p.includes("policy.zones")));
});

test("duplicate zone ids are rejected", () => {
  const problems = problemsOf(rawPolicy([zone({ id: "dup" }), zone({ id: "dup" })]));
  assert.ok(problems.some((p) => p.includes(`duplicate zone id "dup"`)));
});

test("zone ids must be slug-shaped and actions must be block/ask/warn", () => {
  assert.ok(problemsOf(rawPolicy([zone({ id: "Not OK" })])).some((p) => p.includes("zones[0].id")));
  assert.ok(problemsOf(rawPolicy([zone({ action: "deny" })])).some((p) => p.includes("zones[0].action")));
});

test("an uncompilable glob is rejected at its exact index", () => {
  const problems = problemsOf(rawPolicy([zone({ paths: ["ok.txt", "bad["] })]));
  assert.ok(problems.some((p) => p.includes("zones[0].paths[1]")));
});

test("ops must be known operations without duplicates", () => {
  assert.ok(
    problemsOf(rawPolicy([zone({ ops: ["edit", "chmod"] })])).some((p) => p.includes("zones[0].ops[1]")),
  );
  assert.ok(
    problemsOf(rawPolicy([zone({ ops: ["edit", "edit"] })])).some((p) => p.includes("duplicate operation")),
  );
});

test("several problems are reported in one pass, not one at a time", () => {
  const problems = problemsOf({
    version: 2,
    zones: [zone({ action: "deny" }), zone({ id: "ok", paths: [] })],
  });
  assert.ok(problems.length >= 3, `expected >=3 problems, got: ${problems.join(" | ")}`);
});

test("embedded tests are validated, and a valid one defaults its op to edit", () => {
  const problems = problemsOf(
    rawPolicy([zone({ id: "z1" })], {
      tests: [
        { name: "t", path: "x", expect: "denied" },
        { name: "t2", path: "y", expect: "block", zone: "ghost" },
      ],
    }),
  );
  assert.ok(problems.some((p) => p.includes("tests[0].expect")));
  assert.ok(problems.some((p) => p.includes("tests[1].zone")));

  const policy = parsePolicy(
    rawPolicy([zone({ id: "z1" })], { tests: [{ name: "t", path: "fenced.txt", expect: "block", zone: "z1" }] }),
  );
  assert.equal(policy.tests[0].op, "edit");
  assert.equal(policy.tests[0].zone, "z1");
});

test("non-JSON input to loadPolicy raises PolicyError, not a JSON stack", () => {
  const file = writePolicyFile("{not json");
  assert.throws(() => loadPolicy(file), (err) => err instanceof PolicyError && /not valid JSON/.test(err.message));
});
