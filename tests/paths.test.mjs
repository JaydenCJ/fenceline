// Normalization is what keeps `db/../db/x.sql` from dodging a fence that
// `db/x.sql` would hit — every dodge tried here must land on the same
// canonical relative path, and escapes must be flagged, never resolved
// through the filesystem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePath } from "../dist/paths.js";

const ROOT = "/repo";

test("relative paths canonicalize: ./, //, inner dots and .. collapse", () => {
  const n = normalizePath("src/index.ts", ROOT);
  assert.deepEqual({ rel: n.rel, outside: n.outside }, { rel: "src/index.ts", outside: false });
  assert.deepEqual(n.segments, ["src", "index.ts"]);
  assert.equal(normalizePath("./src//./index.ts", ROOT).rel, "src/index.ts");
  assert.equal(normalizePath("db/../db/migrations/0001.sql", ROOT).rel, "db/migrations/0001.sql");
});

test("leading .. escapes the root and is flagged outside", () => {
  const n = normalizePath("../sibling/secrets.txt", ROOT);
  assert.equal(n.outside, true);
  assert.equal(n.rel, "../sibling/secrets.txt");
});

test(".. that climbs out and seemingly back in is still outside", () => {
  // "a/../../repo/x" from /repo lexically lands back on /repo/x, but any
  // route through the parent directory is unsound once symlinks exist —
  // the engine deliberately refuses to trust it.
  const n = normalizePath("a/../../repo/x", ROOT);
  assert.equal(n.outside, true);
});

test("an absolute path under the root becomes root-relative", () => {
  const n = normalizePath("/repo/src/app.ts", ROOT);
  assert.equal(n.rel, "src/app.ts");
  assert.equal(n.outside, false);
});

test("an absolute path outside the root is flagged, not relativized", () => {
  const n = normalizePath("/etc/passwd", ROOT);
  assert.equal(n.outside, true);
  assert.equal(n.rel, "/etc/passwd");
  // /repo-backup must not be mistaken for /repo + "-backup".
  assert.equal(normalizePath("/repo-backup/file.txt", ROOT).outside, true);
});

test("absolute paths normalize .. before the containment check", () => {
  const n = normalizePath("/repo/docs/../../etc/shadow", ROOT);
  assert.equal(n.outside, true);
  assert.equal(n.rel, "/etc/shadow");
});

test("backslashes are separators; another drive's absolute path is outside", () => {
  assert.equal(normalizePath("src\\generated\\api.ts", ROOT).rel, "src/generated/api.ts");
  assert.equal(normalizePath("C:\\repo\\file.txt", ROOT).outside, true);
});

test("empty and NUL-carrying paths are invalid, not silently allowed", () => {
  assert.match(normalizePath("", ROOT).invalid, /empty/);
  assert.match(normalizePath("a\0b", ROOT).invalid, /NUL/);
});
