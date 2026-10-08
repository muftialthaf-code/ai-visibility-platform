import type { Llm } from '@avp/llm';

export interface ProviderAnswer {
  answer: string;
  citations: string[];
  costUsd: number;
}

/** An AI assistant the tracker can ask a question. */
export interface AnswerProvider {
  id: string;
  label: string;
  ask(prompt: string, opts: { language: string }): Promise<ProviderAnswer>;
}

const SYSTEM = 'Answer the question the way you would for a person asking an AI assistant. Search the web when it helps. Name specific businesses and sources where relevant.';
const langHint = (language: string) => (language.startsWith('ar') ? ' Answer in Arabic.' : '');

/** Claude with web search. Cost comes from the shared usage meter. */
export function claudeProvider(llm: Llm): AnswerProvider {
  return {
    id: 'claude',
    label: 'Claude',
    async ask(prompt, { language }) {
      const before = llm.meter.costUsd;
      const r = await llm.research({ label: 'tracker:claude', role: 'judge', system: SYSTEM, prompt: prompt + langHint(language), maxSearches: 3 });
      return { answer: r.text, citations: r.sources.map((s) => s.url), costUsd: llm.meter.costUsd - before };
    },
  };
}

interface FetchOpts {
  apiKey: string;
  fetch?: typeof fetch;
  /** Price assumed for one request, because the API does not report a price. Override with an environment variable. */
  usdPerRequest: number;
}

async function post(f: typeof fetch, url: string, apiKey: string, body: unknown, who: string) {
  const res = await f(url, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${who} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<any>;
}

/** Perplexity's Sonar API: returns an answer with a list of citation URLs. */
export function perplexityProvider(o: FetchOpts & { model?: string }): AnswerProvider {
  return {
    id: 'perplexity',
    label: 'Perplexity',
    async ask(prompt, { language }) {
      const json = await post(o.fetch ?? fetch, 'https://api.perplexity.ai/chat/completions', o.apiKey, { model: o.model ?? 'sonar', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt + langHint(language) }] }, 'Perplexity');
      const answer: string = json.choices?.[0]?.message?.content ?? '';
      const citations: string[] = Array.isArray(json.citations) ? json.citations.filter((c: unknown): c is string => typeof c === 'string') : (json.search_results ?? []).map((r: any) => r.url).filter(Boolean);
      if (!answer) throw new Error('Perplexity returned an empty answer');
      return { answer, citations, costUsd: o.usdPerRequest };
    },
  };
}

/** OpenAI's Responses API with the web search tool. The model name is configurable because it changes. */
export function openaiProvider(o: FetchOpts & { model: string }): AnswerProvider {
  return {
    id: 'openai',
    label: 'ChatGPT',
    async ask(prompt, { language }) {
      const json = await post(o.fetch ?? fetch, 'https://api.openai.com/v1/responses', o.apiKey, { model: o.model, tools: [{ type: 'web_search' }], instructions: SYSTEM, input: prompt + langHint(language) }, 'OpenAI');
      let answer = '';
      const citations = new Set<string>();
      for (const item of json.output ?? []) {
        if (item.type !== 'message') continue;
        for (const part of item.content ?? []) {
          if (part.type !== 'output_text') continue;
          answer += part.text ?? '';
          for (const a of part.annotations ?? []) if (a.type === 'url_citation' && a.url) citations.add(a.url);
        }
      }
      if (!answer) throw new Error('OpenAI returned an empty answer');
      return { answer, citations: [...citations], costUsd: o.usdPerRequest };
    },
  };
}
