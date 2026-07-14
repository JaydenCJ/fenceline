/**
 * Lexical path normalization. Every proposed path — from a CLI argument, a
 * diff header, or a harness hook event — is reduced to a canonical
 * root-relative form before any zone pattern sees it, so `db/../db/x.sql`
 * and `./db/x.sql` cannot dodge a fence that `db/x.sql` would hit.
 *
 * Purely lexical: nothing here touches the filesystem, follows symlinks or
 * consults the working directory. The fenced root is an input.
 */

export interface NormalizedPath {
  /** Root-relative path with `/` separators, or the collapsed absolute path when outside. */
  rel: string;
  /** `rel` split into segments (empty when the path is the root itself). */
  segments: string[];
  /** True when the path lexically escapes the fenced root. */
  outside: boolean;
  /** Set when the input is unusable (NUL byte, empty). */
  invalid: string | null;
}

const WINDOWS_DRIVE = /^[A-Za-z]:\//;

function invalid(reason: string): NormalizedPath {
  return { rel: "", segments: [], outside: false, invalid: reason };
}

/** Collapse `.`, `..` and `//` in a slash-separated path. */
function collapse(parts: string[]): { segments: string[]; escapes: number } {
  const out: string[] = [];
  let escapes = 0;
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0) out.pop();
      else escapes++;
    } else {
      out.push(part);
    }
  }
  return { segments: out, escapes };
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || WINDOWS_DRIVE.test(path);
}

/**
 * Normalize `input` against the fenced root. `root` must itself be an
 * absolute path (the CLI resolves it before calling); relative inputs are
 * interpreted as relative to that root.
 */
export function normalizePath(input: string, root: string): NormalizedPath {
  if (typeof input !== "string" || input.length === 0) return invalid("path is empty");
  if (input.includes("\0")) return invalid("path contains a NUL byte");

  // Backslashes are treated as separators so Windows-style tool input
  // cannot slip past a fence written with forward slashes.
  const slashed = input.replace(/\\/g, "/");
  const rootSlashed = root.replace(/\\/g, "/");
  const rootCollapsed = collapse(rootSlashed.split("/")).segments;
  const rootDrive = WINDOWS_DRIVE.test(rootSlashed) ? (rootSlashed[0] as string).toLowerCase() : null;

  if (isAbsolute(slashed)) {
    const drive = WINDOWS_DRIVE.test(slashed) ? (slashed[0] as string).toLowerCase() : null;
    const body = drive !== null ? slashed.slice(2) : slashed;
    const { segments } = collapse(body.split("/"));
    if (drive !== rootDrive) {
      return { rel: renderAbsolute(drive, segments), segments, outside: true, invalid: null };
    }
    // The root must be a whole-segment prefix of the path.
    for (let i = 0; i < rootCollapsed.length; i++) {
      if (segments[i] !== rootCollapsed[i]) {
        return { rel: renderAbsolute(drive, segments), segments, outside: true, invalid: null };
      }
    }
    const relSegments = segments.slice(rootCollapsed.length);
    return { rel: relSegments.join("/"), segments: relSegments, outside: false, invalid: null };
  }

  const { segments, escapes } = collapse(slashed.split("/"));
  if (escapes > 0) {
    const rel = "../".repeat(escapes) + segments.join("/");
    return { rel, segments, outside: true, invalid: null };
  }
  return { rel: segments.join("/"), segments, outside: false, invalid: null };
}

function renderAbsolute(drive: string | null, segments: string[]): string {
  const prefix = drive !== null ? `${drive}:/` : "/";
  return prefix + segments.join("/");
}
