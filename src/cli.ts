#!/usr/bin/env node
/**
 * The fenceline CLI. Exit codes are a stable contract:
 *
 *   0  everything allowed (warnings included)
 *   1  at least one BLOCK, a failed validation, or failed embedded tests
 *   2  usage or I/O errors (unknown command, unreadable policy)
 *   3  at least one ASK and no BLOCK — a human should look
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs, UsageError, type ParsedArgs } from "./cliargs.js";
import { compilePolicy, evaluateAll, type CompiledPolicy } from "./engine.js";
import {
  claudeSettingsSnippet,
  genericProtocolHelp,
  gitPreCommitScript,
  mergeClaudeSettings,
} from "./emit.js";
import {
  claudeHookReply,
  exitCodeFor,
  genericReply,
  parseClaudeEvent,
  parseGenericEvent,
  summarize,
} from "./harness.js";
import { parseDiff } from "./diff.js";
import { loadPolicy, PolicyError } from "./policy.js";
import { PRESET_NAMES, presetPolicy } from "./presets.js";
import { runPolicyTests } from "./selftest.js";
import type { CheckItem, Decision, Op, Verdict } from "./types.js";
import { ALL_OPS } from "./types.js";
import { VERSION } from "./version.js";

const USAGE = `fenceline ${VERSION} — declarative protected-path rules, enforced as agent hooks

Usage: fenceline <command> [options]

Commands:
  check [paths...]      decide the given paths (or --stdin / --diff input)
  validate              validate the policy file, deciding nothing
  test                  run the policy's embedded tests
  list                  list the policy's zones
  init                  write a starter fence (--preset ${PRESET_NAMES.join("|")})
  hooks <target>        print or --write hook config (claude-code | git | generic)
  hook <protocol>       run as a live hook on one stdin event (claude-code | generic)

Options:
  --policy <file>       fence file (default ./fenceline.json, then ./.fenceline.json)
  --root <dir>          fenced root (default: the policy file's directory)
  --op <op>             operation for check paths: ${ALL_OPS.join(" | ")} (default edit)
  --stdin               check: read newline-separated paths from stdin
  --diff                check: read a unified diff from stdin
  --explain             check: print the full zone-by-zone trace
  --format <fmt>        check: text | json (default text)
  --preset <name>       init: ${PRESET_NAMES.join(" | ")} (default base)
  --out <file>          init: output file (default ./fenceline.json)
  --force               init: overwrite an existing fence / replace a foreign git hook
  --write               hooks: install the config instead of printing it
  --fail-closed         hook: treat unreadable events/policies as block, not allow
  --version, --help

Exit codes: 0 allowed · 1 blocked/failed · 2 usage/I-O error · 3 needs a human (ask)`;

interface Ctx {
  args: ParsedArgs;
  out: (line: string) => void;
  err: (line: string) => void;
}

function readStdin(): Promise<string> {
  return new Promise((resolveInput) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolveInput(data));
  });
}

/** Resolve the policy path: explicit flag, else the two conventional names. */
function policyPath(args: ParsedArgs): string {
  const explicit = args.options.policy;
  if (explicit !== undefined) return explicit;
  if (!existsSync("fenceline.json") && existsSync(".fenceline.json")) return ".fenceline.json";
  return "fenceline.json";
}

function fencedRoot(args: ParsedArgs, policyFile: string): string {
  const root = args.options.root;
  return resolve(root !== undefined ? root : dirname(resolve(policyFile)));
}

/** Load and compile, translating failures into the exit-code contract. */
function loadCompiled(ctx: Ctx, policyFile: string): { compiled: CompiledPolicy } | { code: number } {
  let compiled: CompiledPolicy;
  try {
    compiled = compilePolicy(loadPolicy(policyFile));
  } catch (err) {
    if (err instanceof PolicyError) {
      for (const problem of err.problems) ctx.err(`${policyFile}: ${problem}`);
      return { code: 1 };
    }
    ctx.err(`cannot read policy: ${(err as Error).message}`);
    return { code: 2 };
  }
  return { compiled };
}

const LABELS: Record<Decision, string> = { allow: "ALLOW", block: "BLOCK", warn: "WARN ", ask: "ASK  " };

