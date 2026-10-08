export interface Db {
  /** Run a parameterised query ($1, $2, ...) and return the rows. */
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run one or more statements with no parameters (used for migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

export type Role = 'owner' | 'editor' | 'reviewer' | 'client';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  tenant_id: string | null;
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_last_step: number | null;
  disabled: boolean;
  created_at: string;
}

export type RunKind = 'agent' | 'tracker' | 'deploy';
export type RunStatus = 'running' | 'success' | 'failed' | 'held' | 'skipped';
export type RunTrigger = 'schedule' | 'manual' | 'retry';

export interface Run {
  id: string;
  tenant_id: string;
  kind: RunKind;
  status: RunStatus;
  trigger: RunTrigger;
  started_at: string;
  finished_at: string | null;
  topic: string | null;
  article_url: string | null;
  pr_number: number | null;
  steps: Array<{ name: string; status: 'ok' | 'failed' | 'skipped'; ms?: number; detail?: string }>;
  checks: Array<{ name: string; passed: boolean; reason?: string }>;
  sources: Array<{ url: string; title?: string; date?: string }>;
  error: string | null;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  github_run_url: string | null;
}
