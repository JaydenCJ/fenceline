// Shared test helpers: policy factories with fully-defaulted shapes
// (mirroring what src/policy.ts produces) and a spawnSync-based CLI
// driver. Deterministic throughout — fixed roots, temp dirs, no network,
// no wall-clock assumptions.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePolicy } from "../dist/engine.js";
import { parsePolicy } from "../dist/policy.js";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CLI = join(ROOT, "dist", "cli.js");
export const EXAMPLE_POLICY = join(ROOT, "examples", "webapp.fenceline.json");
export const FENCED_ROOT = "/repo";

/** A raw zone with the minimum required keys plus overrides. */
export function zone(overrides = {}) {
  return { id: "z", action: "block", paths: ["fenced.txt"], ...overrides };
}

/** A raw (uncompiled) policy document around the given zones. */
export function rawPolicy(zones, extra = {}) {
  return { version: 1, zones, ...extra };
}

/** Parse + compile a raw policy in one step (throws PolicyError on bad input). */
export function compiled(zones, extra = {}) {
  return compilePolicy(parsePolicy(rawPolicy(zones, extra)));
}

/** Create a fresh temp dir for a test. */
export function tempDir() {
  return mkdtempSync(join(tmpdir(), "fenceline-test-"));
}

/** Write a policy object (or raw string) to a fresh temp dir; returns its path. */
export function writePolicyFile(policy, name = "fenceline.json") {
  const file = join(tempDir(), name);
  writeFileSync(file, typeof policy === "string" ? policy : JSON.stringify(policy));
  return file;
}

/** Run the built CLI synchronously; returns { status, stdout, stderr }. */
export function runCli(args, { stdin = "", cwd = ROOT } = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    input: stdin,
    encoding: "utf8",
    cwd,
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}
