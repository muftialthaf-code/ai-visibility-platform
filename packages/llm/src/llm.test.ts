import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicLlm, BudgetExceededError, LlmOutputError, LlmRefusalError, MockLlm, UsageMeter, costOf, priceFor } from './index.ts';

describe('pricing', () => {
  it('prices tokens, cache reads and web searches', () => {
    // 1M in at $4 + 0.5M out at $20 = $14, plus 3 searches at $0.01
    expect(costOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 500_000, server_tool_use: { web_search_requests: 3 } })).toBeCloseTo(14.03, 5);
    expect(costOf('claude-opus-5-5', { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2, 5);
    expect(costOf('claude-opus-5-5', { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(5, 5);
  });
  it('prices an unknown model at the highest rate, so caps stop early rather than late', () => {
    expect(priceFor('claude-some-future-model').output).toBe(50);
  });
  it('lets pricing be overridden', () => {
    expect(costOf('x', { output_tokens: 1_000_000 }, { prices: { x: { input: 0, output: 1, cacheRead: 0 } } })).toBe(1);
  });
});

describe('UsageMeter', () => {
  it('adds up costs and stops when the budget is used', async () => {
    const seen: string[] = [];
    const m = new UsageMeter({ limitUsd: 1, onRecord: (r) => void seen.push(r.label) });
    await m.record('a', 'anthropic', 'claude-opus-5-5', { input_tokens: 100_000, output_tokens: 10_000 });
    expect(m.costUsd).toBeCloseTo(0.6, 5);
    m.assertWithinBudget();
    await m.record('b', 'anthropic', 'claude-opus-5-5', { input_tokens: 100_000, output_tokens: 10_000 });
    expect(() => m.assertWithinBudget()).toThrow(BudgetExceededError);
    expect(seen).toEqual(['a', 'b']);
  });
  it('has no limit when none is set', async () => {
    const m = new UsageMeter();
    await m.record('a', 'x', 'claude-fable-5-1', { output_tokens: 10_000_000 });
    expect(() => m.assertWithinBudget()).not.toThrow();
  });
});

/** A fetch that answers like the Messages API and records the requests it saw. */
function fakeApi(responses: unknown[]) {
  const requests: any[] = [];
  const fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    const body = responses.shift();
    if (!body) throw new Error('unexpected extra request');
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const message = (over: Record<string, unknown>) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: 'text', text: '' }], ...over,
});

const Answer = z.object({ answer: z.string(), n: z.number() });

describe('AnthropicLlm.structured', () => {
  it('sends the schema and effort, parses the answer and records the cost', async () => {
    const api = fakeApi([message({ content: [{ type: 'text', text: '{"answer":"hi","n":3}' }] })]);
    const llm = new AnthropicLlm({ apiKey: 'k', models: { author: 'claude-opus-5-5', judge: 'claude-sonnet-5-5' }, meter: new UsageMeter(), fetch: api.fetch });
    const out = await llm.structured({ label: 'test', system: 'sys', prompt: 'p', schema: Answer });
    expect(out).toEqual({ answer: 'hi', n: 3 });
    const sent = api.requests[0];
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.output_config.effort).toBe('medium');
    expect(sent.output_config.format.type).toBe('json_schema');
    expect(sent.temperature).toBeUndefined();
    expect(llm.meter.records[0]).toMatchObject({ label: 'test', model: 'claude-opus-5-5', tokensIn: 1000, tokensOut: 500 });
    expect(llm.meter.costUsd).toBeCloseTo((1000 * 4 + 500 * 20) / 1e6, 8);
  });

  it('uses the judge model for judge calls', async () => {
    const api = fakeApi([message({ model: 'claude-sonnet-5-5', content: [{ type: 'text', text: '{"answer":"x","n":1}' }] })]);
    const llm = new AnthropicLlm({ apiKey: 'k', models: { author: 'claude-opus-5-5', judge: 'claude-sonnet-5-5' }, meter: new UsageMeter(), fetch: api.fetch });
    await llm.structured({ label: 'j', system: 's', prompt: 'p', schema: Answer, role: 'judge', effort: 'low' });
    expect(api.requests[0].model).toBe('claude-sonnet-5-5');
    expect(api.requests[0].output_config.effort).toBe('low');
  });

  it('turns a refusal, a truncated answer and unusable output into clear errors, and still counts the cost', async () => {
    const mk = (r: unknown) => new AnthropicLlm({ apiKey: 'k', models: { author: 'm', judge: 'm' }, meter: new UsageMeter(), fetch: fakeApi([r]).fetch });
    const refused = mk(message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null }, content: [] }));
    await expect(refused.structured({ label: 'x', system: 's', prompt: 'p', schema: Answer })).rejects.toThrow(LlmRefusalError);
    expect(refused.meter.records).toHaveLength(1);
    const cut = mk(message({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"answer":' }] }));
    await expect(cut.structured({ label: 'x', system: 's', prompt: 'p', schema: Answer })).rejects.toThrow(/ran out of room/);
    const bad = mk(message({ content: [{ type: 'text', text: '{"answer":"only"}' }] }));
    await expect(bad.structured({ label: 'x', system: 's', prompt: 'p', schema: Answer })).rejects.toThrow(/expected shape|match/);
  });

  it('refuses to start a call when the budget is already used', async () => {
    const meter = new UsageMeter({ limitUsd: 0.0001 });
    await meter.record('earlier', 'x', 'claude-opus-5-5', { output_tokens: 1000 });
    const llm = new AnthropicLlm({ apiKey: 'k', models: { author: 'm', judge: 'm' }, meter, fetch: fakeApi([]).fetch });
    await expect(llm.structured({ label: 'x', system: 's', prompt: 'p', schema: Answer })).rejects.toThrow(BudgetExceededError);
  });
});

