// End-to-end runs of the built CLI: the exit-code contract, every
// subcommand, both hook protocols and the bundled examples. These spawn
// real processes against dist/, so what passes here is what users get.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLE_POLICY, rawPolicy, runCli, tempDir, writePolicyFile, zone } from "./helpers.mjs";

const POLICY = ["--policy", EXAMPLE_POLICY];

test("--version prints the package version and --help documents every subcommand", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const version = runCli(["--version"]);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), pkg.version);
  const help = runCli(["--help"]);
  assert.equal(help.status, 0);
  for (const word of ["check", "validate", "test", "list", "init", "hooks", "hook"]) {
    assert.match(help.stdout, new RegExp(`\\b${word}\\b`));
  }
});

test("unknown commands and mistyped flags exit 2 instead of being ignored", () => {
  const command = runCli(["frobnicate"]);
  assert.equal(command.status, 2);
  assert.match(command.stderr, /unknown command/);
  const flag = runCli(["check", "x.txt", "--polcy", "f.json"]);
  assert.equal(flag.status, 2);
  assert.match(flag.stderr, /unknown option --polcy/);
});

test("validate: good policies report counts (0), invalid exit 1 with JSON paths, missing exit 2", () => {
  const ok = runCli(["validate", ...POLICY]);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^OK: 6 zones, 12 embedded tests/);
  const invalid = runCli(["validate", "--policy", writePolicyFile(rawPolicy([zone({ action: "deny" })]))]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /zones\[0\]\.action/);
  assert.equal(runCli(["validate", "--policy", join(tempDir(), "nope.json")]).status, 2);
});

test("check: allow exits 0, block 1, ask 3 — and block outranks ask", () => {
  assert.equal(runCli(["check", "src/routes/users.ts", ...POLICY]).status, 0);
  const blocked = runCli(["check", "package-lock.json", ...POLICY]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /^BLOCK {2}package-lock\.json {2}\[zone lockfiles\]/);
  assert.equal(runCli(["check", "CHANGELOG.md", ...POLICY]).status, 3);
  const both = runCli(["check", "CHANGELOG.md", "package-lock.json", ...POLICY]);
  assert.equal(both.status, 1);
  assert.match(both.stderr, /checked 2 paths: 0 allow, 1 block, 0 warn, 1 ask/);
});

test("check --op create lets a new migration through the append-only zone", () => {
  const edit = runCli(["check", "db/migrations/0042_add_index.sql", ...POLICY]);
  assert.equal(edit.status, 1);
  const create = runCli(["check", "db/migrations/0043_new.sql", "--op", "create", ...POLICY]);
  assert.equal(create.status, 0);
});

test("check --stdin reads path lists; --diff classifies ops from the bundled diffs", () => {
  const stdin = runCli(["check", "--stdin", ...POLICY], { stdin: "src/a.ts\nyarn.lock\n\n" });
  assert.equal(stdin.status, 1);
  assert.match(stdin.stderr, /checked 2 paths/);

  const drift = readFileSync(new URL("../examples/diffs/lockfile-drift.diff", import.meta.url), "utf8");
  const diff = runCli(["check", "--diff", ...POLICY], { stdin: drift });
  assert.equal(diff.status, 1);
  assert.match(diff.stdout, /BLOCK {2}package-lock\.json/);
  assert.match(diff.stdout, /ALLOW {2}src\/routes\/users\.ts/);

  const migration = readFileSync(new URL("../examples/diffs/new-migration.diff", import.meta.url), "utf8");
  assert.equal(runCli(["check", "--diff", ...POLICY], { stdin: migration }).status, 0);
});

test("check --explain names the deciding pattern and the zones consulted", () => {
  const res = runCli(["check", "--explain", "src/generated/client/api.ts", ...POLICY]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /generated-client -> block: matched "src\/generated\/"/);
  assert.match(res.stdout, /1\. lockfiles -> block: no pattern matched/);
});

test("check --format json emits machine-readable verdicts, deterministically", () => {
  const args = ["check", "--format", "json", "package-lock.json", ...POLICY];
  const first = runCli(args);
  const verdicts = JSON.parse(first.stdout);
  assert.equal(verdicts[0].decision, "block");
  assert.equal(verdicts[0].zone, "lockfiles");
  assert.equal(first.stdout, runCli(args).stdout);
});

test("the webapp policy blocks paths outside its root (outside: block)", () => {
  const res = runCli(["check", "../elsewhere/notes.txt", ...POLICY]);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /outside the fenced root/);
});

test("test: passes pinned decisions (0) and fails broken pins with detail (1)", () => {
  const good = runCli(["test", ...POLICY]);
  assert.equal(good.status, 0);
  assert.match(good.stdout, /12 passed, 0 failed/);

  const file = writePolicyFile(
    rawPolicy([zone({ id: "z1", paths: ["a.txt"] })], {
      tests: [{ name: "wrong on purpose", path: "a.txt", expect: "allow" }],
    }),
  );
  const bad = runCli(["test", "--policy", file]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL - wrong on purpose: expected allow, got block/);
});

test("list prints every zone with action and pattern count", () => {
  const res = runCli(["list", ...POLICY]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /BLOCK {2}lockfiles {2}\(3 patterns, all ops\)/);
  assert.match(res.stdout, /BLOCK {2}migrations {2}\(1 pattern, edit\/delete\/rename\)/);
  assert.match(res.stdout, /ASK {4}release-metadata/);
});

