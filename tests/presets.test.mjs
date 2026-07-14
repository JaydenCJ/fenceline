// Every preset must hold fenceline to its own standard: parse under the
// strict loader and pass its own embedded tests, so `fenceline init` never
// hands out a fence that fails `fenceline test` on day one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePolicy, evaluate } from "../dist/engine.js";
import { parsePolicy } from "../dist/policy.js";
import { PRESET_NAMES, presetPolicy } from "../dist/presets.js";
import { runPolicyTests } from "../dist/selftest.js";
import { FENCED_ROOT } from "./helpers.mjs";

test("the preset list is stable, unknown names return null, copies are fresh", () => {
  assert.deepEqual([...PRESET_NAMES].sort(), ["base", "go", "node", "python", "rust"]);
  assert.equal(presetPolicy("cobol"), null);
  const first = presetPolicy("base");
  first.zones.length = 0;
  assert.ok(presetPolicy("base").zones.length > 0, "mutating one copy must not affect the next");
});

for (const name of ["base", "node", "python", "rust", "go"]) {
  test(`preset "${name}" parses strictly and passes its own embedded tests`, () => {
    const policy = parsePolicy(presetPolicy(name));
    assert.ok(policy.tests.length >= 4, "presets must ship with embedded tests");
    const report = runPolicyTests(compilePolicy(policy), FENCED_ROOT);
    assert.equal(report.failed, 0, report.results.filter((r) => !r.ok).map((r) => r.detail).join("; "));
  });
}

test("the python preset distinguishes editing from creating a migration", () => {
  const compiledPolicy = compilePolicy(parsePolicy(presetPolicy("python")));
  const edited = evaluate(compiledPolicy, { path: "app/migrations/0042_x.py", op: "edit" }, FENCED_ROOT);
  const created = evaluate(compiledPolicy, { path: "app/migrations/0043_y.py", op: "create" }, FENCED_ROOT);
  assert.equal(edited.decision, "block");
  assert.equal(created.decision, "allow");
});
