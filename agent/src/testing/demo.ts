import { MockLlm, UsageMeter } from '@avp/llm';

/**
 * A scripted model for tests, dry runs and the local end-to-end setup. Everything it writes is plain filler
 * that says it is demo content; it exists to exercise the pipeline, never to be published.
 */

export const DEMO_SOURCES = [
  { url: 'https://example.org/guide-one', title: 'Demo guide one', pageAge: '2 days ago' },
  { url: 'https://example.org/guide-two', title: 'Demo guide two', pageAge: '2026-09-01' },
  { url: 'https://example.org/guide-three', title: 'Demo guide three' },
];

const FACTS = [
  { claim: 'Demo claim one says the process has clear steps.', sourceUrl: DEMO_SOURCES[0]!.url, quote: 'The process has clear steps that any reader can follow.' },
  { claim: 'Demo claim two says costs depend on the plan chosen.', sourceUrl: DEMO_SOURCES[1]!.url, quote: 'Costs depend on the plan that a customer chooses.' },
  { claim: 'Demo claim three says support is available every day.', sourceUrl: DEMO_SOURCES[2]!.url, quote: 'Support is available every day of the week.' },
];

const EN_WORDS = ['plain', 'simple', 'short', 'clear', 'steady', 'calm', 'basic', 'quick'];
const EN_NOUNS = ['step', 'note', 'point', 'part', 'idea', 'check', 'tip', 'item'];
const AR_SENTENCES = [
  'هذا نص تجريبي للاختبار فقط وليس للنشر.',
  'يوضح هذا النص فكرة بسيطة بكلمات قصيرة وواضحة.',
  'الخطوة الأولى سهلة ويمكن لأي شخص أن يفهمها.',
  'نكتب هذه الجملة لملء المساحة المطلوبة في المقال.',
  'يساعد هذا الجزء القارئ على فهم الموضوع بسرعة.',
];

function filler(words: number, seed: string, lang: string): string {
  const out: string[] = [];
  let count = 0;
  let i = 0;
  const salt = [...seed].reduce((n, c) => n + c.charCodeAt(0), 0);
  while (count < words) {
    const s =
      lang === 'ar'
        ? `${AR_SENTENCES[(i + salt) % AR_SENTENCES.length]} (${'ابتكار' + 'ي'.repeat(i % 3)}).`
        : `The ${EN_WORDS[(i + salt) % EN_WORDS.length]} ${EN_NOUNS[(i * 3 + salt) % EN_NOUNS.length]} for ${seed} is ${EN_WORDS[(i * 5 + salt) % EN_WORDS.length]} and ${EN_NOUNS[(i + 2 * salt) % EN_NOUNS.length]} ${EN_WORDS[(i * 7) % EN_WORDS.length]}.`;
    out.push(s);
    count += s.split(/\s+/).length;
    i++;
  }
  return out.join(' ');
}

export interface DemoOptions {
  /** Body length in words. Keep it inside the tenant's articleWords range. */
  words?: number;
  topics?: string[];
  /** Make the claim check fail the first N times it is asked (to test the revision step). */
  failClaimsTimes?: number;
  /** Make research return no usable facts. */
  noFacts?: boolean;
  meter?: UsageMeter;
}

