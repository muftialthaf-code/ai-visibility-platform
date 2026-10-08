import { MIGRATIONS, type Migration } from './migrations/index.ts';
import type { Db } from './types.ts';

/** Apply any migrations that have not run yet, in order. Returns the names applied. */
export async function migrate(db: Db, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    // A multi-statement simple query runs as one implicit transaction: all of it applies or none of it.
    await db.exec(`${m.sql}\n;insert into schema_migrations (name) values ('${m.name.replace(/'/g, "''")}');`);
    applied.push(m.name);
  }
  return applied;
}
