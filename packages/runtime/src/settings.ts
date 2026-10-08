/** Global settings edited in the dashboard (Settings) and read by the agent. Stored in the `settings` table. */

export interface GlobalDefaults {
  /** Starting monthly budget for new businesses, in USD. 0 means no cap. */
  monthlyBudgetUsd: number;
  defaultLanguage: string;
  /** An article more similar than this to an existing one (0 to 1) is a duplicate and fails the check. */
  maxDuplicateSimilarity: number;
  /** Minimum number of cited sources an article needs. */
  minSources: number;
  /** An article's risk score (0 to 100) must be at or below this for auto-approval rules. */
  autoApproveMaxRisk: number;
  /** Minimum Flesch reading ease for English articles. */
  minReadability: number;
}

export interface NotificationSettings {
  emails: string[];
  notifyOnNewDraft: boolean;
  notifyOnFailure: boolean;
  /** Remind about drafts left unreviewed this long. 0 turns reminders off. */
  reminderAfterHours: number;
  /** Warn when a business has used this percentage of its monthly budget. */
  budgetAlertPercent: number;
}

export const DEFAULT_GLOBALS: GlobalDefaults = {
  monthlyBudgetUsd: 20,
  defaultLanguage: 'en',
  maxDuplicateSimilarity: 0.6,
  minSources: 2,
  autoApproveMaxRisk: 30,
  minReadability: 40,
};

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  emails: [],
  notifyOnNewDraft: true,
  notifyOnFailure: true,
  reminderAfterHours: 24,
  budgetAlertPercent: 80,
};

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Merge stored or submitted values over the defaults, clamping everything to sane ranges. */
export function parseGlobals(raw: unknown): GlobalDefaults {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lang = typeof r.defaultLanguage === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(r.defaultLanguage) ? r.defaultLanguage : DEFAULT_GLOBALS.defaultLanguage;
  return {
    monthlyBudgetUsd: num(r.monthlyBudgetUsd, 0, 100000, DEFAULT_GLOBALS.monthlyBudgetUsd),
    defaultLanguage: lang,
    maxDuplicateSimilarity: num(r.maxDuplicateSimilarity, 0.1, 1, DEFAULT_GLOBALS.maxDuplicateSimilarity),
    minSources: Math.round(num(r.minSources, 0, 20, DEFAULT_GLOBALS.minSources)),
    autoApproveMaxRisk: num(r.autoApproveMaxRisk, 0, 100, DEFAULT_GLOBALS.autoApproveMaxRisk),
    minReadability: num(r.minReadability, 0, 100, DEFAULT_GLOBALS.minReadability),
  };
}

export function parseNotifications(raw: unknown): NotificationSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const emails = (Array.isArray(r.emails) ? r.emails : typeof r.emails === 'string' ? r.emails.split(/[\s,;]+/) : [])
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return {
    emails: [...new Set(emails)],
    notifyOnNewDraft: r.notifyOnNewDraft === undefined ? DEFAULT_NOTIFICATIONS.notifyOnNewDraft : Boolean(r.notifyOnNewDraft),
    notifyOnFailure: r.notifyOnFailure === undefined ? DEFAULT_NOTIFICATIONS.notifyOnFailure : Boolean(r.notifyOnFailure),
    reminderAfterHours: num(r.reminderAfterHours, 0, 720, DEFAULT_NOTIFICATIONS.reminderAfterHours),
    budgetAlertPercent: num(r.budgetAlertPercent, 1, 100, DEFAULT_NOTIFICATIONS.budgetAlertPercent),
  };
}
