// The engine's promises: first matching zone decides, carve-outs fall
// through, op filters skip cleanly, outside-root paths follow the policy's
// `outside` mode, and every decision carries a trace that says why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../dist/engine.js";
import { compiled, FENCED_ROOT } from "./helpers.mjs";

test("an unfenced path is allowed with an explicit trace", () => {
  const c = compiled([{ id: "locks", action: "block", paths: ["*.lock"] }]);
  const v = evaluate(c, { path: "src/main.rs" }, FENCED_ROOT);
  assert.equal(v.decision, "allow");
  assert.equal(v.zone, null);
  assert.deepEqual(v.trace.map((s) => s.outcome), ["no-match"]);
});

test("the first matching zone decides — order is priority", () => {
  const c = compiled([
    { id: "readme-ask", action: "ask", paths: ["docs/README.md"] },
    { id: "docs-block", action: "block", paths: ["docs/"] },
  ]);
  assert.equal(evaluate(c, { path: "docs/README.md" }, FENCED_ROOT).zone, "readme-ask");
  assert.equal(evaluate(c, { path: "docs/design.md" }, FENCED_ROOT).zone, "docs-block");
});

test("except carves a hole and the path falls through to later zones", () => {
  const c = compiled([
    { id: "env", action: "block", paths: [".env*"], except: [".env.example"] },
    { id: "everything", action: "warn", paths: ["*"] },
  ]);
  const v = evaluate(c, { path: ".env.example" }, FENCED_ROOT);
  assert.equal(v.zone, "everything");
  assert.equal(v.trace[0].outcome, "excepted");
});

test("a zone scoped to some ops skips others; op defaults to edit", () => {
  const c = compiled([
    { id: "migrations", action: "block", paths: ["migrations/*.sql"], ops: ["edit", "delete"] },
  ]);
  const defaulted = evaluate(c, { path: "migrations/0001.sql" }, FENCED_ROOT);
  assert.equal(defaulted.op, "edit");
  assert.equal(defaulted.decision, "block");
  const created = evaluate(c, { path: "migrations/0002.sql", op: "create" }, FENCED_ROOT);
  assert.equal(created.decision, "allow");
  assert.equal(created.trace[0].outcome, "op-skipped");
});

test("warn and ask surface as their own decisions", () => {
  const c = compiled([
    { id: "gen", action: "warn", paths: ["dist/"] },
    { id: "release", action: "ask", paths: ["CHANGELOG.md"] },
  ]);
  assert.equal(evaluate(c, { path: "dist/app.js" }, FENCED_ROOT).decision, "warn");
  assert.equal(evaluate(c, { path: "CHANGELOG.md" }, FENCED_ROOT).decision, "ask");
});

test("the verdict carries the zone's reason and hint, or a default", () => {
  const c = compiled([
    { id: "locks", action: "block", paths: ["*.lock"], reason: "generated", hint: "run the tool" },
    { id: "bare", action: "block", paths: ["bare.txt"] },
  ]);
  const v = evaluate(c, { path: "Cargo.lock" }, FENCED_ROOT);
  assert.equal(v.reason, "generated");
  assert.equal(v.hint, "run the tool");
  assert.match(evaluate(c, { path: "bare.txt" }, FENCED_ROOT).reason, /zone "bare"/);
});

test("normalization happens before zones — traversal and absolute forms cannot dodge", () => {
  const c = compiled([{ id: "locks", action: "block", paths: ["package-lock.json"] }]);
  const dodged = evaluate(c, { path: "./x/../package-lock.json" }, FENCED_ROOT);
  assert.equal(dodged.decision, "block");
  assert.equal(dodged.path, "package-lock.json");
  assert.equal(evaluate(c, { path: `${FENCED_ROOT}/package-lock.json` }, FENCED_ROOT).decision, "block");
});

test("outside-root paths follow the policy's outside mode", () => {
  const ignoring = compiled([{ id: "z", action: "block", paths: ["*"] }]);
  const allowed = evaluate(ignoring, { path: "/etc/hosts" }, FENCED_ROOT);
  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.outside, true);
  assert.match(allowed.reason, /outside the fenced root/);

  const blocking = compiled([{ id: "z", action: "block", paths: ["x"] }], { outside: "block" });
  const blocked = evaluate(blocking, { path: "../elsewhere/file" }, FENCED_ROOT);
  assert.equal(blocked.decision, "block");
  assert.equal(blocked.zone, null);
});

test("an invalid path (NUL byte) blocks rather than slipping through", () => {
  const c = compiled([{ id: "z", action: "block", paths: ["x"] }]);
  const v = evaluate(c, { path: "package-lock\0.json" }, FENCED_ROOT);
  assert.equal(v.decision, "block");
  assert.match(v.reason, /NUL/);
});

test("the trace records every zone consulted, in order", () => {
  const c = compiled([
    { id: "a", action: "block", paths: ["nope"] },
    { id: "b", action: "warn", paths: ["deep/"], ops: ["delete"] },
    { id: "c", action: "block", paths: ["deep/file.txt"] },
  ]);
  const v = evaluate(c, { path: "deep/file.txt", op: "edit" }, FENCED_ROOT);
  assert.deepEqual(
    v.trace.map((s) => `${s.zone}:${s.outcome}`),
    ["a:no-match", "b:op-skipped", "c:matched"],
  );
});
