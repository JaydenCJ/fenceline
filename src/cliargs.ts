/**
 * A deliberately small argv parser: long flags only, `--opt value` and
 * `--opt=value`, booleans, and positionals. Unknown flags are errors — a
 * fencing tool that silently ignores a mistyped `--polcy` would be worse
 * than none.
 */

export interface ArgSpec {
  /** Flags that take a value, e.g. ["policy", "root"]. */
  options: string[];
  /** Boolean flags, e.g. ["explain", "write"]. */
  flags: string[];
}

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string>;
  flags: Record<string, boolean>;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[], spec: ArgSpec): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string> = {};
  const flags: Record<string, boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (spec.flags.includes(name)) {
      if (eq >= 0) throw new UsageError(`--${name} does not take a value`);
      flags[name] = true;
    } else if (spec.options.includes(name)) {
      if (eq >= 0) {
        options[name] = arg.slice(eq + 1);
      } else {
        const value = argv[i + 1];
        if (value === undefined) throw new UsageError(`--${name} requires a value`);
        options[name] = value;
        i++;
      }
    } else {
      throw new UsageError(`unknown option --${name}`);
    }
  }
  return { positionals, options, flags };
}
