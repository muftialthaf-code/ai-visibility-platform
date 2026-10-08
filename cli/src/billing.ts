import { createHmac } from 'node:crypto';
import { connect, migrate, usageStatement } from '@avp/db';
import { requireSecret } from '@avp/runtime';
import type { TenantStore } from '@avp/tenant-ops';
import { strFlag, type ParsedArgs } from './args.ts';

/** HMAC-SHA256 signature of a webhook body, sent as `X-AVP-Signature: sha256=<hex>`. The receiver recomputes it with the shared secret. */
export const sign = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/**
 * billing usage [--month YYYY-MM] [--post]
 * Prints what each business used in the month. With --post, also sends it to BILLING_WEBHOOK_URL, signed with
 * BILLING_WEBHOOK_SECRET, so an invoicing system can turn usage into charges. Prices are not decided here.
 */
export async function billingCommand(args: ParsedArgs, _store: TenantStore, env: NodeJS.ProcessEnv = process.env, fetchFn: typeof fetch = fetch): Promise<number> {
  if (args.positional[0] !== 'usage') {
    console.log('Usage: billing usage [--month YYYY-MM] [--post]');
    return args.positional[0] ? 1 : 0;
  }
  const month = strFlag(args, 'month') ?? new Date(Date.now() - 15 * 86400_000).toISOString().slice(0, 7); // default: last month
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('--month must look like 2026-10');
  const db = await connect(requireSecret(env, 'DATABASE_URL'));
  try {
    await migrate(db);
    const body = JSON.stringify({ month, generatedAt: new Date().toISOString(), tenants: await usageStatement(db, month) });
    console.log(body);
    if (!args.flags.post) return 0;
    const url = requireSecret(env, 'BILLING_WEBHOOK_URL');
    const secret = requireSecret(env, 'BILLING_WEBHOOK_SECRET');
    if (!/^https:\/\//.test(url)) throw new Error('BILLING_WEBHOOK_URL must start with https://');
    const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AVP-Signature': sign(body, secret) }, body });
    console.error(`Billing webhook answered ${res.status}`);
    return res.ok ? 0 : 1;
  } finally {
    await db.close();
  }
}
