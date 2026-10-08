import { costOf, type PricingConfig, type Usage } from './pricing.ts';

export interface UsageRecord {
  label: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export class BudgetExceededError extends Error {
  constructor(
    public spent: number,
    public limit: number,
  ) {
    super(`Budget reached: $${spent.toFixed(2)} spent of the $${limit.toFixed(2)} available`);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Adds up what a run costs and stops it when the money available runs out. `limitUsd` is what is left of
 * the tenant's monthly budget when the run starts (null means no cap). Every call is also handed to `onRecord`
 * so it can be saved per tenant for reporting.
 */
export class UsageMeter {
  readonly records: UsageRecord[] = [];

  constructor(
    private opts: {
      limitUsd?: number | null;
      pricing?: PricingConfig;
      onRecord?: (r: UsageRecord) => void | Promise<void>;
    } = {},
  ) {}

  get costUsd() {
    return this.records.reduce((n, r) => n + r.costUsd, 0);
  }
  get tokensIn() {
    return this.records.reduce((n, r) => n + r.tokensIn, 0);
  }
  get tokensOut() {
    return this.records.reduce((n, r) => n + r.tokensOut, 0);
  }

  /** Throws before a call when the budget is already used up. */
  assertWithinBudget() {
    const limit = this.opts.limitUsd;
    if (limit !== null && limit !== undefined && this.costUsd >= limit) throw new BudgetExceededError(this.costUsd, limit);
  }

  async record(label: string, provider: string, model: string, usage: Usage) {
    const r: UsageRecord = {
      label,
      provider,
      model,
      tokensIn: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      tokensOut: usage.output_tokens ?? 0,
      costUsd: costOf(model, usage, this.opts.pricing),
    };
    this.records.push(r);
    await this.opts.onRecord?.(r);
    return r;
  }
}
