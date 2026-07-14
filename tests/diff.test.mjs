// Diff parsing feeds the standalone checker and the git pre-commit hook,
// so it must classify operations correctly (append-only zones depend on
// create vs edit) and never invent paths from patch body lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, unquotePath } from "../dist/diff.js";

const EDIT = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,3 @@
-old line
+new line
`;

test("a modified file is classified as an edit on the b/ path", () => {
  assert.deepEqual(parseDiff(EDIT), [{ path: "src/app.ts", op: "edit" }]);
});

test("a new file is classified as create", () => {
  const diff = `diff --git a/db/migrations/0002_add.sql b/db/migrations/0002_add.sql
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/db/migrations/0002_add.sql
@@ -0,0 +1 @@
+create table t (id int);
`;
  assert.deepEqual(parseDiff(diff), [{ path: "db/migrations/0002_add.sql", op: "create" }]);
});

test("a deleted file is classified as delete on the a/ path", () => {
  const diff = `diff --git a/scripts/old.sh b/scripts/old.sh
deleted file mode 100755
index 1111111..0000000
--- a/scripts/old.sh
+++ /dev/null
@@ -1 +0,0 @@
-echo gone
`;
  assert.deepEqual(parseDiff(diff), [{ path: "scripts/old.sh", op: "delete" }]);
});

test("a rename reports both endpoints as rename ops", () => {
  const diff = `diff --git a/docs/old-name.md b/docs/new-name.md
similarity index 100%
rename from docs/old-name.md
rename to docs/new-name.md
`;
  assert.deepEqual(parseDiff(diff), [
    { path: "docs/old-name.md", op: "rename" },
    { path: "docs/new-name.md", op: "rename" },
  ]);
});

test("multiple files in one diff come out in order", () => {
  const second = EDIT.replace(/src\/app\.ts/g, "package-lock.json");
  assert.deepEqual(parseDiff(EDIT + second).map((i) => i.path), ["src/app.ts", "package-lock.json"]);
});

test("plain (non-git) diffs parse: /dev/null headers and tab timestamps", () => {
  const created = `--- /dev/null
+++ b/brand-new.txt
@@ -0,0 +1 @@
+hello
`;
  assert.deepEqual(parseDiff(created), [{ path: "brand-new.txt", op: "create" }]);
  const edited = `--- config.ini\t2026-07-01 10:00:00
+++ config.ini\t2026-07-02 10:00:00
@@ -1 +1 @@
-a=1
+a=2
`;
  assert.deepEqual(parseDiff(edited), [{ path: "config.ini", op: "edit" }]);
});

test("C-quoted paths with spaces and escapes are unquoted", () => {
  assert.equal(unquotePath('"a/with space.txt"'), "a/with space.txt");
  assert.equal(unquotePath('"a/tab\\there"'), "a/tab\there");
  assert.equal(unquotePath('"a/\\303\\251"'), "a/Ã©"); // raw UTF-8 bytes, per git
  const diff = `diff --git "a/dir/my file.txt" "b/dir/my file.txt"
index 1111111..2222222 100644
--- "a/dir/my file.txt"
+++ "b/dir/my file.txt"
@@ -1 +1 @@
-x
+y
`;
  assert.deepEqual(parseDiff(diff), [{ path: "dir/my file.txt", op: "edit" }]);
});

test("removed body lines that start with dashes are not misread as headers", () => {
  const diff = `diff --git a/notes.md b/notes.md
index 1111111..2222222 100644
--- a/notes.md
+++ b/notes.md
@@ -1,2 +1,1 @@
--- a/looks-like-a-header.txt
-regular removed line
`;
  assert.deepEqual(parseDiff(diff), [{ path: "notes.md", op: "edit" }]);
});

test("duplicates collapse and pathless input yields no items", () => {
  assert.deepEqual(parseDiff(EDIT + EDIT), [{ path: "src/app.ts", op: "edit" }]);
  assert.deepEqual(parseDiff(""), []);
  assert.deepEqual(parseDiff("not a diff at all\njust text\n"), []);
});
