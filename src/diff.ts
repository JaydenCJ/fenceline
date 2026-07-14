/**
 * Unified-diff path extraction: feed `git diff` (or any unified diff) in,
 * get the touched paths out — with the operation classified, so a zone that
 * blocks edits but allows new files (append-only migrations) can tell the
 * difference between the two.
 *
 * Handles git's `a/` / `b/` prefixes, `/dev/null` markers for creations and
 * deletions, `rename from`/`rename to` headers, C-quoted paths with spaces
 * or escapes, and plain (non-git) `---`/`+++` diffs with tab-separated
 * timestamps.
 */

import type { CheckItem, Op } from "./types.js";

interface FileRecord {
  oldPath: string | null;
  newPath: string | null;
  op: Op | null;
  renamedFrom: string | null;
  renamedTo: string | null;
}

function freshRecord(): FileRecord {
  return { oldPath: null, newPath: null, op: null, renamedFrom: null, renamedTo: null };
}

/** Undo git's C-style quoting ("a/with\ttab", octal escapes). */
export function unquotePath(raw: string): string {
  if (!(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) return raw;
  const body = raw.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[i + 1] ?? "";
    if (/[0-7]/.test(next)) {
      const octal = body.slice(i + 1).match(/^[0-7]{1,3}/);
      if (octal !== null) {
        out += String.fromCharCode(parseInt(octal[0], 8));
        i += octal[0].length;
        continue;
      }
    }
    const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };
    out += map[next] ?? next;
    i++;
  }
  return out;
}

/** Strip the `a/` or `b/` prefix a git diff adds, and any trailing timestamp. */
function cleanHeaderPath(raw: string, prefix: "a/" | "b/"): string | null {
  // "--- a/path\t2026-07-13 ..." — plain diffs append a tab + timestamp.
  const tab = raw.indexOf("\t");
  let path = tab >= 0 ? raw.slice(0, tab) : raw;
  path = unquotePath(path.trim());
  if (path === "/dev/null") return null;
  if (path.startsWith(prefix)) return path.slice(prefix.length);
  return path;
}

function finalize(record: FileRecord, out: CheckItem[]): void {
  if (record.renamedFrom !== null || record.renamedTo !== null) {
    if (record.renamedFrom !== null) out.push({ path: record.renamedFrom, op: "rename" });
    if (record.renamedTo !== null) out.push({ path: record.renamedTo, op: "rename" });
    return;
  }
  if (record.op === "create" && record.newPath !== null) {
    out.push({ path: record.newPath, op: "create" });
    return;
  }
  if (record.op === "delete" && record.oldPath !== null) {
    out.push({ path: record.oldPath, op: "delete" });
    return;
  }
  // Header-derived fallback: `/dev/null` on either side classifies the op
  // even without git's "new file mode" / "deleted file mode" lines.
  if (record.oldPath === null && record.newPath !== null) {
    out.push({ path: record.newPath, op: "create" });
  } else if (record.newPath === null && record.oldPath !== null) {
    out.push({ path: record.oldPath, op: "delete" });
  } else if (record.newPath !== null) {
    out.push({ path: record.newPath, op: "edit" });
  }
}

/** Extract every touched path (with its operation) from a unified diff. */
export function parseDiff(text: string): CheckItem[] {
  const out: CheckItem[] = [];
  let record: FileRecord | null = null;
  let sawHeaders = false;

  const flush = () => {
    if (record !== null && (sawHeaders || record.renamedFrom !== null || record.op !== null)) {
      finalize(record, out);
    }
    record = freshRecord();
    sawHeaders = false;
  };

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("diff --git ")) {
      flush();
    } else if (line.startsWith("new file mode")) {
      if (record === null) record = freshRecord();
      record.op = "create";
    } else if (line.startsWith("deleted file mode")) {
      if (record === null) record = freshRecord();
      record.op = "delete";
    } else if (line.startsWith("rename from ")) {
      if (record === null) record = freshRecord();
      record.renamedFrom = unquotePath(line.slice("rename from ".length).trim());
    } else if (line.startsWith("rename to ")) {
      if (record === null) record = freshRecord();
      record.renamedTo = unquotePath(line.slice("rename to ".length).trim());
    } else if (line.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ")) {
      // A real file header is always the `---`/`+++` pair; requiring the
      // pair keeps removed body lines that happen to start with `--` from
      // being misread as headers. A bare `---` header (plain unified diff)
      // also starts a new file when one is already in flight.
      if (record === null || sawHeaders) flush();
      if (record === null) record = freshRecord();
      record.oldPath = cleanHeaderPath(line.slice(4), "a/");
      record.newPath = cleanHeaderPath((lines[i + 1] as string).slice(4), "b/");
      sawHeaders = true;
      i++;
    }
  }
  flush();

  // Dedupe on path+op, preserving first-seen order.
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = `${item.op}\0${item.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
