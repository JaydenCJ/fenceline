# Contributing to fenceline

Issues, discussions and pull requests are all welcome — this project aims to
stay small, zero-dependency at runtime, and boring in the way a fence
should be.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/fenceline.git
cd fenceline
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (the allow/block/ask exit triad,
traversal normalization, diff op classification, both live hook protocols,
`init` + both `hooks --write` installers, determinism) against the bundled
example fences and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable modules
   (the engine, glob and path code take data, not file handles).
5. Changes to matching or decision semantics need a row in
   `docs/policy-format.md`, the README tables, and a test pinning the exact
   decision.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- **No I/O in the engine.** Decisions are made lexically on the proposed
  path — the engine never reads the files it rules on. The only sanctioned
  I/O lives at the edges: policy loading, the `Write` create/edit probe in
  the claude-code adapter, and the `--write` installers.
- **Fail loud on policy errors, fail soft on hook errors.** A broken fence
  file must be a hard error at load time, but a live hook must never brick
  every tool call unless the operator chose `--fail-closed`.
- Decisions must stay deterministic: the same policy, path, op and root
  always produce byte-identical output.
- Exit codes (0 allow / 1 block / 2 usage / 3 ask) are stable API; do not
  repurpose them.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `fenceline --version` output, the fence file (or a minimal
one), the exact path/op or hook event JSON, the `--explain` output, and what
you expected the decision to be. For bypass reports — a path that should
have been fenced but was not — see Security below instead.

## Security

fenceline is a guardrail, so bypasses are vulnerabilities: do not open
public issues for them. Use GitHub private vulnerability reporting on this
repository instead.
