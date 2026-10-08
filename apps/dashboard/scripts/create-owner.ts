// Create the first owner from the command line (the browser-based /setup page does the same).
// Usage: DATABASE_URL=... pnpm --filter @avp/dashboard create-owner you@example.com 'a-long-passphrase'
import { connect, createUser, getUserByEmail, migrate } from '@avp/db';
import { hashPassword, passwordProblem } from '../src/lib/crypto.ts';

const [email, password] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url || !email || !password) {
  console.error('Usage: DATABASE_URL=... create-owner <email> <password>');
  process.exit(1);
}
const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}
const db = await connect(url);
await migrate(db);
if (await getUserByEmail(db, email)) {
  console.error('A user with that email already exists.');
  process.exit(1);
}
await createUser(db, { email, passwordHash: await hashPassword(password), role: 'owner' });
console.log(`Owner ${email} created. Sign in, then enrol an authenticator app.`);
await db.close();