test("init writes a fence that passes its own tests, and refuses overwrites without --force", () => {
  const dir = tempDir();
  const res = runCli(["init", "--preset", "node"], { cwd: dir });
  assert.equal(res.status, 0);
  const written = join(dir, "fenceline.json");
  assert.ok(existsSync(written));
  assert.equal(runCli(["test", "--policy", written]).status, 0);

  const refused = runCli(["init"], { cwd: dir });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--force/);
  assert.equal(runCli(["init", "--force"], { cwd: dir }).status, 0);
});

test("a .fenceline.json fallback is picked up when fenceline.json is absent", () => {
  const dir = tempDir();
  writeFileSync(join(dir, ".fenceline.json"), JSON.stringify(rawPolicy([zone({ paths: ["x.txt"] })])));
  assert.equal(runCli(["check", "x.txt"], { cwd: dir }).status, 1);
});

test("hooks claude-code prints a snippet, --write merges idempotently, broken fences are refused", () => {
  const printed = runCli(["hooks", "claude-code", ...POLICY]);
  assert.equal(printed.status, 0);
  const snippet = JSON.parse(printed.stdout);
  assert.match(snippet.hooks.PreToolUse[0].hooks[0].command, /^fenceline hook claude-code --policy /);

  const dir = tempDir();
  writeFileSync(join(dir, "fenceline.json"), JSON.stringify(rawPolicy([zone()])));
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ model: "kept" }));
  assert.equal(runCli(["hooks", "claude-code", "--write"], { cwd: dir }).status, 0);
  runCli(["hooks", "claude-code", "--write"], { cwd: dir }); // must not stack a duplicate
  const doc = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
  assert.equal(doc.model, "kept");
  assert.equal(doc.hooks.PreToolUse.length, 1);

  assert.equal(runCli(["hooks", "claude-code", "--policy", writePolicyFile(rawPolicy([]))]).status, 1);
});

test("hooks git --write installs a pre-commit but refuses to replace a foreign one", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "fenceline.json"), JSON.stringify(rawPolicy([zone()])));
  mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
  writeFileSync(join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\nmy-own-hook\n");
  const refused = runCli(["hooks", "git", "--write"], { cwd: dir });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /refusing to replace/);

  assert.equal(runCli(["hooks", "git", "--write", "--force"], { cwd: dir }).status, 0);
  const script = readFileSync(join(dir, ".git", "hooks", "pre-commit"), "utf8");
  assert.match(script, /fenceline check --diff/);
  // Now that the hook is ours, --write without --force refreshes it quietly.
  assert.equal(runCli(["hooks", "git", "--write"], { cwd: dir }).status, 0);
});

test("hook claude-code: a fenced Edit answers deny; unfenced and non-file tools stay silent", () => {
  const event = readFileSync(new URL("../examples/events/claude-edit-lockfile.json", import.meta.url), "utf8");
  const denied = runCli(["hook", "claude-code", ...POLICY], { stdin: event });
  assert.equal(denied.status, 0);
  const reply = JSON.parse(denied.stdout);
  assert.equal(reply.hookSpecificOutput.permissionDecision, "deny");
  assert.match(reply.hookSpecificOutput.permissionDecisionReason, /zone lockfiles/);

  const source = readFileSync(new URL("../examples/events/claude-edit-source.json", import.meta.url), "utf8");
  const silent = runCli(["hook", "claude-code", ...POLICY], { stdin: source });
  assert.equal(silent.status, 0);
  assert.equal(silent.stdout, "");
  const bash = runCli(["hook", "claude-code", ...POLICY], {
    stdin: JSON.stringify({ tool_name: "Bash", tool_input: { command: "make bootstrap" } }),
  });
  assert.equal(bash.status, 0);
  assert.equal(bash.stdout, "");
});

test("hook generic: answers JSON and follows the exit-code triad", () => {
  const ask = runCli(["hook", "generic", ...POLICY], { stdin: '{"path":"CHANGELOG.md"}' });
  assert.equal(ask.status, 3);
  assert.equal(JSON.parse(ask.stdout).decision, "ask");
  const block = runCli(["hook", "generic", ...POLICY], { stdin: '{"path":"yarn.lock","op":"delete"}' });
  assert.equal(block.status, 1);
  const allow = runCli(["hook", "generic", ...POLICY], { stdin: '{"path":"src/free.ts"}' });
  assert.equal(allow.status, 0);
  assert.equal(JSON.parse(allow.stdout).decision, "allow");
});

test("hook: malformed input allows with a warning by default, blocks under --fail-closed", () => {
  const open = runCli(["hook", "generic", ...POLICY], { stdin: "not json" });
  assert.equal(open.status, 0);
  assert.match(open.stderr, /not valid JSON/);
  const closed = runCli(["hook", "generic", "--fail-closed", ...POLICY], { stdin: "not json" });
  assert.equal(closed.status, 1);
  assert.equal(JSON.parse(closed.stdout).decision, "block");
  const claude = runCli(["hook", "claude-code", "--fail-closed", ...POLICY], { stdin: "not json" });
  assert.equal(claude.status, 0);
  assert.equal(JSON.parse(claude.stdout).hookSpecificOutput.permissionDecision, "deny");
});
