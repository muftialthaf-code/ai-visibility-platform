import { z } from 'zod';
import { languageName, voiceBrief } from '../brief.ts';
import type { AgentContext, CheckResult, Draft, ResearchPack } from '../types.ts';
import type { Article } from '@avp/content';

const editorial = z.object({
  voice: z.object({ ok: z.boolean(), reason: z.string() }),
  defamation: z.object({ ok: z.boolean(), reason: z.string() }),
  compliance: z.object({ ok: z.boolean(), reason: z.string() }),
});

const verification = z.object({
  results: z.array(z.object({ index: z.number().int(), supported: z.boolean(), reason: z.string() })),
});

const articleText = (a: Article) => `# ${a.title}\n\n${a.body}\n\nFAQ:\n${a.faq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join('\n')}`;

/**
 * Two review calls to a cheaper model: one for voice, defamation and compliance, one that checks each claim
 * against the passage it was drawn from. A judge failing to answer counts as a failed check, not a pass.
 */
export async function judgeArticle(ctx: AgentContext, input: { article: Article; lang: string; claims: Draft['claims']; pack: ResearchPack }): Promise<CheckResult[]> {
  const { article, lang, claims, pack } = input;
  const out: CheckResult[] = [];

  try {
    const e = await ctx.llm.structured({
      label: `judge:editorial:${lang}`,
      role: 'judge',
      system:
        'You are a strict editor. Judge the article only on what is asked. Be specific in your reasons. Pass an article unless there is a real problem.',
      prompt: [
        `Language: ${languageName(lang)}`,
        `House voice:\n${voiceBrief(ctx.tenant, lang)}`,
        'Questions:\n1. voice: does the article match the house voice and avoid the things the voice forbids?\n2. defamation: does it say anything damaging or unsupported about a named person, company or product?\n3. compliance: does it promise results, give legal, medical or financial advice as certain, or make any claim the business must never make?',
        `Article:\n${articleText(article)}`,
      ].join('\n\n'),
      schema: editorial,
      maxTokens: 1500,
      effort: 'low',
    });
    out.push({ name: 'voice', label: 'Matches the house voice', passed: e.voice.ok, reason: e.voice.ok ? undefined : e.voice.reason, severity: 'advisory' });
    out.push({ name: 'defamation', label: 'Nothing damaging about named people or companies', passed: e.defamation.ok, reason: e.defamation.ok ? undefined : e.defamation.reason, severity: 'blocker' });
    out.push({ name: 'compliance', label: 'No promises or restricted claims', passed: e.compliance.ok, reason: e.compliance.ok ? undefined : e.compliance.reason, severity: 'blocker' });
  } catch (err) {
    if (isBudget(err)) throw err;
    out.push({ name: 'editorial', label: 'Editorial review', passed: false, reason: `The reviewer could not run: ${msg(err)}`, severity: 'blocker' });
  }

  try {
    const passages = new Map(pack.facts.map((f) => [f.sourceUrl, [] as string[]]));
    for (const f of pack.facts) passages.get(f.sourceUrl)!.push(f.quote);
    const v = await ctx.llm.structured({
      label: `judge:claims:${lang}`,
      role: 'judge',
      system:
        'You check claims against evidence. A claim is supported only if the evidence passages for its source state it or clearly imply it. A claim with a different number, date or scope than the evidence is not supported.',
      prompt: claims
        .map((c, i) => `[${i}] CLAIM: ${c.text}\nSOURCE: ${c.sourceUrl}\nEVIDENCE: ${(passages.get(c.sourceUrl) ?? []).join(' | ') || '(none)'}`)
        .join('\n\n') + '\n\nReturn one result per claim index.',
      schema: verification,
      maxTokens: 3000,
      effort: 'low',
    });
    const byIndex = new Map(v.results.map((r) => [r.index, r]));
    const bad = claims.map((c, i) => ({ c, r: byIndex.get(i) })).filter((x) => !x.r || !x.r.supported);
    out.push({
      name: 'claims-verified',
      label: 'Every claim is backed by its source',
      passed: bad.length === 0,
      reason: bad.length ? bad.slice(0, 3).map((x) => `"${x.c.text.slice(0, 80)}": ${x.r?.reason ?? 'not checked'}`).join(' ') : undefined,
      severity: 'blocker',
    });
  } catch (err) {
    if (isBudget(err)) throw err;
    out.push({ name: 'claims-verified', label: 'Every claim is backed by its source', passed: false, reason: `The claim check could not run: ${msg(err)}`, severity: 'blocker' });
  }
  return out;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isBudget = (e: unknown) => e instanceof Error && e.name === 'BudgetExceededError';