/** Count-aware pluralization for messages: "1 zone", "2 zones". */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function renderVerdict(verdict: Verdict, explain: boolean): string[] {
  const label = LABELS[verdict.decision];
  let line = `${label}  ${verdict.path}`;
  if (verdict.zone !== null) {
    line += `  [zone ${verdict.zone}] ${verdict.reason}`;
    if (verdict.hint !== null) line += ` — ${verdict.hint}`;
  } else if (verdict.decision !== "allow" || verdict.outside) {
    line += `  ${verdict.reason}`;
  }
  const lines = [line];
  if (explain) {
    verdict.trace.forEach((step, i) => {
      lines.push(`   ${i + 1}. ${step.zone} -> ${step.action}: ${step.detail}`);
    });
    if (verdict.zone === null && !verdict.outside && verdict.decision === "allow") {
      lines.push(`      (no zone matched; the path is outside every fence)`);
    }
  }
  return lines;
}

async function cmdCheck(ctx: Ctx): Promise<number> {
  const { args } = ctx;
  const policyFile = policyPath(args);
  const loaded = loadCompiled(ctx, policyFile);
  if ("code" in loaded) return loaded.code;
  const root = fencedRoot(args, policyFile);

  const format = args.options.format ?? "text";
  if (format !== "text" && format !== "json") throw new UsageError(`--format must be text or json`);
  const op = args.options.op ?? "edit";
  if (!(ALL_OPS as readonly string[]).includes(op)) {
    throw new UsageError(`--op must be one of ${ALL_OPS.join(", ")}`);
  }
  if (args.flags.stdin && args.flags.diff) throw new UsageError(`--stdin and --diff are mutually exclusive`);

  let items: CheckItem[];
  let showSummary = true;
  if (args.flags.diff) {
    if (args.positionals.length > 0) throw new UsageError(`--diff takes no path arguments`);
    items = parseDiff(await readStdin());
  } else if (args.flags.stdin) {
    if (args.positionals.length > 0) throw new UsageError(`--stdin takes no path arguments`);
    items = (await readStdin())
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((path) => ({ path, op: op as Op }));
  } else {
    if (args.positionals.length === 0) {
      throw new UsageError(`check needs paths, --stdin, or --diff`);
    }
    items = args.positionals.map((path) => ({ path, op: op as Op }));
    showSummary = items.length > 1;
  }

  const verdicts = evaluateAll(loaded.compiled, items, root);
  if (format === "json") {
    ctx.out(JSON.stringify(verdicts, null, 2));
  } else {
    for (const verdict of verdicts) {
      for (const line of renderVerdict(verdict, args.flags.explain === true)) ctx.out(line);
    }
  }

  const counts: Record<Decision, number> = { allow: 0, block: 0, warn: 0, ask: 0 };
  for (const verdict of verdicts) counts[verdict.decision]++;
  if (showSummary) {
    ctx.err(
      `checked ${plural(verdicts.length, "path")}: ${counts.allow} allow, ${counts.block} block, ` +
        `${counts.warn} warn, ${counts.ask} ask`,
    );
  }
  if (counts.block > 0) return 1;
  if (counts.ask > 0) return 3;
  return 0;
}

function cmdValidate(ctx: Ctx): number {
  const policyFile = policyPath(ctx.args);
  const loaded = loadCompiled(ctx, policyFile);
  if ("code" in loaded) return loaded.code;
  const policy = loaded.compiled.policy;
  ctx.out(`OK: ${plural(policy.zones.length, "zone")}, ${plural(policy.tests.length, "embedded test")}`);
  return 0;
}

function cmdTest(ctx: Ctx): number {
  const policyFile = policyPath(ctx.args);
  const loaded = loadCompiled(ctx, policyFile);
  if ("code" in loaded) return loaded.code;
  const root = fencedRoot(ctx.args, policyFile);
  const report = runPolicyTests(loaded.compiled, root);
  for (const result of report.results) {
    if (result.ok) ctx.out(`ok   - ${result.test.name}`);
    else ctx.out(`FAIL - ${result.test.name}: ${result.detail}`);
  }
  ctx.out(`${report.passed} passed, ${report.failed} failed`);
  return report.failed > 0 ? 1 : 0;
}

