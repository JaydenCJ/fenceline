/**
 * The glob dialect fence patterns are written in. Deliberately
 * gitignore-flavored, because that is the pattern language people already
 * use to describe "these files, wherever they live":
 *
 *   - a pattern with no `/` matches any path segment at any depth
 *     (`*.lock` protects `Cargo.lock` and `crates/foo/Cargo.lock`);
 *   - a pattern with a `/` is anchored to the fenced root;
 *   - a pattern that names a directory protects everything beneath it
 *     (`db/migrations` covers `db/migrations/0042_init.sql`);
 *   - `**` spans any number of segments, `*` and `?` stay inside one,
 *     `[a-z]` / `[!a-z]` are character classes, `{a,b}` are alternatives,
 *     and a trailing `/` is shorthand for `/**`.
 *
 * Matching is purely lexical over already-normalized relative paths — no
 * filesystem access, ever.
 */

/** Thrown (as a message) when a pattern cannot be compiled. */
export function validatePattern(pattern: string): string | null {
  if (pattern.length === 0) return "pattern is empty";
  if (pattern.includes("\0")) return "pattern contains a NUL byte";
  let brace = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      if (i === pattern.length - 1) return "trailing backslash escapes nothing";
      i++;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "{") brace++;
    else if (ch === "}") {
      brace--;
      if (brace < 0) return "unbalanced '}'";
    }
  }
  if (inClass) return "unterminated character class '['";
  if (brace !== 0) return "unbalanced '{'";
  return null;
}

/**
 * Expand top-level `{a,b}` alternatives into plain patterns.
 * Nested braces are supported; escaped braces (`\{`) are literal.
 */
export function expandBraces(pattern: string): string[] {
  let depth = 0;
  let start = -1;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const head = pattern.slice(0, start);
        const body = pattern.slice(start + 1, i);
        const tail = pattern.slice(i + 1);
        const out: string[] = [];
        for (const alt of splitAlternatives(body)) {
          for (const expanded of expandBraces(head + alt + tail)) out.push(expanded);
        }
        return out;
      }
    }
  }
  return [pattern];
}

/** Split a brace body on top-level commas only. */
function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      current += ch + (body[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** Compile one path segment glob (`*`, `?`, `[...]`) to an anchored RegExp. */
function segmentToRegExp(segment: string): RegExp {
  let re = "^";
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i] as string;
    if (ch === "\\") {
      const next = segment[i + 1] ?? "";
      re += escapeRegExp(next);
      i++;
    } else if (ch === "*") {
      re += "[^/]*";
    } else if (ch === "?") {
      re += "[^/]";
    } else if (ch === "[") {
      const end = segment.indexOf("]", i + 1);
      // validatePattern guarantees a closing bracket exists.
      let body = segment.slice(i + 1, end);
      let negate = false;
      if (body.startsWith("!") || body.startsWith("^")) {
        negate = true;
        body = body.slice(1);
      }
      re += "[" + (negate ? "^" : "") + body.replace(/\\/g, "\\\\") + "]";
      i = end;
    } else {
      re += escapeRegExp(ch);
    }
  }
  return new RegExp(re + "$");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match pattern segments against path segments. `**` spans zero or more
 * segments. When the pattern is exhausted with path segments remaining the
 * match still succeeds: a pattern naming a directory protects its contents.
 */
function matchSegments(patSegs: RegExp[], isDoubleStar: boolean[], pathSegs: string[]): boolean {
  const memo = new Map<number, boolean>();
  const width = pathSegs.length + 1;
  const go = (pi: number, si: number): boolean => {
    const key = pi * width + si;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (pi === patSegs.length) {
      // Pattern exhausted: exact file match, or a directory whose
      // contents (the remaining segments) are covered by the pattern.
      result = true;
    } else if (isDoubleStar[pi]) {
      result = go(pi + 1, si) || (si < pathSegs.length && go(pi, si + 1));
    } else if (si === pathSegs.length) {
      result = false;
    } else {
      result = (patSegs[pi] as RegExp).test(pathSegs[si] as string) && go(pi + 1, si + 1);
    }
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

/** A compiled pattern, reusable across many paths. */
export interface CompiledPattern {
  source: string;
  test(pathSegments: string[]): boolean;
}

/** Compile a fence pattern. Call validatePattern first; this throws on garbage. */
export function compilePattern(pattern: string): CompiledPattern {
  const problem = validatePattern(pattern);
  if (problem !== null) throw new Error(`invalid pattern "${pattern}": ${problem}`);
  const variants = expandBraces(pattern).map(compileVariant);
  return {
    source: pattern,
    test(pathSegments: string[]): boolean {
      return variants.some((v) => v(pathSegments));
    },
  };
}

function compileVariant(variant: string): (pathSegments: string[]) => boolean {
  let pat = variant;
  // A trailing slash names a directory; since a pattern that matches a
  // directory already protects everything beneath it, it can be dropped.
  if (pat.endsWith("/") && pat.length > 1) pat = pat.slice(0, -1);
  if (pat.startsWith("./")) pat = pat.slice(2);
  if (pat.startsWith("/")) pat = pat.slice(1); // tolerate a leading anchor slash
  const anchored = hasUnescapedSlash(pat);
  if (!anchored) {
    // gitignore semantics: a bare name matches any segment at any depth,
    // protecting the whole subtree when it names a directory.
    const re = segmentToRegExp(pat);
    return (segs) => segs.some((s) => re.test(s));
  }
  const rawSegs = pat.split("/").filter((s) => s.length > 0);
  const isDoubleStar = rawSegs.map((s) => s === "**");
  const patSegs = rawSegs.map((s) => (s === "**" ? /^/ : segmentToRegExp(s)));
  return (segs) => matchSegments(patSegs, isDoubleStar, segs);
}

function hasUnescapedSlash(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\") i++;
    else if (pattern[i] === "/") return true;
  }
  return false;
}

/** One-shot convenience: does `pattern` match the relative path `segments`? */
export function matchPattern(pattern: string, relPath: string): boolean {
  const segments = relPath.split("/").filter((s) => s.length > 0);
  return compilePattern(pattern).test(segments);
}
