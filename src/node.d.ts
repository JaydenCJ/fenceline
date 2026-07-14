/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 */

interface ReadableLike {
  setEncoding(encoding: "utf8"): void;
  on(event: "data", cb: (chunk: string) => void): void;
  on(event: "end", cb: () => void): void;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string, options?: { mode?: number }): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module "node:path" {
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}

declare var process: {
  argv: string[];
  exitCode: number | undefined;
  stdin: ReadableLike;
  stdout: { write(chunk: string): boolean; on(event: "error", cb: (err: { code?: string }) => void): void };
  stderr: { write(chunk: string): boolean; on(event: "error", cb: (err: { code?: string }) => void): void };
};