function cmdList(ctx: Ctx): number {
  const policyFile = policyPath(ctx.args);
  const loaded = loadCompiled(ctx, policyFile);
  if ("code" in loaded) return loaded.code;
  for (const zone of loaded.compiled.policy.zones) {
    const ops = zone.ops.length === ALL_OPS.length ? "all ops" : zone.ops.join("/");
    ctx.out(`${zone.action.toUpperCase().padEnd(5)}  ${zone.id}  (${plural(zone.paths.length, "pattern")}, ${ops})`);
    ctx.out(`       ${zone.reason ?? `protected by zone "${zone.id}"`}`);
  }
  return 0;
}

function cmdInit(ctx: Ctx): number {
  const preset = ctx.args.options.preset ?? "base";
  const raw = presetPolicy(preset);
  if (raw === null) {
    throw new UsageError(`unknown preset "${preset}" — choose from ${PRESET_NAMES.join(", ")}`);
  }
  const outFile = ctx.args.options.out ?? "fenceline.json";
  if (existsSync(outFile) && ctx.args.flags.force !== true) {
    ctx.err(`refusing to overwrite ${outFile} (use --force)`);
    return 1;
  }
  writeFileSync(outFile, JSON.stringify(raw, null, 2) + "\n");
  const zones = (raw as { zones: unknown[] }).zones.length;
  const tests = (raw as { tests: unknown[] }).tests.length;
  ctx.out(`wrote ${outFile} (preset ${preset}: ${plural(zones, "zone")}, ${plural(tests, "embedded test")})`);
  ctx.out(`next: fenceline test && fenceline hooks claude-code`);
  return 0;
}

function cmdHooks(ctx: Ctx): number {
  const target = ctx.args.positionals[0];
  if (target === undefined) throw new UsageError(`hooks needs a target: claude-code | git | generic`);
  const policyFile = policyPath(ctx.args);
  // Emitting config for a broken fence would just defer the failure to
  // every future tool call — validate up front.
  const loaded = loadCompiled(ctx, policyFile);
  if ("code" in loaded) return loaded.code;
  const write = ctx.args.flags.write === true;

  if (target === "claude-code") {
    if (!write) {
      ctx.out(claudeSettingsSnippet(policyFile).trimEnd());
      ctx.err(`merge this into .claude/settings.json, or rerun with --write`);
      return 0;
    }
    const settingsFile = join(".claude", "settings.json");
    let existing: unknown = undefined;
    if (existsSync(settingsFile)) {
      try {
        existing = JSON.parse(readFileSync(settingsFile, "utf8"));
      } catch (err) {
        ctx.err(`cannot merge into ${settingsFile}: not valid JSON — ${(err as Error).message}`);
        return 2;
      }
    }
    mkdirSync(".claude", { recursive: true });
    writeFileSync(settingsFile, JSON.stringify(mergeClaudeSettings(existing, policyFile), null, 2) + "\n");
    ctx.out(`installed PreToolUse hook in ${settingsFile}`);
    return 0;
  }

  if (target === "git") {
    const script = gitPreCommitScript(policyFile);
    if (!write) {
      ctx.out(script.trimEnd());
      ctx.err(`save as .git/hooks/pre-commit (executable), or rerun with --write`);
      return 0;
    }
    if (!existsSync(".git")) {
      ctx.err(`no .git directory here — run from the repository root`);
      return 2;
    }
    const hookFile = join(".git", "hooks", "pre-commit");
    if (existsSync(hookFile) && ctx.args.flags.force !== true) {
      const current = readFileSync(hookFile, "utf8");
      if (!current.includes("fenceline pre-commit hook")) {
        ctx.err(`refusing to replace an existing ${hookFile} (use --force)`);
        return 1;
      }
    }
    mkdirSync(join(".git", "hooks"), { recursive: true });
    writeFileSync(hookFile, script, { mode: 0o755 });
    ctx.out(`installed ${hookFile}`);
    return 0;
  }

  if (target === "generic") {
    if (write) throw new UsageError(`the generic protocol has nothing to install — wire it manually`);
    ctx.out(genericProtocolHelp(policyFile).trimEnd());
    return 0;
  }

  throw new UsageError(`unknown hooks target "${target}" — choose claude-code, git, or generic`);
}

