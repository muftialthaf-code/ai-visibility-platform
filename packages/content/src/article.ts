import matter from 'gray-matter';
import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const sourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'Use an http(s) link'),
  /** When the source was published or last updated (YYYY-MM-DD). */
  date: dateString.optional(),
});

export const faqItemSchema = z.object({ question: z.string().min(1), answer: z.string().min(1) });

/** An article as stored in tenants/<id>/articles/<lang>/<slug>.md: frontmatter plus a Markdown body. */
export const articleSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens'),
  datePublished: dateString,
  dateModified: dateString,
  /** Optional shorter title for search results. Falls back to title. */
  metaTitle: z.string().optional(),
  takeaways: z.array(z.string().min(1)).default([]),
  faq: z.array(faqItemSchema).default([]),
  sources: z.array(sourceSchema).default([]),
});

export type ArticleMeta = z.infer<typeof articleSchema>;
export type Source = z.infer<typeof sourceSchema>;

export interface Article extends ArticleMeta {
  body: string;
}

/** YAML turns bare dates into Date objects, including inside lists. Turn them back into YYYY-MM-DD strings. */
const toDay = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(toDay);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toDay(x)]));
  return v;
};

/** Parse an article file. Throws with a readable message when the frontmatter is wrong. */
export function parseArticle(markdown: string): Article {
  const { data, content } = matter(markdown);
  const clean = toDay(data) as Record<string, unknown>;
  const parsed = articleSchema.safeParse({ ...clean, dateModified: clean.dateModified ?? clean.datePublished });
  if (!parsed.success) {
    const i = parsed.error.issues[0]!;
    throw new Error(`Article frontmatter is invalid: ${i.path.join('.') || 'frontmatter'}: ${i.message}`);
  }
  return { ...parsed.data, body: content.replace(/^\n+/, '').trimEnd() + '\n' };
}

/** Write an article file with a stable key order so diffs show only real changes. */
export function serializeArticle(a: Article): string {
  const { body, ...meta } = a;
  const ordered: Record<string, unknown> = {
    title: meta.title,
    description: meta.description,
    slug: meta.slug,
    datePublished: meta.datePublished,
    dateModified: meta.dateModified,
  };
  if (meta.metaTitle) ordered.metaTitle = meta.metaTitle;
  if (meta.takeaways.length) ordered.takeaways = meta.takeaways;
  if (meta.faq.length) ordered.faq = meta.faq;
  if (meta.sources.length) ordered.sources = meta.sources;
  return matter.stringify(body.trimEnd() + '\n', ordered);
}

export const articlePath = (tenantId: string, lang: string, slug: string) => `tenants/${tenantId}/articles/${lang}/${slug}.md`;
