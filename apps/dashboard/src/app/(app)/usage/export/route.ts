import { usageStatement } from '@avp/db';
import { requireUser } from '@/lib/auth';
import { currentMonth } from '@/lib/overview';
import { toCsv } from '@/lib/reports';
import { getDb } from '@/lib/services';

/** Monthly usage per business as CSV, for invoicing. This is usage and cost, not a price. */
export async function GET(req: Request) {
  await requireUser('reports:read');
  const m = new URL(req.url).searchParams.get('month') ?? '';
  const month = /^\d{4}-\d{2}$/.test(m) ? m : currentMonth();
  const lines = await usageStatement(await getDb(), month);
  const csv = toCsv(lines.map((l) => ({ month, business: l.tenantId, articles_written: l.articlesWritten, articles_held: l.articlesHeld, tracker_answers: l.trackerAnswers, run_seconds: l.runSeconds, model_cost_usd: l.costUsd })));
  return new Response(csv || 'month,business\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="usage-${month}.csv"` } });
}
