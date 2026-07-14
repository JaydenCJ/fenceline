// Harness adapters live on the hot path of every tool call, so parsing
// must be defensive (unknown tools pass, garbage never crashes) and the
// replies must match each harness's wire format exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claudeHookReply,
  exitCodeFor,
  genericReply,
  parseClaudeEvent,
  parseGenericEvent,
  summarize,
} from "../dist/harness.js";
import { evaluateAll } from "../dist/engine.js";
import { compiled, FENCED_ROOT } from "./helpers.mjs";

const never = () => {
  throw new Error("exists() must not be called for this tool");
};

test("Edit, MultiEdit and NotebookEdit events map to edits on their path key", () => {
  for (const tool of ["Edit", "MultiEdit"]) {
    const event = parseClaudeEvent({ tool_name: tool, tool_input: { file_path: "a.txt" } }, never);
    assert.deepEqual(event.items, [{ path: "a.txt", op: "edit" }]);
  }
  const nb = parseClaudeEvent({ tool_name: "NotebookEdit", tool_input: { notebook_path: "nb.ipynb" } }, never);
  assert.deepEqual(nb.items, [{ path: "nb.ipynb", op: "edit" }]);
});

test("Write is a create when the file does not exist, an edit when it does", () => {
  const fresh = parseClaudeEvent({ tool_name: "Write", tool_input: { file_path: "new.txt" } }, () => false);
  assert.equal(fresh.items[0].op, "create");
  const overwrite = parseClaudeEvent({ tool_name: "Write", tool_input: { file_path: "old.txt" } }, () => true);
  assert.equal(overwrite.items[0].op, "edit");
});

test("non-file tools and malformed events return null (pass through)", () => {
  assert.equal(parseClaudeEvent({ tool_name: "Bash", tool_input: { command: "ls" } }, never), null);
  assert.equal(parseClaudeEvent({ tool_name: "Edit", tool_input: {} }, never), null);
  assert.equal(parseClaudeEvent("not an object", never), null);
  assert.equal(parseClaudeEvent(null, never), null);
});

test("the generic protocol validates path, op and unknown keys", () => {
  assert.deepEqual(parseGenericEvent({ path: "x", op: "delete" }).items, [{ path: "x", op: "delete" }]);
  assert.match(parseGenericEvent({}).error, /event\.path/);
  assert.match(parseGenericEvent({ path: "x", op: "chmod" }).error, /event\.op/);
  assert.match(parseGenericEvent({ path: "x", extra: 1 }).error, /event\.extra: unknown key/);
});

function verdictsFor(paths, zones) {
  return evaluateAll(compiled(zones), paths.map((path) => ({ path })), FENCED_ROOT);
}

test("summarize picks the worst decision: block > ask > warn > allow", () => {
  const zones = [
    { id: "b", action: "block", paths: ["b.txt"] },
    { id: "a", action: "ask", paths: ["a.txt"] },
    { id: "w", action: "warn", paths: ["w.txt"] },
  ];
  assert.equal(summarize(verdictsFor(["free.txt", "w.txt"], zones)).decision, "warn");
  assert.equal(summarize(verdictsFor(["w.txt", "a.txt"], zones)).decision, "ask");
  assert.equal(summarize(verdictsFor(["a.txt", "b.txt", "w.txt"], zones)).decision, "block");
  assert.equal(summarize([]).decision, "allow");
});

test("claudeHookReply maps block to a deny with the reason attached", () => {
  const verdicts = verdictsFor(["lock.json"], [
    { id: "locks", action: "block", paths: ["lock.json"], reason: "generated", hint: "regenerate it" },
  ]);
  const reply = JSON.parse(claudeHookReply(verdicts));
  assert.equal(reply.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(reply.hookSpecificOutput.permissionDecision, "deny");
  assert.match(reply.hookSpecificOutput.permissionDecisionReason, /zone locks/);
  assert.match(reply.hookSpecificOutput.permissionDecisionReason, /regenerate it/);
});

test("claudeHookReply maps ask to ask, warn to allow-with-reason, allow to silence", () => {
  const zones = [
    { id: "a", action: "ask", paths: ["a.txt"] },
    { id: "w", action: "warn", paths: ["w.txt"] },
  ];
  const ask = JSON.parse(claudeHookReply(verdictsFor(["a.txt"], zones)));
  assert.equal(ask.hookSpecificOutput.permissionDecision, "ask");
  const warn = JSON.parse(claudeHookReply(verdictsFor(["w.txt"], zones)));
  assert.equal(warn.hookSpecificOutput.permissionDecision, "allow");
  assert.equal(claudeHookReply(verdictsFor(["free.txt"], zones)), null);
});

test("genericReply always answers, and its exit codes follow the CLI contract", () => {
  const zones = [{ id: "z", action: "block", paths: ["fenced.txt"] }];
  const blocked = JSON.parse(genericReply(verdictsFor(["fenced.txt"], zones)));
  assert.deepEqual({ decision: blocked.decision, zone: blocked.zone }, { decision: "block", zone: "z" });
  const allowed = JSON.parse(genericReply(verdictsFor(["free.txt"], zones)));
  assert.deepEqual({ decision: allowed.decision, zone: allowed.zone }, { decision: "allow", zone: null });
  assert.equal(exitCodeFor("allow"), 0);
  assert.equal(exitCodeFor("warn"), 0);
  assert.equal(exitCodeFor("block"), 1);
  assert.equal(exitCodeFor("ask"), 3);
});
