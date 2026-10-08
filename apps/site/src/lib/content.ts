import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { tenant, tenantsDir } from './tenant.ts';

export interface Article {
  slug: string;
  lang: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified: string;
  html: string;
}

/** Render markdown. The page template owns the single <h1>, so any "# Heading" in content becomes an <h2>. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return html.replace(/<(\/?)h1(?=[\s>])/g, '<$1h2');
}

function isoDate(value: unknown, file: string, field: string): string {
  const d = new Date(value as string);
  if (!value || Number.isNaN(d.getTime())) throw new Error(`${file}: frontmatter "${field}" must be a valid date`);
  return d.toISOString().slice(0, 10);
}

/** Articles for one language live in tenants/<id>/articles/<lang>/*.md, newest first. */
export function loadArticles(lang: string): Article[] {
  const dir = join(tenantsDir, tenant.id, 'articles', lang);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const file = join(dir, f);
      const { data, content } = matter(readFileSync(file, 'utf8'));
      for (const field of ['title', 'description', 'slug']) {
        if (!data[field] || typeof data[field] !== 'string') throw new Error(`${file}: frontmatter "${field}" is required`);
      }
      return {
        slug: data.slug as string,
        lang,
        title: data.title as string,
        description: data.description as string,
        datePublished: isoDate(data.datePublished, file, 'datePublished'),
        dateModified: isoDate(data.dateModified ?? data.datePublished, file, 'dateModified'),
        html: renderMarkdown(content),
      };
    })
    .sort((a, b) => b.datePublished.localeCompare(a.datePublished));
}

export function allArticles(): Article[] {
  return tenant.languages.supported.flatMap((lang) => loadArticles(lang));
}
