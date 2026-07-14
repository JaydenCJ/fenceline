# Enforcement surfaces

One fence file, four places to enforce it. `fenceline hooks <target>`
prints the config (add `--write` to install it); `fenceline hook
<protocol>` is the live adapter those configs invoke.

## Claude Code (PreToolUse hook)

```bash
fenceline hooks claude-code --write   # merges into .claude/settings.json
```

This registers `fenceline hook claude-code` for the `Edit | Write |
MultiEdit | NotebookEdit` tools. On each proposed change the adapter reads
the hook event from stdin, decides, and answers over the documented JSON
protocol (always exit 0):

| Zone action | `permissionDecision` | Effect in the agent |
|---|---|---|
| `block` | `deny` | the edit is refused; the reason and hint are shown to the model |
| `ask` | `ask` | the human is prompted with the reason |
| `warn` | `allow` | the edit proceeds; the reason is surfaced |
| (no zone) | — | the hook stays silent |

Details the adapter gets right:

- **`Write` is classified** as `create` when the target does not exist and
  `edit` when it does — append-only zones (`ops: ["edit", "delete", "rename"]`)
  let agents add new migrations while rewrites are refused.
- Non-file tools (`Bash`, `Read`, …) and unrecognized events pass through
  silently; the fence never breaks unrelated tool calls.
- If the fence file itself is broken, the adapter warns on stderr and
  allows, so one bad edit to `fenceline.json` cannot brick the session.
  Operators who prefer the paranoid default run the hook with
  `--fail-closed`, which turns unreadable events/policies into denials.

## git pre-commit (any editor, any agent)

```bash
fenceline hooks git --write   # writes .git/hooks/pre-commit
```

The installed script pipes `git diff --cached` through
`fenceline check --diff`, so the fence holds even for agents (or humans)
that bypass harness hooks entirely. `FENCELINE_SKIP=1 git commit …`
bypasses it once, deliberately and visibly. An existing pre-commit that is
not fenceline's is never replaced without `--force`.

## Generic protocol (any harness that can run a command)

```bash
echo '{"path": "package-lock.json", "op": "edit"}' | fenceline hook generic
```

One JSON event on stdin, one JSON reply on stdout —
`{"decision", "zone", "reason"}` — and the exit-code triad `0` allow/warn,
`1` block, `3` ask. Wire it into anything that lets a command veto a file
change: gate on the exit code, or parse the reply for the reason to show.

## Standalone checker (CI, scripts, review)

```bash
fenceline check --diff < pr.diff        # paths + ops from a unified diff
git diff --name-only main | fenceline check --stdin
fenceline check src/generated/api.ts --op delete
```

Same engine, same exit codes. `--format json` emits full verdicts including
the per-zone trace; `--explain` prints the trace as text.
