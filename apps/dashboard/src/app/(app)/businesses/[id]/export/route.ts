import { exportTenant } from '@avp/tenant-ops';
import { audit, requireUser } from '@/lib/auth';
import { getStore } from '@/lib/services';

export const dynamic = 'force-dynamic';

/** Download a business's full config and content as one JSON file (used when a client leaves). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser('tenants:lifecycle', id);
  try {
    const bundle = await exportTenant(getStore(user.email), id);
    await audit(user, 'tenant.export', id, { files: Object.keys(bundle).length });
    return new Response(JSON.stringify({ tenant: id, exportedAt: new Date().toISOString(), files: bundle }, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${id}-export.json"` },
    });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'Export failed', { status: 404 });
  }
}
