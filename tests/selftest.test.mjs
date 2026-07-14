// Embedded policy tests are the fence's own regression suite: they must
// fail loudly when a decision or the deciding zone changes, and pass
// quietly when everything is pinned correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePolicy } from "../dist/engine.js";
import { parsePolicy } from "../dist/policy.js";
import { runPolicyTests } from "../dist/selftest.js";
import { FENCED_ROOT, rawPolicy, zone } from "./helpers.mjs";

function reportFor(zones, tests) {
  return runPolicyTests(compilePolicy(parsePolicy(rawPolicy(zones, { tests }))), FENCED_ROOT);
}

test("a correct pin passes, and a testless policy reports zero of each", () => {
  const report = reportFor(
    [zone({ id: "locks", paths: ["*.lock"] })],
    [{ name: "locks are fenced", path: "Cargo.lock", expect: "block", zone: "locks" }],
  );
  assert.deepEqual({ passed: report.passed, failed: report.failed }, { passed: 1, failed: 0 });
  const empty = reportFor([zone()], []);
  assert.deepEqual({ passed: empty.passed, failed: empty.failed }, { passed: 0, failed: 0 });
});

test("a wrong expected decision fails with what actually happened", () => {
  const report = reportFor(
    [zone({ id: "locks", paths: ["*.lock"] })],
    [{ name: "wrong", path: "Cargo.lock", expect: "allow" }],
  );
  assert.equal(report.failed, 1);
  assert.match(report.results[0].detail, /expected allow, got block \[zone locks\]/);
});

test("a decision made by the wrong zone fails even if the action matches", () => {
  const report = reportFor(
    [
      zone({ id: "first", paths: ["shared.txt"] }),
      zone({ id: "second", paths: ["shared.txt"] }),
    ],
    [{ name: "pinned to the shadowed zone", path: "shared.txt", expect: "block", zone: "second" }],
  );
  assert.equal(report.failed, 1);
  assert.match(report.results[0].detail, /zone "first" did/);
});

test("op-specific pins exercise the zone's op filter", () => {
  const report = reportFor(
    [zone({ id: "mig", paths: ["migrations/*.sql"], ops: ["edit"] })],
    [
      { name: "edits blocked", path: "migrations/0001.sql", op: "edit", expect: "block", zone: "mig" },
      { name: "creates allowed", path: "migrations/0002.sql", op: "create", expect: "allow" },
    ],
  );
  assert.deepEqual({ passed: report.passed, failed: report.failed }, { passed: 2, failed: 0 });
});
