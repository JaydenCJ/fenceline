# fenceline examples

Two complete fence files plus sample inputs for every enforcement surface.
All commands run from the repository root after `npm install && npm run build`
(use `node dist/cli.js` in place of `fenceline` when not installed globally).

## Fence files

- **[webapp.fenceline.json](webapp.fenceline.json)** — a web service:
  lockfiles and generated API clients blocked, applied SQL migrations
  append-only (`create` allowed, `edit`/`delete`/`rename` blocked), release
  metadata behind `ask`, build output on `warn`, `outside: "block"`.
  12 embedded tests.
- **[oss-library.fenceline.json](oss-library.fenceline.json)** — an
  open-source library: the LICENSE untouchable, the public API surface
  behind `ask`, vendored code blocked. 5 embedded tests.

Run their embedded tests:

```bash
fenceline test --policy examples/webapp.fenceline.json
fenceline test --policy examples/oss-library.fenceline.json
```

## Diffs (`diffs/`)

Feed a diff to the standalone checker — this is exactly what the git
pre-commit hook does with the staged diff:

```bash
fenceline check --diff --policy examples/webapp.fenceline.json < examples/diffs/lockfile-drift.diff
fenceline check --diff --policy examples/webapp.fenceline.json < examples/diffs/new-migration.diff      # exit 0
fenceline check --diff --policy examples/webapp.fenceline.json < examples/diffs/rewrite-migration.diff  # exit 1
```

`new-migration.diff` creates `0043_new_table.sql` and passes;
`rewrite-migration.diff` edits the already-applied `0042` and is blocked —
same zone, different operation.

## Hook events (`events/`)

What the live hook adapters receive on stdin:

```bash
fenceline hook claude-code --policy examples/webapp.fenceline.json < examples/events/claude-edit-lockfile.json
fenceline hook claude-code --policy examples/webapp.fenceline.json < examples/events/claude-edit-source.json
fenceline hook generic     --policy examples/webapp.fenceline.json < examples/events/generic-edit-changelog.json
```

The lockfile edit answers with a `deny` decision, the source edit stays
silent (allowed), and the changelog edit exits 3 — ask a human.
