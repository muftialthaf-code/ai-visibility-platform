import { z } from 'zod';
import { businessBrief, languageName } from '../brief.ts';
import type { AgentContext, Fact, ResearchPack, TopicChoice } from '../types.ts';

const extraction = z.object({
  facts: z
    .array(
      z.object({
        claim: z.string().min(8),
        sourceUrl: z.string().url(),
        /** A short passage copied from the notes that backs the claim. */
        quote: z.string().min(8),
      }),
    )
    .max(30),
  sourceDates: z.array(z.object({ url: z.string().url(), date: z.string().nullable() })),
});

const isoDay = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);

/**
 * Search the web for what is known about a topic and reduce it to facts, each tied to a real page the search
 * returned. A fact that cites a page the search did not return is dropped, so the writer cannot be handed an
 * invented source. A source with no date is dated by the day it was read and marked "(accessed)".
 */
export async function researchTopic(ctx: AgentContext, topic: TopicChoice): Promise<ResearchPack> {
  const t = ctx.tenant;
  const lang = t.languages.default;
  const res = await ctx.llm.research({
    label: 'research:topic',
    role: 'author',
    maxSearches: 6,
    system:
      'You are a careful researcher. Use web search and report only what the pages say. Give figures exactly as published, say where each came from, and say when a page is old or when sources disagree.',
    prompt: [
      businessBrief(t, lang),
      '',
      `Topic: ${topic.topic}`,
      `Question to answer: ${topic.question}`,
      `Research what is true and current about this. Prefer official, primary and recent sources. Write the notes in ${languageName(lang)}. Quote key passages.`,
    ].join('\n'),
  });
  const urls = new Set(res.sources.map((s) => s.url));
  const today = ctx.now().toISOString().slice(0, 10);

  const out = await ctx.llm.structured({
    label: 'research:extract',
    role: 'judge',
    system: 'You extract checkable facts from research notes. Every fact needs the URL of the page it came from, chosen only from the list given, and a short passage from the notes that backs it.',
    prompt: [
      `Pages the search returned:\n${res.sources.map((s) => `- ${s.url} | ${s.title}${s.pageAge ? ` | ${s.pageAge}` : ''}`).join('\n')}`,
      `Notes:\n${res.text}`,
      'List the facts that matter for answering the question. For each page, give its publication date as YYYY-MM-DD if the notes or page age make it clear, otherwise null.',
    ].join('\n\n'),
    schema: extraction,
    maxTokens: 5000,
    effort: 'low',
  });

  const facts: Fact[] = out.facts.filter((f) => urls.has(f.sourceUrl));
  const dropped = out.facts.length - facts.length;
  if (dropped > 0) ctx.log(`Dropped ${dropped} fact(s) that cited a page the search did not return.`);
  const dates = new Map(out.sourceDates.map((d) => [d.url, isoDay(d.date)]));
  const used = new Set(facts.map((f) => f.sourceUrl));
  const sources = res.sources
    .filter((s) => used.has(s.url))
    .map((s) => {
      const date = dates.get(s.url);
      return date ? { title: s.title, url: s.url, date } : { title: `${s.title} (accessed)`, url: s.url, date: today };
    });
  return { notes: res.text, facts, sources };
}
