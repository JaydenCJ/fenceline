# The fence file

One JSON document, conventionally `fenceline.json` at the repository root
(`.fenceline.json` is also picked up). The loader is strict: unknown keys,
duplicate zone ids, empty pattern lists and uncompilable globs are hard
errors, each reported with its JSON path.

```json
{
  "version": 1,
  "outside": "ignore",
  "zones": [
    {
      "id": "migrations",
      "action": "block",
      "paths": ["db/migrations/*.sql"],
      "except": ["db/migrations/README.md"],
      "ops": ["edit", "delete", "rename"],
      "reason": "applied migrations are append-only history",
      "hint": "add a new migration instead of rewriting one that may have run"
    }
  ],
  "tests": [
    { "name": "editing an applied migration is blocked",
      "path": "db/migrations/0042_add_index.sql", "expect": "block", "zone": "migrations" },
    { "name": "creating a new migration is allowed",
      "path": "db/migrations/0043_new.sql", "op": "create", "expect": "allow" }
  ]
}
```

## Top level

| Key | Required | Default | Effect |
|---|---|---|---|
| `version` | yes | — | must be `1` |
| `outside` | no | `"ignore"` | what to do with paths that resolve outside the fenced root: `"ignore"` (allow, flagged) or `"block"` |
| `zones` | yes | — | ordered array of zones; must be non-empty (a fence with no zones protects nothing) |
| `tests` | no | `[]` | pinned decisions replayed by `fenceline test` |

## Zones

Zones are evaluated **in file order; the first zone that matches decides**.
Put narrow carve-outs in `except`, and more specific zones above broader ones.

| Key | Required | Default | Effect |
|---|---|---|---|
| `id` | yes | — | unique slug (`[a-z0-9][a-z0-9._-]*`), named in every decision |
| `action` | yes | — | `"block"` (refuse), `"ask"` (defer to a human), `"warn"` (allow, but say so) |
| `paths` | yes | — | patterns the zone protects (dialect below) |
| `except` | no | `[]` | carve-outs; a matching path falls through to later zones |
| `ops` | no | all four | operations the zone covers: `edit`, `create`, `delete`, `rename`; others fall through |
| `reason` | no | generated | one human sentence surfaced with every decision |
| `hint` | no | — | remediation hint ("run npm install instead") |

`ops` is what makes append-only zones expressible: block `edit`/`delete`/`rename`
on `migrations/*.sql` while `create` passes.

## Pattern dialect

Deliberately gitignore-flavored, matched against normalized root-relative
paths — purely lexically, with no filesystem access:

| Pattern | Matches |
|---|---|
| `package-lock.json` | that name **at any depth** (no `/` = any segment) |
| `node_modules` | the directory and everything beneath it, at any depth |
| `db/migrations` | anchored to the root; covers the whole subtree |
| `dist/` | trailing slash accepted; same as `dist` |
| `**/migrations/*.py` | `**` spans segments; `*` and `?` stay inside one |
| `.env.*`, `[0-9]*.csv`, `[!a-z]?` | suffix globs and character classes |
| `{yarn,pnpm}-lock.yaml` | brace alternatives (nesting allowed) |
| `literal\*.txt` | backslash escapes a metacharacter |

Before any pattern is consulted, every path is normalized: `\` becomes `/`,
`.`/`..`/`//` collapse, absolute paths are relativized against the fenced
root. A path that lexically escapes the root is `outside` (see above); a
path carrying a NUL byte is blocked outright. So `src/../package-lock.json`
cannot dodge a fence that `package-lock.json` would hit.

## Embedded tests

| Key | Required | Default | Effect |
|---|---|---|---|
| `name` | yes | — | shown by `fenceline test` |
| `path` | yes | — | the path to decide |
| `op` | no | `edit` | the proposed operation |
| `expect` | yes | — | `allow`, `block`, `ask` or `warn` |
| `zone` | no | — | when set, the deciding zone must also match — catches shadowed zones |

`fenceline test` exits 1 on any failure, so reordering two zones in a way
that changes a pinned decision fails your build, not your repository.
