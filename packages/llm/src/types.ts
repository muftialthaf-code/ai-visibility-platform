import type { z } from 'zod';
import type { UsageMeter } from './meter.ts';

export type Effort = 'low' | 'medium' | 'high';

export interface StructuredRequest<T> {
  /** Names this call in usage records, for example "write:en" or "judge:voice". */
  label: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Which of the two configured models to use. Default "author". */
  role?: 'author' | 'judge';
  maxTokens?: number;
  effort?: Effort;
}

export interface ResearchRequest {
  label: string;
  system: string;
  prompt: string;
  maxSearches?: number;
  /** Only search these sites, if set. */
  allowedDomains?: string[];
  role?: 'author' | 'judge';
}

export interface ResearchSource {
  url: string;
  title: string;
  /** How old the page is, as reported by search (for example "3 days ago" or a date). */
  pageAge?: string;
}

export interface ResearchResult {
  /** The model's notes, written from what the searches returned. */
  text: string;
  sources: ResearchSource[];
  searches: number;
}

/** What the agent needs from a language model. The real implementation calls Claude; tests use a script. */
export interface Llm {
  readonly meter: UsageMeter;
  structured<T>(req: StructuredRequest<T>): Promise<T>;
  research(req: ResearchRequest): Promise<ResearchResult>;
}

export class LlmRefusalError extends Error {
  constructor(
    public category: string | null,
    label: string,
  ) {
    super(`The model declined the request "${label}"${category ? ` (${category})` : ''}`);
    this.name = 'LlmRefusalError';
  }
}

export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmOutputError';
  }
}