export function demoLlm(opts: DemoOptions = {}): MockLlm {
  const words = opts.words ?? 160;
  const topics = opts.topics ?? ['How do I get started with the demo service?', 'What does the demo service cost?'];
  let claimCalls = 0;
  return new MockLlm(
    {
      research: {
        'topics:research': () => ({ text: 'Demo notes about common questions.', sources: DEMO_SOURCES.slice(0, 1), searches: 1 }),
        'research:topic': () => ({
          text: FACTS.map((f) => f.quote).join(' '),
          sources: DEMO_SOURCES,
          searches: 2,
        }),
      },
      structured: {
        'topics:extract': () => ({ topics: topics.map((topic, i) => ({ topic, question: topic, persona: 'a new customer', intent: 'learn', fit: 5 - i, demand: 4, urgency: 3 })) }),
        'research:extract': () => ({
          facts: opts.noFacts ? [] : FACTS,
          sourceDates: [
            { url: DEMO_SOURCES[0]!.url, date: '2026-09-20' },
            { url: DEMO_SOURCES[1]!.url, date: '2026-09-01' },
            { url: DEMO_SOURCES[2]!.url, date: null },
          ],
        }),
        write: (req) => {
          const lang = req.label.split(':')[1] ?? 'en';
          const slug = /Use exactly this slug: (\S+)/.exec(req.prompt)?.[1] ?? 'demo-article';
          const topic = /Topic: (.+)/.exec(req.prompt)?.[1] ?? 'demo topic';
          const seed = topic.replace(/[^a-z ]/gi, '').toLowerCase().split(' ').slice(0, 3).join(' ');
          const ar = lang === 'ar';
          const body = ar
            ? [
                'هذا مقال تجريبي لاختبار النظام فقط. يجيب هذا الفقرة الأولى عن السؤال بكلمات بسيطة وواضحة للقارئ.',
                '',
                '## ما هي الخطوات الأولى؟',
                filler(Math.floor(words / 3), seed, lang),
                '',
                '- نقطة أولى للاختبار',
                '- نقطة ثانية للاختبار',
                '',
                '## كم تبلغ التكلفة؟',
                filler(Math.floor(words / 3), seed + 'x', lang),
                '',
                'اقرأ المزيد في [خدماتنا](/ar/services/).',
                '',
                filler(Math.floor(words / 3), seed + 'y', lang),
              ].join('\n')
            : [
                `This is demo text made to test the system. It is not real advice. The short answer for ${seed} is a plain list of clear steps.`,
                '',
                '## What are the first steps?',
                filler(Math.floor(words / 3), seed, lang),
                '',
                '- A first demo point',
                '- A second demo point',
                '',
                '## How much does it cost?',
                filler(Math.floor(words / 3), seed + 'x', lang),
                '',
                'Read more about [our services](/services/).',
                '',
                filler(Math.floor(words / 3), seed + 'y', lang),
              ].join('\n');
          return {
            title: ar ? 'مقال تجريبي للاختبار' : `Demo: ${topic.slice(0, 40)}`,
            description: ar ? 'هذا وصف تجريبي للمقال ويستخدم فقط لاختبار النظام قبل النشر الحقيقي.' : 'This is a demo description used only to test the system before anything real is published.',
            slug,
            takeaways: ar ? ['نقطة تجريبية أولى', 'نقطة تجريبية ثانية', 'نقطة تجريبية ثالثة'] : ['Demo takeaway one', 'Demo takeaway two', 'Demo takeaway three'],
            body,
            faq: [1, 2, 3].map((n) => ({ question: ar ? `سؤال تجريبي ${n}؟` : `Demo question ${n}?`, answer: ar ? 'هذه إجابة تجريبية قصيرة للاختبار فقط.' : 'This is a short demo answer used for testing only.' })),
            claims: FACTS.map((f) => ({ text: f.claim, sourceUrl: f.sourceUrl })),
          };
        },
        'judge:editorial': () => ({ voice: { ok: true, reason: '' }, defamation: { ok: true, reason: '' }, compliance: { ok: true, reason: '' } }),
        'judge:claims': (req) => {
          claimCalls++;
          const n = (req.prompt.match(/^\[\d+\]/gm) ?? []).length;
          const fail = claimCalls <= (opts.failClaimsTimes ?? 0);
          return { results: Array.from({ length: n }, (_, index) => ({ index, supported: !fail || index > 0, reason: fail && index === 0 ? 'The figure does not match the source.' : '' })) };
        },
      },
    },
    opts.meter,
  );
}
