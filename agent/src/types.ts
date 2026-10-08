import type { Article, Source } from '@avp/content';
import type { Db } from '@avp/db';
import type { GitHubClient } from '@avp/github';
import type { Llm } from '@avp/llm';
import type { GlobalDefaults, NotificationSettings } from '@avp/runtime';
import type { TenantConfig } from '@avp/tenant-schema';
import type { TenantStore } from '@avp/tenant-ops';

/** Everything the agent needs, handed in so tests can swap any part for a fake. */
export interface AgentContext {
  tenant: TenantConfig;
  llm: Llm;
  db: Db;
  gh: GitHubClient;
  /** Reads tenant files (existing articles) from the production branch. */
  store: TenantStore;
  globals: GlobalDefaults;
  notifications: NotificationSettings;
  /** Public site URL for the tenant, used to build live article links. */
  siteUrl: string;
  now: () => Date;
  log: (message: string) => void;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

/** A fact found in research, with the words it rests on. */
export interface Fact {
  claim: string;
  sourceUrl: string;
  /** A short passage from the research notes that backs the claim. */
  quote: string;
}

export interface ResearchPack {
  /** The research notes the facts were drawn from. */
  notes: string;
  facts: Fact[];
  sources: Source[];
}

/** What the writer produces before it becomes an article file. */
export interface Draft {
  title: string;
  metaTitle?: string;
  description: string;
  slug: string;
  takeaways: string[];
  body: string;
  faq: Array<{ question: string; answer: string }>;
  /** Every factual statement in the article, each tied to one of the sources. */
  claims: Array<{ text: string; sourceUrl: string }>;
}

export interface CheckResult {
  name: string;
  /** Plain-language name for the review screen. */
  label: string;
  passed: boolean;
  reason?: string;
  /** Blockers hold the article for review when they fail. Advisory results are shown but do not block. */
  severity: 'blocker' | 'advisory';
}

export interface TopicChoice {
  id?: string;
  topic: string;
  question: string;
  persona?: string;
  intent?: string;
}

export interface WrittenArticle {
  lang: string;
  article: Article;
  draft: Draft;
}

/** Stored in the pull request so the dashboard can show the review screen from GitHub alone. */
export interface ReviewData {
  version: 1;
  tenantId: string;
  topic: TopicChoice;
  slug: string;
  languages: string[];
  checks: Array<CheckResult & { lang: string }>;
  risk: number;
  gatesPassed: boolean;
  sources: Source[];
  cost: { usd: number; tokensIn: number; tokensOut: number };
  runId?: string;
  generatedAt: string;
  revision: number;
}
