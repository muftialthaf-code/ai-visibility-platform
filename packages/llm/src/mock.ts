import { UsageMeter } from './meter.ts';
import type { Llm, ResearchRequest, ResearchResult, StructuredRequest } from './types.ts';

type StructuredHandler = (req: StructuredRequest<any>, call: number) => unknown;
type ResearchHandler = (req: ResearchRequest, call: number) => ResearchResult;

/**
 * A scripted stand-in for Claude, for tests and dry runs. Handlers are matched by label prefix, so
 * "write" answers "write:en". Output is checked against the real schema, exactly as in production.
 * Token counts are estimated from text length so the cost meter still works.
 */
export class MockLlm implements Llm {
  readonly meter: UsageMeter;
  readonly calls: Array<{ kind: 'structured' | 'research'; label: string; prompt: string; system: string }> = [];
  private counts = new Map<string, number>();

  constructor(
    private handlers: { structured?: Record<string, StructuredHandler>; research?: Record<string, ResearchHandler> },
    meter = new UsageMeter(),
    private model = 'claude-sonnet-5-5',
  ) {
    this.meter = meter;
  }

  private next(key: string) {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n;
  }

  private find<H>(table: Record<string, H> | undefined, label: string): H {
    const key = Object.keys(table ?? {}).sort((a, b) => b.length - a.length).find((k) => label === k || label.startsWith(k + ':'));
    if (!key) throw new Error(`MockLlm has no handler for "${label}"`);
    return table![key]!;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    this.meter.assertWithinBudget();
    this.calls.push({ kind: 'structured', label: req.label, prompt: req.prompt, system: req.system });
    const out = this.find(this.handlers.structured, req.label)(req, this.next(`s:${req.label}`));
    await this.meter.record(req.label, 'mock', this.model, { input_tokens: Math.ceil((req.system.length + req.prompt.length) / 4), output_tokens: Math.ceil(JSON.stringify(out).length / 4) });
    return req.schema.parse(out);
  }

  async research(req: ResearchRequest): Promise<ResearchResult> {
    this.meter.assertWithinBudget();
    this.calls.push({ kind: 'research', label: req.label, prompt: req.prompt, system: req.system });
    const out = this.find(this.handlers.research, req.label)(req, this.next(`r:${req.label}`));
    await this.meter.record(req.label, 'mock', this.model, {
      input_tokens: Math.ceil((req.system.length + req.prompt.length) / 4),
      output_tokens: Math.ceil(out.text.length / 4),
      server_tool_use: { web_search_requests: out.searches },
    });
    return out;
  }
}
