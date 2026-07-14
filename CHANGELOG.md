# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- Declarative fence files (`fenceline.json`): ordered protected zones with
  `block` / `ask` / `warn` actions, gitignore-flavored path patterns,
  `except` carve-outs, per-zone operation filters (`edit` / `create` /
  `delete` / `rename`) for append-only directories, human `reason` and
  `hint` strings, and an `outside` mode for paths escaping the root.
- Decision engine with first-match-wins zone evaluation and a full
  per-zone trace on every verdict; purely lexical — it never reads the
  files it rules on.
- Path normalization ahead of every match: `\` to `/`, `.`/`..`/`//`
  collapse, absolute-path relativization against the fenced root, NUL
  rejection — so `src/../package-lock.json` cannot dodge a fence.
- Glob dialect with bare-name any-depth matching, anchored patterns,
  directory subtree coverage, `**`, `?`, character classes, nested brace
  alternatives and escapes, compiled once per policy.
- Strict policy loader: unknown keys, duplicate zone ids, invalid actions,
  empty pattern lists and uncompilable globs are hard errors, each
  reported with its JSON path.
- Embedded policy tests (`tests` array) with decision and deciding-zone
  pinning, run by `fenceline test`, so a reordered zone that changes a
  decision fails fast.
- Hook compilation: `fenceline hooks claude-code` (prints or `--write`
  merges a PreToolUse entry into `.claude/settings.json`, idempotently),
  `fenceline hooks git` (pre-commit script piping the staged diff through
  the checker, with a visible `FENCELINE_SKIP=1` escape hatch), and
  `fenceline hooks generic` (a documented stdin/stdout protocol for any
  other harness).
- Live hook adapters: `fenceline hook claude-code` (deny/ask/allow JSON
  replies, `Write` classified as create vs edit, silent pass-through for
  non-file tools, fail-open by default with `--fail-closed` opt-in) and
  `fenceline hook generic`.
- Standalone checker: `fenceline check` over arguments, `--stdin` path
  lists, or `--diff` unified diffs (git and plain, with create/delete/
  rename classification, C-quoted paths and dedup), plus `--explain`
  traces and `--format json`; stable exit codes 0 allow / 1 block /
  2 usage / 3 ask.
- Starter presets (`fenceline init --preset base|node|python|go|rust`),
  each shipping with embedded tests that pass out of the box.
- Two bundled example fences (web app, OSS library) with 17 embedded
  tests between them, plus sample diffs and hook events.
- Public programmatic API (`loadPolicy`, `parsePolicy`, `compilePolicy`,
  `evaluate`, `parseDiff`, `parseClaudeEvent`, `runPolicyTests`, …) with
  type declarations.
- Test suite: 90 node:test tests (glob, paths, loader, engine, diff,
  adapters, emitters, presets, full CLI runs) and an end-to-end
  `scripts/smoke.sh` against the bundled examples.

[0.1.0]: https://github.com/JaydenCJ/fenceline/releases/tag/v0.1.0
