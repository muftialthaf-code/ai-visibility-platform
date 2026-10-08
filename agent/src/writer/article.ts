import { z } from 'zod';
import type { Article } from '@avp/content';
import { articleLanguages, businessBrief, languageName, voiceBrief } from '../brief.ts';
import type { AgentContext, Draft, ResearchPack, TopicChoice, WrittenArticle } from '../types.ts';

const draftSchema = z.object({
  title: z.string().min(5),
  metaTitle: z.string().optional(),
  description: z.string().min(20),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  takeaways: z.array(z.string().min(3)).min(3).max(6),
  body: z.string().min(200),
  faq: z.array(z.object({ question: z.string().min(3), answer: z.string().min(10) })).min(3).max(5),
  claims: z.array(z.object({ text: z.string().min(5), sourceUrl: z.string().url() })).min(1),
});

export interface WriteOptions {
  lang: string;
  /** Use this slug (so every language shares one URL path). */
  slug?: string;
  /** An earlier attempt and what was wrong with it, for a revision. */
  previous?: Draft;
  feedback?: string[];
  /** Pages to link to inside the article, as { label, path }. */
  links: Array<{ label: string; path: string }>;
}

const SYSTEM = [
  'You write articles for a business website. Readers and AI assistants should be able to lift a clear, correct answer from the page.',
  'Rules:',
  '- Use only the facts supplied. Never add a number, date, name or claim that is not in them.',
  '- Put the direct answer in the first paragraph (2 to 3 sentences), then explain.',
  '- Use H2/H3 headings; at least two must be phrased as questions. Include a list or table. Do not use H1 or raw HTML.',
  '- Write in your own words. Do not copy phrases from the sources.',
  '- Every factual statement in the article goes in `claims`, with the URL of the one source that supports it.',
  '- Never promise outcomes or make guarantees.',
].join('\n');

export async function writeArticle(ctx: AgentContext, topic: TopicChoice, pack: ResearchPack, opts: WriteOptions): Promise<WrittenArticle> {
  const t = ctx.tenant;
  const { min, max } = t.agent.articleWords;
  const prefix = opts.lang === t.languages.default ? '' : `/${opts.lang}`;
  const links = opts.links.map((l) => `- ${l.label}: ${prefix}${l.path}`).join('\n');
  const prompt = [
    businessBrief(t, opts.lang),
    voiceBrief(t, opts.lang),
    `Topic: ${topic.topic}\nQuestion the article answers: ${topic.question}${topic.persona ? `\nWritten for: ${topic.persona}` : ''}`,
    `Facts you may use (each with its source URL):\n${pack.facts.map((f, i) => `${i + 1}. ${f.claim}\n   source: ${f.sourceUrl}\n   backing passage: ${f.quote}`).join('\n')}`,
    `Link to at least one of these pages inside the article, using the path exactly:\n${links || '(none available; skip internal links)'}`,
    `Write the article in ${languageName(opts.lang)}, written natively for ${languageName(opts.lang)} readers, ${min} to ${max} words in the body.`,
    opts.slug ? `Use exactly this slug: ${opts.slug}` : 'Choose a short lowercase slug (letters, numbers, hyphens; Latin letters only).',
    `Also give: a title (under 70 characters), a meta description (50 to 170 characters), 3 to 6 key takeaways, and 3 to 5 FAQ items whose answers are 40 to 60 words.`,
    opts.previous && opts.feedback?.length
      ? `Your earlier attempt was held back. Rewrite it and fix every point below, keeping what was fine.\nPoints to fix:\n${opts.feedback.map((f) => `- ${f}`).join('\n')}\n\nEarlier attempt:\n${JSON.stringify(opts.previous)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const draft = await ctx.llm.structured({
    label: `write:${opts.lang}`,
    role: 'author',
    system: SYSTEM,
    prompt,
    schema: draftSchema,
    maxTokens: 12000,
    effort: 'medium',
  });
  if (opts.slug) draft.slug = opts.slug;

  const today = ctx.now().toISOString().slice(0, 10);
  const cited = new Set(draft.claims.map((c) => c.sourceUrl));
  const article: Article = {
    title: draft.title.trim(),
    description: draft.description.trim(),
    slug: draft.slug,
    datePublished: today,
    dateModified: today,
    ...(draft.metaTitle ? { metaTitle: draft.metaTitle.trim() } : {}),
    takeaways: draft.takeaways,
    faq: draft.faq,
    sources: pack.sources.filter((s) => cited.has(s.url)),
    body: draft.body.trim() + '\n',
  };
  return { lang: opts.lang, article, draft };
}

export { articleLanguages };
