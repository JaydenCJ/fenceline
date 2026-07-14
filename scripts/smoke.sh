#!/usr/bin/env bash
# Smoke test for fenceline: exercises the real CLI end to end against the
# bundled example fences, diffs and hook events. No network, idempotent,
# runs from a clean checkout (after `npm install`). Prints "SMOKE OK" on
# success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

WEBAPP="examples/webapp.fenceline.json"
LIBRARY="examples/oss-library.fenceline.json"

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents every subcommand.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in check validate test list init hooks hook; do
  echo "$HELP" | grep -q "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Exit-code contract: unknown commands and missing policies exit 2,
#    invalid policies exit 1 with the offending JSON path on stderr.
set +e
$CLI frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown command should exit 2"; }
$CLI validate --policy "$WORKDIR/nope.json" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing policy should exit 2"; }
set -e
printf '{"version":1,"zones":[{"id":"z","action":"deny","paths":["x"]}]}' > "$WORKDIR/bad.json"
set +e
BAD_OUT="$($CLI validate --policy "$WORKDIR/bad.json" 2>&1)"; BAD_CODE=$?
set -e
[ "$BAD_CODE" -eq 1 ] || fail "invalid policy should exit 1, got $BAD_CODE"
echo "$BAD_OUT" | grep -q "zones\[0\].action" || fail "validate error missing JSON path: $BAD_OUT"
echo "[smoke] exit codes ok (2 usage/io, 1 findings)"

# 4. validate accepts both bundled example fences.
$CLI validate --policy "$WEBAPP"  | grep -q "^OK: 6 zones, 12 embedded tests" || fail "validate of $WEBAPP failed"
$CLI validate --policy "$LIBRARY" | grep -q "^OK: 3 zones, 5 embedded tests"  || fail "validate of $LIBRARY failed"
echo "[smoke] validate ok (both example fences)"

# 5. check: the allow/block/ask triad, exit codes 0/1/3.
$CLI check src/routes/users.ts --policy "$WEBAPP" | grep -q "^ALLOW" || fail "source file should be allowed"
set +e
$CLI check package-lock.json --policy "$WEBAPP" > "$WORKDIR/block.txt"; BLOCK_CODE=$?
$CLI check CHANGELOG.md --policy "$WEBAPP" > "$WORKDIR/ask.txt"; ASK_CODE=$?
set -e
[ "$BLOCK_CODE" -eq 1 ] || fail "lockfile edit should exit 1, got $BLOCK_CODE"
grep -q "zone lockfiles" "$WORKDIR/block.txt" || fail "block should name its zone"
[ "$ASK_CODE" -eq 3 ] || fail "changelog edit should exit 3 (ask), got $ASK_CODE"
echo "[smoke] check ok (allow=0, block=1, ask=3)"

# 6. Traversal cannot dodge, and --explain names the deciding pattern.
set +e
EXPLAIN="$($CLI check --explain "src/../package-lock.json" --policy "$WEBAPP")"
[ $? -eq 1 ] || { set -e; fail "traversal should still be blocked"; }
set -e
echo "$EXPLAIN" | grep -q 'matched "package-lock.json"' || fail "--explain missing deciding pattern"
echo "[smoke] normalization ok (traversal caught, explained)"

# 7. Diff checking: op classification separates a new migration (create,
#    allowed) from a rewrite of an applied one (edit, blocked).
$CLI check --diff --policy "$WEBAPP" < examples/diffs/new-migration.diff > /dev/null 2>&1 \
  || fail "new migration diff should pass"
set +e
$CLI check --diff --policy "$WEBAPP" < examples/diffs/rewrite-migration.diff > /dev/null 2>"$WORKDIR/rw.err"
RW_CODE=$?
$CLI check --diff --policy "$WEBAPP" < examples/diffs/lockfile-drift.diff > "$WORKDIR/drift.txt" 2>"$WORKDIR/drift.err"
DRIFT_CODE=$?
set -e
[ "$RW_CODE" -eq 1 ] || fail "migration rewrite diff should exit 1, got $RW_CODE"
[ "$DRIFT_CODE" -eq 1 ] || fail "lockfile drift diff should exit 1, got $DRIFT_CODE"
grep -q "checked 2 paths: 1 allow, 1 block, 0 warn, 0 ask" "$WORKDIR/drift.err" || fail "diff summary wrong"
echo "[smoke] diff ok (create allowed, edit blocked, summary counted)"

# 8. Embedded policy tests: both examples pass their own pinned decisions.
$CLI test --policy "$WEBAPP"  | grep -q "12 passed, 0 failed" || fail "webapp fence tests failed"
$CLI test --policy "$LIBRARY" | grep -q "5 passed, 0 failed"  || fail "library fence tests failed"
echo "[smoke] embedded policy tests ok (12 + 5)"

# 9. Live hook, claude-code protocol: fenced edit answers deny (exit 0,
#    JSON out), unfenced edit and non-file tools stay silent.
DENY="$($CLI hook claude-code --policy "$WEBAPP" < examples/events/claude-edit-lockfile.json)"
echo "$DENY" | grep -q '"permissionDecision":"deny"' || fail "claude-code hook should deny the lockfile edit"
SILENT="$($CLI hook claude-code --policy "$WEBAPP" < examples/events/claude-edit-source.json)"
[ -z "$SILENT" ] || fail "claude-code hook should stay silent on an allowed edit"
echo "[smoke] claude-code hook ok (deny JSON, silent allow)"

# 10. Live hook, generic protocol: ask exits 3 with a JSON reply.
set +e
GENERIC="$($CLI hook generic --policy "$WEBAPP" < examples/events/generic-edit-changelog.json)"
GEN_CODE=$?
set -e
[ "$GEN_CODE" -eq 3 ] || fail "generic hook should exit 3 (ask), got $GEN_CODE"
echo "$GENERIC" | grep -q '"decision":"ask"' || fail "generic hook reply wrong: $GENERIC"
echo "[smoke] generic hook ok (ask=3)"

# 11. init + hooks --write round trip in a scratch repo: the starter fence
#     passes its own tests and both installers write real files.
mkdir -p "$WORKDIR/repo/.git/hooks"
(
  cd "$WORKDIR/repo"
  $CLI init --preset node | grep -q "wrote fenceline.json" || fail "init failed"
  $CLI test | grep -q "0 failed" || fail "starter fence failed its own tests"
  $CLI hooks claude-code --write >/dev/null || fail "hooks claude-code --write failed"
  grep -q "fenceline hook claude-code" .claude/settings.json || fail "settings.json missing hook"
  $CLI hooks git --write >/dev/null || fail "hooks git --write failed"
  test -x .git/hooks/pre-commit || fail "pre-commit not installed executable"
)
echo "[smoke] init + hooks --write ok (claude-code settings, git pre-commit)"

# 12. Determinism: two identical JSON check runs are byte-identical.
$CLI check --format json package-lock.json --policy "$WEBAPP" > "$WORKDIR/run1.json" || true
$CLI check --format json package-lock.json --policy "$WEBAPP" > "$WORKDIR/run2.json" || true
cmp -s "$WORKDIR/run1.json" "$WORKDIR/run2.json" || fail "check output is not deterministic"
echo "[smoke] determinism ok"

echo "SMOKE OK"
