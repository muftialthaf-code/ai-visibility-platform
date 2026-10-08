export interface ParsedArgs {
  positional: string[];
  /** Last value wins for repeated flags. */
  flags: Record<string, string | boolean>;
  /** Every value of a repeated flag, in order, e.g. multiple --set. */
  all: Record<string, string[]>;
}

/** Tiny argument parser: `--flag`, `--key value`, `--key=value`. Everything else is positional. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const all: Record<string, string[]> = {};
  const record = (name: string, value: string | boolean) => {
    flags[name] = value;
    if (typeof value === 'string') (all[name] ??= []).push(value);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > -1) {
      record(a.slice(2, eq), a.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        record(a.slice(2), next);
        i++;
      } else {
        record(a.slice(2), true);
      }
    }
  }
  return { positional, flags, all };
}

export function strFlag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === 'string' ? v : undefined;
}

export function need(value: string | undefined, what: string): string {
  if (!value) throw new Error(`Missing ${what}`);
  return value;
}