async function cmdHook(ctx: Ctx): Promise<number> {
  const protocol = ctx.args.positionals[0];
  if (protocol === undefined || (protocol !== "claude-code" && protocol !== "generic")) {
    throw new UsageError(`hook needs a protocol: claude-code | generic`);
  }
  const failClosed = ctx.args.flags["fail-closed"] === true;
  const policyFile = policyPath(ctx.args);

  let compiled: CompiledPolicy;
  try {
    compiled = compilePolicy(loadPolicy(policyFile));
  } catch (err) {
    // A live hook must not brick every tool call because the fence file is
    // momentarily broken — unless the operator opted into failing closed.
    const message = err instanceof PolicyError ? err.problems.join("; ") : (err as Error).message;
    return hookFailure(ctx, protocol, `policy unusable: ${message}`, failClosed);
  }
  const root = fencedRoot(ctx.args, policyFile);

  const input = await readStdin();
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return hookFailure(ctx, protocol, `event is not valid JSON`, failClosed);
  }

  if (protocol === "claude-code") {
    const event = parseClaudeEvent(raw, (path) => existsSync(path));
    if (event === null) return 0; // not a file-touching tool: stay silent
    const verdicts = evaluateAll(compiled, event.items, root);
    const reply = claudeHookReply(verdicts);
    if (reply !== null) ctx.out(reply);
    return 0;
  }

  const event = parseGenericEvent(raw);
  if ("error" in event) return hookFailure(ctx, protocol, event.error, failClosed);
  const verdicts = evaluateAll(compiled, event.items, root);
  ctx.out(genericReply(verdicts));
  return exitCodeFor(summarize(verdicts).decision);
}

function hookFailure(ctx: Ctx, protocol: string, message: string, failClosed: boolean): number {
  ctx.err(`fenceline: ${message}${failClosed ? "" : " (allowing; use --fail-closed to block instead)"}`);
  if (!failClosed) return 0;
  if (protocol === "claude-code") {
    ctx.out(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `fenceline (fail-closed): ${message}`,
        },
      }),
    );
    return 0;
  }
  ctx.out(JSON.stringify({ decision: "block", zone: null, reason: `fenceline (fail-closed): ${message}` }));
  return 1;
}

const SPEC = {
  options: ["policy", "root", "op", "format", "preset", "out"],
  flags: ["stdin", "diff", "explain", "force", "write", "fail-closed", "version", "help"],
};

export async function main(argv: string[]): Promise<number> {
  const ctx: Ctx = {
    args: { positionals: [], options: {}, flags: {} },
    out: (line) => process.stdout.write(line + "\n"),
    err: (line) => process.stderr.write(line + "\n"),
  };
  let command: string | undefined;
  try {
    const parsed = parseArgs(argv, SPEC);
    if (parsed.flags.version === true) {
      ctx.out(VERSION);
      return 0;
    }
    if (parsed.flags.help === true || parsed.positionals.length === 0) {
      ctx.out(USAGE);
      return 0;
    }
    command = parsed.positionals[0];
    ctx.args = { ...parsed, positionals: parsed.positionals.slice(1) };

    switch (command) {
      case "check":
        return await cmdCheck(ctx);
      case "validate":
        return cmdValidate(ctx);
      case "test":
        return cmdTest(ctx);
      case "list":
        return cmdList(ctx);
      case "init":
        return cmdInit(ctx);
      case "hooks":
        return cmdHooks(ctx);
      case "hook":
        return await cmdHook(ctx);
      default:
        ctx.err(`unknown command "${command}" — see fenceline --help`);
        return 2;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      ctx.err(`usage error: ${err.message}`);
      return 2;
    }
    ctx.err(`fenceline: ${(err as Error).message}`);
    return 2;
  }
}

// A downstream consumer like `head` or `grep -q` may close the pipe before
// we finish writing; that is normal Unix life, not a crash.
const ignoreEpipe = (err: { code?: string }): void => {
  if (err.code !== "EPIPE") throw err;
};
process.stdout.on("error", ignoreEpipe);
process.stderr.on("error", ignoreEpipe);

// Set exitCode instead of calling process.exit() so pending stdout writes
// always flush before the process ends.
process.exitCode = await main(process.argv.slice(2));
