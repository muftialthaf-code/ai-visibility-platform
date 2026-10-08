import { parseArticle } from '@avp/content';
import type { TenantStore } from '@avp/tenant-ops';

export interface ExistingArticle {
  slug: string;
  title: string;
  body: string;
  path: string;
}

/** Articles already published for a tenant in one language (read from the production branch). Unreadable files are skipped. */
export async function existingArticles(store: TenantStore, tenantId: string, lang: string): Promise<ExistingArticle[]> {
  const paths = (await store.listFiles(`tenants/${tenantId}/articles/${lang}/`)).filter((p) => p.endsWith('.md'));
  const out: ExistingArticle[] = [];
  for (const path of paths) {
    const raw = await store.readFile(path);
    if (!raw) continue;
    try {
      const a = parseArticle(raw);
      out.push({ slug: a.slug, title: a.title, body: a.body, path });
    } catch {
      /* a malformed file is a problem for the site build, not for the agent */
    }
  }
  return out;
}
