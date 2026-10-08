import { tenant } from '../lib/tenant.ts';

// Serves the IndexNow ownership file at /<key>.txt. Only generated when the tenant has a key.
export function getStaticPaths() {
  const key = tenant.integrations.indexNowKey;
  return key ? [{ params: { key } }] : [];
}

export function GET({ params }: { params: { key: string } }) {
  return new Response(params.key, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
