import { z } from 'zod';
import { addTopics, nextTopic, recentRejections, listTopics, type Topic } from '@avp/db';
import { titleSimilarity } from '../checks/deterministic.ts';
import { businessBrief, languageName } from '../brief.ts';
import { existingArticles } from '../site-content.ts';
import type { AgentContext } from '../types.ts';

const topicList = z.object({
  topics: z
    .array(
      z.object({
        topic: z.string().min(8).max(140),
        question: z.string().min(8).max(240),
        persona: z.string().optional(),
        intent: z.enum(['learn', 'compare', 'decide', 'solve']).optional(),
        /** How well the topic fits this business, 1 to 5. */
        fit: z.number().min(1).max(5),
        /** How many people appear to ask this, 1 to 5. */
        demand: z.number().min(1).max(5),
        /** How time-sensitive the topic is, 1 to 5. */
        urgency: z.number().min(1).max(5),
      }),
    )
    .max(25),
});

/** Priority 0 to 100. Fit counts most, then demand, then timeliness. */
export const topicPriority = (t: { fit: number; demand: number; urgency: number }) => Math.round(((t.fit * 5 + t.demand * 3 + t.urgency * 2) / 50) * 100);

/**
 * Find article topics by searching the web for the questions this business's customers ask, then saving the
 * ones that are new to the backlog. Topics that repeat an existing article or an earlier rejection are dropped.
 */
export async function discoverTopics(ctx: AgentContext): Promise<number> {
  const t = ctx.tenant;
  const lang = t.languages.default;
  const [existing, rejected, backlog] = await Promise.all([
    existingArticles(ctx.store, t.id, lang),
    recentRejections(ctx.db, t.id),
    listTopics(ctx.db, { tenantId: t.id, status: ['suggested', 'approved', 'used'], limit: 200 }),
  ]);
  const known = [...existing.map((a) => a.title), ...backlog.map((b) => b.topic)];

  const notes = await ctx.llm.research({
    label: 'topics:research',
    role: 'author',
    maxSearches: 5,
    system: 'You research what people ask about a subject. Report real questions and recent developments you find in search results. Do not invent data.',
    prompt: [
      businessBrief(t, lang),
      '',
      `Find questions that people in this business's audience ask (including to AI assistants) and recent news that matters to them. Write notes in ${languageName(lang)}.`,
      known.length ? `Already covered, do not repeat:\n- ${known.slice(0, 40).join('\n- ')}` : '',
    ].join('\n'),
  });

  const out = await ctx.llm.structured({
    label: 'topics:extract',
    role: 'judge',
    system: 'You turn research notes into a list of article topics for a business blog. Each topic must be a specific question a customer would ask and the business can honestly answer.',
    prompt: [
      businessBrief(t, lang),
      rejected.length ? `Topics a reviewer rejected earlier (avoid similar):\n${rejected.map((r) => `- ${r.topic}${r.reason ? ` (${r.reason})` : ''}`).join('\n')}` : '',
      `Research notes:\n${notes.text}`,
      'Give up to 15 topics. Score fit, demand and urgency from 1 to 5.',
    ].join('\n\n'),
    schema: topicList,
    maxTokens: 4000,
    effort: 'low',
  });

  const fresh = out.topics.filter((c) => ![...known, ...rejected.map((r) => r.topic)].some((k) => titleSimilarity(c.topic, k) >= 0.8));
  const sources = notes.sources.slice(0, 5).map((s) => ({ url: s.url, title: s.title }));
  return addTopics(
    ctx.db,
    t.id,
    fresh.map((c) => ({ topic: c.topic, question: c.question, persona: c.persona, intent: c.intent, sources, priority: topicPriority(c) })),
  );
}

/** The topic to write next: the best one in the backlog, finding new ones first if it is empty. */
export async function pickTopic(ctx: AgentContext): Promise<Topic | null> {
  const first = await nextTopic(ctx.db, ctx.tenant.id);
  if (first) return first;
  ctx.log('The topic backlog is empty. Searching for new topics.');
  await discoverTopics(ctx);
  return nextTopic(ctx.db, ctx.tenant.id);
}
