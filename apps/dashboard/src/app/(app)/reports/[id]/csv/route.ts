import { requireUser } from '@/lib/auth';
import { toCsv } from '@/lib/reports';
import { getDb } from '@/lib/services';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser('reports:read', id);
  const rows = await (await getDb()).query(
    `select to_char(week,'YYYY-MM-DD') as week, provider, prompt, mentioned, cited, position, error from tracker_results where tenant_id = $1 order by week desc, prompt, provider`,
    [id],
  );
  return new Response(toCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}-ai-visibility.csv"` } });
}
