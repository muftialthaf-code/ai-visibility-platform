import { connect } from './connect.ts';
import { migrate } from './migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL (postgres://... or pglite://./.data/dev)');
  process.exit(1);
}
const db = await connect(url);
const applied = await migrate(db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
await db.close();
