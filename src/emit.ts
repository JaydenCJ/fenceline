/**
 * Hook config generation: the "compile the fence to your harness" half of
 * fenceline. Everything here produces text or plain objects; the CLI owns
 * the actual file writes so these stay trivially unit-testable.
 */

/** The PreToolUse hook entry fenceline installs into Claude Code settings. */
export function claudeHookEntry(policyPath: string): Record<string, unknown> {
  return {
    matcher: "Edit|Write|MultiEdit|NotebookEdit",
    hooks: [
      {
        type: "command",
        command: `fenceline hook claude-code --policy ${shellQuote(policyPath)}`,
      },
    ],
  };
}

/** A complete minimal `.claude/settings.json` document with the hook. */
export function claudeSettingsSnippet(policyPath: string): string {
  const doc = { hooks: { PreToolUse: [claudeHookEntry(policyPath)] } };
  return JSON.stringify(doc, null, 2) + "\n";
}

/**
 * Merge the fenceline hook into an existing settings document without
 * disturbing anything else. Idempotent: an entry whose command already
 * invokes `fenceline hook claude-code` is left alone (and its policy path
 * updated in place), so repeated `--write` runs never stack duplicates.
 */
export function mergeClaudeSettings(existing: unknown, policyPath: string): Record<string, unknown> {
  const doc: Record<string, unknown> =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const hooks: Record<string, unknown> =
    typeof doc.hooks === "object" && doc.hooks !== null && !Array.isArray(doc.hooks)
      ? { ...(doc.hooks as Record<string, unknown>) }
      : {};
  const pre: unknown[] = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];

  const isOurs = (entry: unknown): boolean => {
    if (typeof entry !== "object" || entry === null) return false;
    const list = (entry as Record<string, unknown>).hooks;
    if (!Array.isArray(list)) return false;
    return list.some(
      (h) =>
        typeof h === "object" &&
        h !== null &&
        typeof (h as Record<string, unknown>).command === "string" &&
        ((h as Record<string, unknown>).command as string).startsWith("fenceline hook claude-code"),
    );
  };

  const index = pre.findIndex(isOurs);
  if (index >= 0) pre[index] = claudeHookEntry(policyPath);
  else pre.push(claudeHookEntry(policyPath));

  hooks.PreToolUse = pre;
  doc.hooks = hooks;
  return doc;
}

/** The git pre-commit hook script: last line of defense, agent or human. */
export function gitPreCommitScript(policyPath: string): string {
  return `#!/bin/sh
# fenceline pre-commit hook — refuses commits that touch protected paths.
# Installed by: fenceline hooks git --write
# Bypass a single commit with: FENCELINE_SKIP=1 git commit ...
[ -n "\${FENCELINE_SKIP:-}" ] && exit 0
if ! command -v fenceline >/dev/null 2>&1; then
  echo "fenceline: not on PATH; skipping fence check" >&2
  exit 0
fi
git diff --cached --no-color --unified=0 | fenceline check --diff --policy ${shellQuote(policyPath)}
status=$?
if [ "$status" -ne 0 ]; then
  echo "" >&2
  echo "fenceline: commit touches protected paths (see above)." >&2
  echo "fenceline: bypass once with FENCELINE_SKIP=1 if you are sure." >&2
fi
exit "$status"
`;
}

/** How the generic protocol is wired, shown by `fenceline hooks generic`. */
export function genericProtocolHelp(policyPath: string): string {
  return `# fenceline generic hook protocol
#
# Pipe one JSON event to \`fenceline hook generic\` per proposed change:
#
#   echo '{"path": "package-lock.json", "op": "edit"}' \\
#     | fenceline hook generic --policy ${shellQuote(policyPath)}
#
# stdout: {"decision": "...", "zone": "...", "reason": "..."}
# exit:   0 allow/warn · 1 block · 3 ask · 2 usage error
#
# Wire it wherever your harness lets a command veto a file change:
# gate on the exit code, or parse the JSON for the reason to show.
`;
}

function shellQuote(text: string): string {
  if (/^[A-Za-z0-9._\/-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}
