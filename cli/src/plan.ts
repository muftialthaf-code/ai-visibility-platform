/**
 * Decide which tenants a deploy must rebuild, given the files changed in a push.
 * A change to shared code (site template, packages, lockfile) rebuilds every active tenant.
 * A change confined to tenant folders rebuilds only those tenants.
 */
export function planDeploys(changedFiles: string[], activeIds: string[]): string[] {
  const active = new Set(activeIds);
  const shared = changedFiles.some(
    (f) =>
      f.startsWith('apps/site/') ||
      f.startsWith('packages/') ||
      f === 'package.json' ||
      f === 'pnpm-lock.yaml' ||
      f === 'pnpm-workspace.yaml' ||
      f === 'tsconfig.base.json',
  );
  if (shared) return [...active].sort();

  const touched = new Set<string>();
  for (const f of changedFiles) {
    const m = /^tenants\/([^/]+)\//.exec(f);
    if (m && active.has(m[1]!)) touched.add(m[1]!);
  }
  return [...touched].sort();
}

/** GitHub Actions matrix JSON: {"include":[{"tenant":"a"},...]}. */
export function toMatrix(ids: string[]): string {
  return JSON.stringify({ include: ids.map((tenant) => ({ tenant })) });
}

/** URLs worth pinging IndexNow about, from the files a push changed. */
export function changedUrls(changedFiles: string[], tenantId: string, siteUrl: string, defaultLanguage: string): string[] {
  const base = siteUrl.replace(/\/$/, '');
  const urls = new Set<string>();
  for (const f of changedFiles) {
    const m = new RegExp(`^tenants/${tenantId}/articles/([^/]+)/([^/]+)\\.md$`).exec(f);
    if (!m) continue;
    const [, lang, file] = m;
    const prefix = lang === defaultLanguage ? '' : `/${lang}`;
    urls.add(`${base}${prefix}/blog/${file}/`);
    urls.add(`${base}${prefix}/blog/`);
  }
  if (urls.size > 0) urls.add(`${base}/`);
  return [...urls].sort();
}
