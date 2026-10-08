import type { Db } from './types.ts';

/**
 * Connect by URL:
 *   postgres://...        a real Postgres (Supabase, Neon, ...)
 *   pglite://memory       in-process Postgres in memory (tests)
 *   pglite://./some/dir   in-process Postgres stored on disk (local development)
 */
export async function connect(url: string): Promise<Db> {
  if (url.startsWith('pglite://')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const target = url.slice('pglite://'.length);
    const pg = target === 'memory' ? new PGlite() : new PGlite(target);
    await pg.waitReady;
    return {
      async query(sql, params) {
        const r = await pg.query(sql, params as any[]);
        return r.rows as any[];
      },
      async exec(sql) {
        await pg.exec(sql);
      },
      close: () => pg.close(),
    };
  }

  const pgModule = await import('pg');
  const { Pool, types } = pgModule.default;
  // bigint (int8) and numeric come back as strings by default. Counts and costs fit in a JS number.
  types.setTypeParser(20, (v: string) => Number(v));
  types.setTypeParser(1700, (v: string) => Number(v));
  const pool = new Pool({ connectionString: url, max: 5, ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  return {
    async query(sql, params) {
      const r = await pool.query(sql, params as any[]);
      return r.rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}
