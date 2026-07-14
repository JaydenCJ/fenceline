/**
 * Built-in starter fences for `fenceline init --preset <name>`. Each preset
 * is a complete, valid policy document — including embedded tests, so
 * `fenceline test` passes on a freshly initialized repository and keeps
 * passing (or honestly failing) as the fence is edited.
 *
 * Presets are a starting point, not a verdict on your repo: init writes
 * them as plain JSON precisely so you can prune and extend them in review.
 */

const SECRETS_ZONE = {
  id: "secrets",
  action: "block",
  paths: [".env", ".env.*", "*.pem", "id_rsa*"],
  except: [".env.example", ".env.sample"],
  reason: "secrets and private keys must never be edited by automation",
  hint: "change secrets out-of-band and keep them out of the repository",
};

const VCS_ZONE = {
  id: "vcs-internals",
  action: "block",
  paths: [".git/"],
  reason: "the version-control database is not a file to edit",
};

const BASE_TESTS = [
  { name: "the env file is fenced", path: ".env", expect: "block", zone: "secrets" },
  { name: "the example env file is fair game", path: ".env.example", expect: "allow" },
  { name: "git internals are fenced", path: ".git/hooks/pre-commit", expect: "block", zone: "vcs-internals" },
];

const PRESETS: Record<string, unknown> = {
  base: {
    version: 1,
    zones: [SECRETS_ZONE, VCS_ZONE],
    tests: [...BASE_TESTS, { name: "ordinary source files are allowed", path: "src/main.c", expect: "allow" }],
  },

  node: {
    version: 1,
    zones: [
      {
        id: "lockfiles",
        action: "block",
        paths: ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"],
        reason: "lockfiles are generated; hand edits desynchronize them from the manifest",
        hint: "run your package manager (npm/pnpm/yarn/bun install) instead",
      },
      {
        id: "dependencies",
        action: "block",
        paths: ["node_modules/"],
        reason: "vendored dependencies are not yours to edit",
        hint: "patch upstream, or use your package manager's patch mechanism",
      },
      {
        id: "build-output",
        action: "warn",
        paths: ["dist/", "build/", "coverage/"],
        reason: "generated output — the next build will overwrite this change",
        hint: "edit the source that generates it instead",
      },
      SECRETS_ZONE,
      VCS_ZONE,
    ],
    tests: [
      ...BASE_TESTS,
      { name: "the npm lockfile is fenced", path: "package-lock.json", expect: "block", zone: "lockfiles" },
      { name: "nested workspace lockfiles are fenced too", path: "packages/api/package-lock.json", expect: "block", zone: "lockfiles" },
      { name: "vendored dependencies are fenced", path: "node_modules/left-pad/index.js", expect: "block", zone: "dependencies" },
      { name: "build output only warns", path: "dist/index.js", expect: "warn", zone: "build-output" },
      { name: "the manifest itself is editable", path: "package.json", expect: "allow" },
    ],
  },

  python: {
    version: 1,
    zones: [
      {
        id: "lockfiles",
        action: "block",
        paths: ["poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock"],
        reason: "lockfiles are generated; hand edits desynchronize them from the manifest",
        hint: "run your package manager (poetry/uv/pipenv/pdm lock) instead",
      },
      {
        id: "migrations",
        action: "block",
        paths: ["**/migrations/*.py", "**/alembic/versions/*.py"],
        except: ["**/migrations/__init__.py"],
        ops: ["edit", "delete", "rename"],
        reason: "applied migrations are append-only history",
        hint: "add a new migration instead of rewriting one that may have run",
      },
      {
        id: "caches",
        action: "block",
        paths: ["__pycache__/", "*.pyc", ".venv/", "venv/"],
        reason: "interpreter caches and virtualenvs are not source",
      },
      SECRETS_ZONE,
      VCS_ZONE,
    ],
    tests: [
      ...BASE_TESTS,
      { name: "the poetry lockfile is fenced", path: "poetry.lock", expect: "block", zone: "lockfiles" },
      { name: "editing an applied migration is fenced", path: "app/migrations/0042_add_index.py", op: "edit", expect: "block", zone: "migrations" },
      { name: "creating a new migration is fine", path: "app/migrations/0043_new_table.py", op: "create", expect: "allow" },
      { name: "the migrations package marker is editable", path: "app/migrations/__init__.py", expect: "allow" },
    ],
  },

  go: {
    version: 1,
    zones: [
      {
        id: "module-checksums",
        action: "block",
        paths: ["go.sum"],
        reason: "go.sum is maintained by the go tool; hand edits break verification",
        hint: "run go mod tidy instead",
      },
      {
        id: "vendored",
        action: "block",
        paths: ["vendor/"],
        reason: "vendored dependencies are not yours to edit",
        hint: "change the dependency upstream and re-vendor",
      },
      {
        id: "generated",
        action: "block",
        paths: ["*.pb.go", "*_string.go", "**/*_generated.go"],
        reason: "generated code — regenerate it, don't patch it",
        hint: "edit the source (.proto, go:generate directive) and regenerate",
      },
      SECRETS_ZONE,
      VCS_ZONE,
    ],
    tests: [
      ...BASE_TESTS,
      { name: "module checksums are fenced", path: "go.sum", expect: "block", zone: "module-checksums" },
      { name: "protobuf output is fenced anywhere", path: "internal/api/v1/api.pb.go", expect: "block", zone: "generated" },
      { name: "go.mod stays editable", path: "go.mod", expect: "allow" },
    ],
  },

  rust: {
    version: 1,
    zones: [
      {
        id: "lockfiles",
        action: "block",
        paths: ["Cargo.lock"],
        reason: "Cargo.lock is generated; hand edits desynchronize it from Cargo.toml",
        hint: "run cargo update or cargo build instead",
      },
      {
        id: "build-output",
        action: "block",
        paths: ["target/"],
        reason: "compiler output is not source",
      },
      SECRETS_ZONE,
      VCS_ZONE,
    ],
    tests: [
      ...BASE_TESTS,
      { name: "the cargo lockfile is fenced", path: "Cargo.lock", expect: "block", zone: "lockfiles" },
      { name: "workspace member lockfiles are fenced too", path: "crates/core/Cargo.lock", expect: "block", zone: "lockfiles" },
      { name: "the manifest itself is editable", path: "Cargo.toml", expect: "allow" },
    ],
  },
};

export const PRESET_NAMES: readonly string[] = Object.keys(PRESETS);

/** The raw (uncompiled) policy document for a preset, or null if unknown. */
export function presetPolicy(name: string): unknown | null {
  const preset = PRESETS[name];
  if (preset === undefined) return null;
  // Deep-copy through JSON so callers can mutate their copy freely.
  return JSON.parse(JSON.stringify(preset));
}