describe('AnthropicLlm.research', () => {
  const searchTurn = (stop: string, text: string, results: Array<{ url: string; title: string; page_age?: string }>) =>
    message({
      stop_reason: stop,
      usage: { input_tokens: 2000, output_tokens: 800, server_tool_use: { web_search_requests: 2 } },
      content: [
        { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'q' } },
        { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: results.map((r) => ({ type: 'web_search_result', encrypted_content: 'x', ...r })) },
        { type: 'text', text },
      ],
    });

  it('declares the search tool, collects sources and counts searches', async () => {
    const api = fakeApi([searchTurn('end_turn', 'Notes about eSIM.', [{ url: 'https://a.test/1', title: 'A', page_age: '2 days ago' }, { url: 'https://b.test/2', title: 'B' }])]);
    const llm = new AnthropicLlm({ apiKey: 'k', models: { author: 'claude-opus-5-5', judge: 'm' }, meter: new UsageMeter(), fetch: api.fetch });
    const r = await llm.research({ label: 'research', system: 's', prompt: 'p', maxSearches: 3, allowedDomains: ['a.test', 'b.test'] });
    expect(r.text).toBe('Notes about eSIM.');
    expect(r.sources).toEqual([{ url: 'https://a.test/1', title: 'A', pageAge: '2 days ago' }, { url: 'https://b.test/2', title: 'B', pageAge: undefined }]);
    expect(r.searches).toBe(2);
    expect(api.requests[0].tools[0]).toMatchObject({ type: 'web_search_20260209', name: 'web_search', max_uses: 3, allowed_domains: ['a.test', 'b.test'] });
    expect(llm.meter.costUsd).toBeCloseTo((2000 * 4 + 800 * 20) / 1e6 + 2 * 0.01, 8);
  });

  it('resumes a paused turn and merges sources without duplicates', async () => {
    const api = fakeApi([
      searchTurn('pause_turn', 'Part one. ', [{ url: 'https://a.test/1', title: 'A' }]),
      searchTurn('end_turn', 'Part two.', [{ url: 'https://a.test/1', title: 'A' }, { url: 'https://c.test/3', title: 'C' }]),
    ]);
    const llm = new AnthropicLlm({ apiKey: 'k', models: { author: 'm', judge: 'm' }, meter: new UsageMeter(), fetch: api.fetch });
    const r = await llm.research({ label: 'research', system: 's', prompt: 'p' });
    expect(r.text).toBe('Part one. Part two.');
    expect(r.sources.map((s) => s.url)).toEqual(['https://a.test/1', 'https://c.test/3']);
    expect(api.requests).toHaveLength(2);
    expect(api.requests[1].messages.at(-1).role).toBe('assistant');
  });
});

describe('MockLlm', () => {
  it('matches handlers by label prefix, validates output against the real schema and meters cost', async () => {
    const llm = new MockLlm({ structured: { write: () => ({ answer: 'ok', n: 1 }), 'write:bad': () => ({ nope: true }) } });
    expect(await llm.structured({ label: 'write:en', system: 's', prompt: 'p', schema: Answer })).toEqual({ answer: 'ok', n: 1 });
    await expect(llm.structured({ label: 'write:bad', system: 's', prompt: 'p', schema: Answer })).rejects.toThrow();
    await expect(llm.structured({ label: 'other', system: 's', prompt: 'p', schema: Answer })).rejects.toThrow(/no handler/);
    expect(llm.calls.map((c) => c.label)).toEqual(['write:en', 'write:bad', 'other']);
    expect(llm.meter.records.length).toBe(2);
  });
});
