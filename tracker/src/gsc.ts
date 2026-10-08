/** Google Search Console: weekly clicks, impressions and top queries for a site, via a refresh token. Untested against the live API. */

export interface GscCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GscWeek {
  clicks: number;
  impressions: number;
  avg_position: number | null;
  top_queries: Array<{ query: string; clicks: number; impressions: number }>;
}

async function accessToken(c: GscCredentials, f: typeof fetch): Promise<string> {
  const res = await f('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}). The refresh token may have been revoked.`);
  return ((await res.json()) as { access_token: string }).access_token;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** `property` is the Search Console property, for example "sc-domain:example.com" or "https://example.com/". `weekStart` is a Monday (YYYY-MM-DD). */
export async function fetchSearchConsoleWeek(c: GscCredentials, property: string, weekStart: string, f: typeof fetch = fetch): Promise<GscWeek> {
  const token = await accessToken(c, f);
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86400_000);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const post = async (body: unknown) => {
    const res = await f(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Search Console answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as { rows?: Array<{ keys?: string[]; clicks: number; impressions: number; position: number }> };
  };
  const range = { startDate: day(start), endDate: day(end) };
  const totals = await post({ ...range });
  const queries = await post({ ...range, dimensions: ['query'], rowLimit: 10 });
  const t = totals.rows?.[0];
  return {
    clicks: Math.round(t?.clicks ?? 0),
    impressions: Math.round(t?.impressions ?? 0),
    avg_position: t ? Math.round(t.position * 10) / 10 : null,
    top_queries: (queries.rows ?? []).map((r) => ({ query: r.keys?.[0] ?? '', clicks: Math.round(r.clicks), impressions: Math.round(r.impressions) })),
  };
}
