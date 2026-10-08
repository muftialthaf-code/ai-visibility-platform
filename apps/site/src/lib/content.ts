import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import { parseArticle, renderMarkdownSafe, type Article as ArticleFile } from '@avp/content';
import { tenant, tenantsDir } from './tenant.ts';

export interface Article {
  slug: string;
  lang: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified: string;
  metaTitle?: string;
  takeaways: string[];
  faq: ArticleFile['faq'];
  sources: ArticleFile['sources'];
  html: string;
}

/** Render markdown. The page template owns the single <h1>, so any "# Heading" in content becomes an <h2>. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return html.replace(/<(\/?)h1(?=[\s>])/g, '<$1h2');
}

/** Articles for one language live in tenants/<id>/articles/<lang>/*.md, newest first. */
export function loadArticles(lang: string): Article[] {
  const dir = join(tenantsDir, tenant.id, 'articles', lang);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const file = join(dir, f);
      let a: ArticleFile;
      try {
        a = parseArticle(readFileSync(file, 'utf8'));
      } catch (e) {
        throw new Error(`${file}: ${(e as Error).message}`);
      }
      // Article text is escaped and filtered by renderMarkdownSafe: raw HTML, scripts and images never reach the page.
      return { ...a, lang, html: renderMarkdownSafe(a.body) };
    })
    .sort((a, b) => b.datePublished.localeCompare(a.datePublished));
}

export function allArticles(): Article[] {
  return tenant.languages.supported.flatMap((lang) => loadArticles(lang));
}
