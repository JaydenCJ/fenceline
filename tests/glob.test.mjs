// The pattern dialect is the contract users write fences in, so these
// tests pin its gitignore-flavored behavior: bare names match at any
// depth, slashes anchor, directories protect their subtrees, and the
// classic metacharacters do exactly what .gitignore taught everyone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandBraces, matchPattern, validatePattern } from "../dist/glob.js";

test("a bare name matches at any depth and protects a directory's subtree", () => {
  assert.equal(matchPattern("package-lock.json", "package-lock.json"), true);
  assert.equal(matchPattern("package-lock.json", "packages/api/package-lock.json"), true);
  assert.equal(matchPattern("node_modules", "node_modules/left-pad/index.js"), true);
  assert.equal(matchPattern("node_modules", "apps/web/node_modules/x/y.js"), true);
  // ...but never as a substring of a segment.
  assert.equal(matchPattern("Cargo.lock", "Cargo.lockfile"), false);
  assert.equal(matchPattern("env", "environments/prod.tf"), false);
});

test("a pattern containing a slash is anchored to the root", () => {
  assert.equal(matchPattern("db/migrations", "db/migrations/0001_init.sql"), true);
  assert.equal(matchPattern("db/migrations", "services/db/migrations/0001_init.sql"), false);
});

test("a pattern naming a directory covers files beneath it, not name prefixes", () => {
  assert.equal(matchPattern("src/generated", "src/generated/client/api.ts"), true);
  assert.equal(matchPattern("src/generated", "src/generated-docs/readme.txt"), false);
});

test("a trailing slash is accepted and means the same directory subtree", () => {
  assert.equal(matchPattern("dist/", "dist/index.js"), true);
  assert.equal(matchPattern("dist/", "packages/core/dist/index.js"), true);
});

test("** spans segments; * and ? stay inside one", () => {
  assert.equal(matchPattern("**/migrations/*.py", "migrations/0001.py"), true);
  assert.equal(matchPattern("**/migrations/*.py", "app/sub/migrations/0002.py"), true);
  assert.equal(matchPattern("**/migrations/*.py", "app/migrations/deep/0003.py"), false);
  assert.equal(matchPattern("src/*.ts", "src/index.ts"), true);
  assert.equal(matchPattern("src/*.ts", "src/sub/index.ts"), false);
  assert.equal(matchPattern("v?.json", "v1.json"), true);
  assert.equal(matchPattern("v?.json", "v12.json"), false);
});

test("character classes and negated classes work", () => {
  assert.equal(matchPattern("data/[0-9]*.csv", "data/2024-export.csv"), true);
  assert.equal(matchPattern("data/[!0-9]*.csv", "data/2024-export.csv"), false);
  assert.equal(matchPattern("data/[!0-9]*.csv", "data/export.csv"), true);
});

test("brace alternatives expand (nested too) and match like separate patterns", () => {
  assert.deepEqual(expandBraces("*.{yml,yaml}"), ["*.yml", "*.yaml"]);
  assert.deepEqual(expandBraces("a{b,c{d,e}}f"), ["abf", "acdf", "acef"]);
  assert.equal(matchPattern("{yarn,pnpm}-lock.yaml", "pnpm-lock.yaml"), true);
  assert.equal(matchPattern("{yarn,pnpm}-lock.yaml", "npm-lock.yaml"), false);
});

test("a backslash escapes a metacharacter", () => {
  assert.equal(matchPattern("literal\\*.txt", "literal*.txt"), true);
  assert.equal(matchPattern("literal\\*.txt", "literalx.txt"), false);
});

test("dotfiles are matched like any other name — no special casing", () => {
  assert.equal(matchPattern(".env.*", ".env.production"), true);
  assert.equal(matchPattern("*", ".env"), true);
});

test("validatePattern flags garbage and accepts the full dialect", () => {
  assert.match(validatePattern(""), /empty/);
  assert.match(validatePattern("a\0b"), /NUL/);
  assert.match(validatePattern("a{b,c"), /unbalanced/);
  assert.match(validatePattern("a[bc"), /unterminated/);
  assert.match(validatePattern("trailing\\"), /backslash/);
  for (const ok of ["*.lock", "db/**/*.sql", "{a,b}/c", "[a-z]?.txt", "dist/"]) {
    assert.equal(validatePattern(ok), null, `expected "${ok}" to validate`);
  }
});
