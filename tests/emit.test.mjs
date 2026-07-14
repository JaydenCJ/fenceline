// Config generation writes into other tools' config files, so the shapes
// must be exact and the merge must be surgical: never a duplicate hook,
// never a clobbered unrelated setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claudeHookEntry,
  claudeSettingsSnippet,
  genericProtocolHelp,
  gitPreCommitScript,
  mergeClaudeSettings,
} from "../dist/emit.js";

test("the Claude Code hook entry covers every file-touching tool, quoted safely", () => {
  const entry = claudeHookEntry("fenceline.json");
  assert.equal(entry.matcher, "Edit|Write|MultiEdit|NotebookEdit");
  assert.equal(entry.hooks[0].command, "fenceline hook claude-code --policy fenceline.json");
  const doc = JSON.parse(claudeSettingsSnippet("fenceline.json"));
  assert.equal(doc.hooks.PreToolUse.length, 1);
  const quoted = claudeHookEntry("my fences/team policy.json");
  assert.match(quoted.hooks[0].command, /'my fences\/team policy\.json'/);
});

test("merging into empty settings installs exactly one hook", () => {
  const doc = mergeClaudeSettings(undefined, "fenceline.json");
  assert.equal(doc.hooks.PreToolUse.length, 1);
});

test("merging preserves unrelated settings and foreign hooks", () => {
  const existing = {
    model: "whatever-the-user-chose",
    hooks: {
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-logger" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-linter" }] }],
    },
  };
  const doc = mergeClaudeSettings(existing, "fenceline.json");
  assert.equal(doc.model, "whatever-the-user-chose");
  assert.equal(doc.hooks.PostToolUse[0].hooks[0].command, "my-logger");
  assert.equal(doc.hooks.PreToolUse.length, 2);
  assert.equal(doc.hooks.PreToolUse[0].hooks[0].command, "my-linter");
});

test("merging twice is idempotent and updates the policy path in place", () => {
  const once = mergeClaudeSettings(undefined, "fenceline.json");
  const twice = mergeClaudeSettings(once, "team/fences.json");
  assert.equal(twice.hooks.PreToolUse.length, 1);
  assert.match(twice.hooks.PreToolUse[0].hooks[0].command, /team\/fences\.json/);
});

test("the git pre-commit script pipes the staged diff through check --diff", () => {
  const script = gitPreCommitScript("fenceline.json");
  assert.match(script, /^#!\/bin\/sh/);
  assert.match(script, /git diff --cached --no-color --unified=0/);
  assert.match(script, /fenceline check --diff --policy fenceline\.json/);
  assert.match(script, /FENCELINE_SKIP/); // documented escape hatch
});

test("the generic protocol help documents the exit-code triad", () => {
  const help = genericProtocolHelp("fenceline.json");
  assert.match(help, /0 allow\/warn/);
  assert.match(help, /1 block/);
  assert.match(help, /3 ask/);
});
