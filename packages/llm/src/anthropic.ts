import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { UsageMeter } from './meter.ts';
import { LlmOutputError, LlmRefusalError, type Llm, type ResearchRequest, type ResearchResult, type ResearchSource, type StructuredRequest } from './types.ts';

export interface AnthropicLlmOptions {
  /** Defaults to the ANTHROPIC_API_KEY environment variable. */
  apiKey?: string;
  models: { author: string; judge: string };
  meter: UsageMeter;
  /** For tests. */
  client?: Anthropic;
  fetch?: typeof fetch;
}

/** Calls Claude through the official SDK. */
export class AnthropicLlm implements Llm {
  readonly meter: UsageMeter;
  private client: Anthropic;
  private models: { author: string; judge: string };

  constructor(opts: AnthropicLlmOptions) {
    this.meter = opts.meter;
    this.models = opts.models;
    // The SDK retries connection errors, 408, 409, 429 and 5xx with backoff. Three retries rides out short outages.
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 3, timeout: 5 * 60_000, fetch: opts.fetch });
  }

  private model(role: 'author' | 'judge' = 'author') {
    return this.models[role];
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    this.meter.assertWithinBudget();
    const model = this.model(req.role);
    // create() rather than parse(): parse() throws on truncated output before the response can be inspected,
    // which would lose the cost record. Here usage is recorded first, then the output is checked.
    const res = await this.client.messages.create({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      output_config: { effort: req.effort ?? 'medium', format: zodOutputFormat(req.schema) },
    });
    await this.meter.record(req.label, 'anthropic', model, res.usage);
    if (res.stop_reason === 'refusal') throw new LlmRefusalError(res.stop_details?.category ?? null, req.label);
    if (res.stop_reason === 'max_tokens') throw new LlmOutputError(`"${req.label}" ran out of room (max_tokens ${req.maxTokens ?? 16000}) before finishing`);
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmOutputError(`"${req.label}" did not return valid JSON`);
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new LlmOutputError(`"${req.label}" did not return the expected shape (${issue?.path.join('.') || 'root'}: ${issue?.message})`);
    }
    return parsed.data;
  }

  async research(req: ResearchRequest): Promise<ResearchResult> {
    const model = this.model(req.role);
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: req.prompt }];
    const sources = new Map<string, ResearchSource>();
    let text = '';
    let searches = 0;

    // A long search turn can pause. Resume it by sending the paused turn back, a few times at most.
    for (let turn = 0; turn < 6; turn++) {
      this.meter.assertWithinBudget();
      const res = await this.client.messages.create({
        model,
        max_tokens: 16000,
        system: req.system,
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: req.maxSearches ?? 5,
            ...(req.allowedDomains?.length ? { allowed_domains: req.allowedDomains } : {}),
          },
        ],
        messages,
      });
      await this.meter.record(`${req.label}`, 'anthropic', model, res.usage);
      searches += res.usage.server_tool_use?.web_search_requests ?? 0;
      if (res.stop_reason === 'refusal') throw new LlmRefusalError(res.stop_details?.category ?? null, req.label);

      for (const block of res.content) {
        if (block.type === 'text') {
          text += block.text;
          for (const c of block.citations ?? []) {
            if (c.type === 'web_search_result_location' && c.url && !sources.has(c.url)) sources.set(c.url, { url: c.url, title: c.title ?? c.url });
          }
        } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r.type === 'web_search_result' && !sources.has(r.url)) sources.set(r.url, { url: r.url, title: r.title, pageAge: r.page_age ?? undefined });
          }
        }
      }
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
    return { text: text.trim(), sources: [...sources.values()], searches };
  }
}
