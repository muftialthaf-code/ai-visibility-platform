/**
 * Describes the tenant editor. Each section is a list of field specs; one renderer draws the form
 * and one parser turns the submitted form into a config patch. Saving goes through updateTenant,
 * so the same validation as the CLI applies and nothing invalid is ever written.
 */

export type Column = { key: string; label: string; kind: 'text' | 'textarea' | 'localized' | 'localizedText' | 'localizedLines' | 'slug'; from?: string; hint?: string };

export type Field =
  | { kind: 'text' | 'textarea' | 'color' | 'url' | 'email'; path: string; label: string; hint?: string; required?: boolean }
  | { kind: 'number'; path: string; label: string; hint?: string; min?: number; max?: number; step?: number; /** A blank field saves null (removes the value). */ nullable?: boolean }
  | { kind: 'select'; path: string; label: string; options: Array<{ value: string; label: string }>; hint?: string; emptyIsNull?: boolean }
  | { kind: 'bool'; path: string; label: string; hint?: string }
  | { kind: 'lines'; path: string; label: string; hint?: string }
  | { kind: 'localized'; path: string; label: string; hint?: string; long?: boolean }
  | { kind: 'localizedLines'; path: string; label: string; hint?: string }
  | { kind: 'rows'; path: string; label: string; columns: Column[]; blank?: number; hint?: string };

export interface Section {
  key: string;
  title: string;
  intro?: string;
  fields: Field[];
}

const yesNo = (path: string, label: string, hint?: string): Field => ({ kind: 'bool', path, label, hint });

export const SECTIONS: Section[] = [
  {
    key: 'controls',
    title: 'Controls',
    intro: 'The switches that decide whether this business is live and how its agent behaves.',
    fields: [
      { kind: 'select', path: 'status', label: 'Site status', options: [{ value: 'active', label: 'Active (deployed and scheduled)' }, { value: 'paused', label: 'Paused (skipped by deploys and schedules)' }] },
      yesNo('agent.paused', 'Pause the article agent', 'Stops new articles without taking the site down.'),
      { kind: 'select', path: 'agent.publishMode', label: 'Publishing', options: [{ value: 'approval', label: 'Approval first (articles wait in the Review Queue)' }, { value: 'auto', label: 'Auto-publish (articles that pass every check go live)' }], hint: 'Even in auto-publish, an article that fails any check is held for review.' },
      { kind: 'number', path: 'agent.articlesPerDay', label: 'Articles per day', min: 0, max: 10, step: 1 },
      { kind: 'number', path: 'agent.monthlyBudgetUsd', label: 'Monthly budget cap (USD)', min: 0, step: 1, hint: 'The agent stops for the month when spend reaches this amount. 0 means no cap.' },
      { kind: 'number', path: 'agent.autoApproveMaxRisk', label: 'Auto-publish below this risk score', min: 0, max: 100, step: 5, nullable: true, hint: 'Approval-first mode only. Leave blank so every article waits for a person. When set, an article that passes every check with a risk score at or below this publishes without review.' },
      { kind: 'lines', path: 'agent.articleLanguages', label: 'Write articles in these languages', hint: 'One code per line, for example en and ar. Blank means the default language only. Each language is written natively and costs a full article.' },
      { kind: 'number', path: 'agent.articleWords.min', label: 'Article length, minimum words', min: 100, max: 5000, step: 50 },
      { kind: 'number', path: 'agent.articleWords.max', label: 'Article length, maximum words', min: 100, max: 5000, step: 50 },
    ],
  },
  {
    key: 'identity',
    title: 'Identity',
    fields: [
      { kind: 'text', path: 'identity.name', label: 'Business name', required: true },
      { kind: 'text', path: 'identity.domain', label: 'Domain', hint: 'Hostname only, for example example.com', required: true },
      { kind: 'localized', path: 'identity.tagline', label: 'Tagline', hint: 'One sentence that says what you do and who it is for.' },
      { kind: 'text', path: 'identity.logo', label: 'Logo path or URL' },
      { kind: 'color', path: 'identity.brand.colors.primary', label: 'Primary colour' },
      { kind: 'color', path: 'identity.brand.colors.accent', label: 'Accent colour' },
      { kind: 'color', path: 'identity.brand.colors.background', label: 'Background colour' },
      { kind: 'color', path: 'identity.brand.colors.text', label: 'Text colour' },
      { kind: 'text', path: 'identity.brand.fonts.heading', label: 'Heading font', hint: 'Optional. Falls back to the system font.' },
      { kind: 'text', path: 'identity.brand.fonts.body', label: 'Body font' },
      yesNo('identity.showPlatformBrand', 'Show the platform brand in the footer', 'Off by default so the site is fully white-label.'),
    ],
  },
  {
    key: 'languages',
    title: 'Languages',
    fields: [
      { kind: 'text', path: 'languages.default', label: 'Default language code', hint: 'For example en. The default language is served at the site root.' },
      { kind: 'lines', path: 'languages.supported', label: 'Supported language codes', hint: 'One per line, for example en and ar. Add translations in each section after adding a language.' },
    ],
  },
  {
    key: 'business',
    title: 'Business',
    fields: [
      { kind: 'localized', path: 'profile.description', label: 'What the business does', long: true },
      { kind: 'localized', path: 'profile.audience', label: 'Who it serves', long: true },
      { kind: 'lines', path: 'profile.geography', label: 'Places served', hint: 'One per line.' },
      { kind: 'localizedLines', path: 'profile.differentiators', label: 'What sets it apart', hint: 'One per line, for each language. Only real, verifiable points.' },
      { kind: 'localized', path: 'profile.pricingApproach', label: 'How pricing works', hint: 'Plain language, no guarantees.', long: true },
      {
        kind: 'rows',
        path: 'profile.offerings',
        label: 'Services or products',
        blank: 2,
        columns: [
          { key: 'name', label: 'Name', kind: 'localized' },
          { key: 'summary', label: 'Summary', kind: 'localizedText' },
          { key: 'pricing', label: 'Pricing note (optional)', kind: 'localized' },
          { key: 'id', label: 'Page slug', kind: 'slug', from: 'name' },
        ],
      },
    ],
  },
  {
    key: 'audience',
    title: 'Personas and pain points',
    intro: 'The agent uses these to discover which questions to write about.',
    fields: [
      {
        kind: 'rows',
        path: 'personas',
        label: 'Personas',
        blank: 2,
        columns: [
          { key: 'name', label: 'Persona name', kind: 'localized' },
          { key: 'painPoints', label: 'Pain points (one per line)', kind: 'localizedLines' },
          { key: 'id', label: 'Id', kind: 'slug', from: 'name' },
        ],
      },
    ],
  },
  {
    key: 'strategy',
    title: 'Content strategy',
    fields: [
      { kind: 'lines', path: 'pillars', label: 'Content pillars', hint: 'One per line.' },
      { kind: 'lines', path: 'questionTypes', label: 'Question types to target', hint: 'For example "how much does X cost", "X vs Y". One per line.' },
      { kind: 'lines', path: 'keywords', label: 'Keywords', hint: 'One per line.' },
      {
        kind: 'rows',
        path: 'competitors',
        label: 'Competitors',
        blank: 3,
        columns: [
          { key: 'name', label: 'Name', kind: 'text' },
          { key: 'domain', label: 'Domain (optional)', kind: 'text' },
        ],
      },
      { kind: 'lines', path: 'trackerPrompts', label: 'Prompts to track', hint: 'Questions the weekly tracker asks AI assistants to see whether this business is mentioned. One per line.' },
    ],
  },
  {
    key: 'voice',
    title: 'Voice and compliance',
    fields: [
      { kind: 'localized', path: 'voice.tone', label: 'Tone of voice', long: true },
      { kind: 'lines', path: 'voice.dos', label: 'Do', hint: 'One per line.' },
      { kind: 'lines', path: 'voice.donts', label: 'Do not', hint: 'One per line.' },
      { kind: 'lines', path: 'voice.bannedClaims', label: 'Banned phrases', hint: 'Phrases that must never appear in any article or page. One per line.' },
      { kind: 'lines', path: 'compliance.neverClaim', label: 'Claims this business must never make', hint: 'Legal and compliance. One per line.' },
      { kind: 'textarea', path: 'compliance.notes', label: 'Compliance notes' },
    ],
  },
  {
    key: 'author',
    title: 'Author',
    fields: [
      { kind: 'select', path: 'author.policy', label: 'Byline', options: [{ value: 'person', label: 'A named person' }, { value: 'organization', label: 'The organization' }, { value: 'team', label: 'The team' }] },
      { kind: 'text', path: 'author.name', label: 'Author name', required: true },
      { kind: 'localized', path: 'author.bio', label: 'Author bio', hint: 'Real credentials only.', long: true },
      { kind: 'url', path: 'author.url', label: 'Author page URL' },
    ],
  },
  {
    key: 'faq',
    title: 'FAQ',
    intro: 'Aim for 15 to 25 questions. Each answer starts with the direct answer and runs 40 to 60 words.',
    fields: [
      {
        kind: 'rows',
        path: 'faq',
        label: 'Questions and answers',
        blank: 3,
        columns: [
          { key: 'question', label: 'Question', kind: 'localized' },
          { key: 'answer', label: 'Answer', kind: 'localizedText' },
        ],
      },
    ],
  },
  {
    key: 'legal',
    title: 'Legal pages',
    intro: 'Paste text written or approved by the business owner or their lawyer. A page with no text is not published.',
    fields: [
      { kind: 'localized', path: 'legal.privacy', label: 'Privacy policy (Markdown)', long: true },
      { kind: 'localized', path: 'legal.terms', label: 'Terms (Markdown)', long: true },
    ],
  },
  {
    key: 'integrations',
    title: 'Integrations and site',
    fields: [
      { kind: 'select', path: 'integrations.leadForm.type', label: 'Lead form destination', emptyIsNull: true, options: [{ value: '', label: 'Not set up' }, { value: 'email', label: 'Email' }, { value: 'webhook', label: 'Webhook' }, { value: 'google-sheet', label: 'Google Sheet' }, { value: 'crm', label: 'CRM' }] },
      { kind: 'text', path: 'integrations.leadForm.destination', label: 'Destination', hint: 'An email address, or the name of a secret that holds the endpoint. Never paste a key here.' },
      { kind: 'select', path: 'integrations.analytics.provider', label: 'Analytics', options: [{ value: 'none', label: 'None' }, { value: 'plausible', label: 'Plausible' }, { value: 'ga4', label: 'Google Analytics 4' }] },
      { kind: 'text', path: 'integrations.searchConsoleProperty', label: 'Search Console property', hint: 'For example sc-domain:example.com. Lets the weekly report include Google search clicks. Leave blank to skip.' },
      { kind: 'text', path: 'integrations.analytics.id', label: 'Analytics id', hint: 'Plausible site domain, or the GA4 measurement id.' },
      yesNo('crawlers.allowAI', 'Allow AI crawlers', 'GPTBot, ClaudeBot, PerplexityBot and the rest. Leave on unless there is a reason.'),
      yesNo('site.pages.home', 'Page: Home'),
      yesNo('site.pages.services', 'Page: Services'),
      yesNo('site.pages.pricing', 'Page: Pricing'),
      yesNo('site.pages.about', 'Page: About'),
      yesNo('site.pages.faq', 'Page: FAQ'),
      yesNo('site.pages.contact', 'Page: Contact'),
      yesNo('site.pages.blog', 'Page: Blog'),
      yesNo('site.pages.legal', 'Page: Legal'),
      yesNo('site.modules.caseStudies', 'Module: Case studies'),
      yesNo('site.modules.locations', 'Module: Location pages'),
      yesNo('site.modules.catalog', 'Module: Product or plan catalog'),
      yesNo('site.modules.comparisons', 'Module: Comparison pages'),
    ],
  },
];

/* ---------- form naming ---------- */

export const fname = (path: string) => `f:${path}`;
export const lname = (path: string, lang: string) => `l:${path}:${lang}`;
export const rname = (path: string, i: number, col: string, lang?: string) => `r:${path}:${i}:${col}${lang ? `:${lang}` : ''}`;

/* ---------- reading and writing nested config ---------- */

export function getByPath(obj: unknown, path: string): any {
  return path.split('.').reduce<any>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function setByPath(target: Record<string, any>, path: string, value: unknown) {
  const keys = path.split('.');
  let o = target;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)!] = value;
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const splitLines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/**
 * Turn a submitted form into a patch for updateTenant. Only fields in this section are included.
 * `languages` are the tenant's supported languages (translated fields render one input per language).
 */
export function buildPatch(section: Section, data: FormData, languages: string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const str = (name: string) => String(data.get(name) ?? '');

  for (const f of section.fields) {
    switch (f.kind) {
      case 'text':
      case 'textarea':
      case 'color':
      case 'url':
      case 'email': {
        const v = str(fname(f.path)).trim();
        // An emptied optional field is removed rather than saved as an empty string.
        setByPath(patch, f.path, v === '' && !f.required ? null : v);
        break;
      }
      case 'number': {
        const raw = str(fname(f.path)).trim();
        if (raw !== '') setByPath(patch, f.path, Number(raw));
        else if (f.nullable) setByPath(patch, f.path, null);
        break;
      }
      case 'select': {
        const v = str(fname(f.path));
        setByPath(patch, f.path, v === '' && f.emptyIsNull ? null : v);
        break;
      }
      case 'bool':
        setByPath(patch, f.path, data.get(fname(f.path)) === 'on');
        break;
      case 'lines':
        setByPath(patch, f.path, splitLines(str(fname(f.path))));
        break;
      case 'localized': {
        const obj: Record<string, string> = {};
        for (const l of languages) {
          const v = str(lname(f.path, l)).trim();
          if (v) obj[l] = v;
        }
        if (Object.keys(obj).length > 0) setByPath(patch, f.path, obj);
        break;
      }
      case 'localizedLines': {
        const obj: Record<string, string[]> = {};
        for (const l of languages) obj[l] = splitLines(str(lname(f.path, l)));
        setByPath(patch, f.path, obj);
        break;
      }
      case 'rows': {
        const total = Number(str(`n:${f.path}`) || 0);
        const rows: Array<Record<string, unknown>> = [];
        for (let i = 0; i < total; i++) {
          const row: Record<string, unknown> = {};
          let any = false;
          for (const c of f.columns) {
            if (c.kind === 'slug') continue;
            if (c.kind === 'text' || c.kind === 'textarea') {
              const v = str(rname(f.path, i, c.key)).trim();
              if (v) {
                row[c.key] = v;
                any = true;
              }
            } else if (c.kind === 'localizedLines') {
              const obj: Record<string, string[]> = {};
              for (const l of languages) obj[l] = splitLines(str(rname(f.path, i, c.key, l)));
              row[c.key] = obj;
              if (Object.values(obj).some((a) => a.length)) any = true;
            } else {
              const obj: Record<string, string> = {};
              for (const l of languages) {
                const v = str(rname(f.path, i, c.key, l)).trim();
                if (v) obj[l] = v;
              }
              if (Object.keys(obj).length) {
                row[c.key] = obj;
                any = true;
              }
            }
          }
          if (!any) continue; // blank row
          for (const c of f.columns) {
            if (c.kind !== 'slug') continue;
            const typed = str(rname(f.path, i, c.key)).trim();
            const source = c.from ? (row[c.from] as Record<string, string> | string | undefined) : undefined;
            const base = typeof source === 'string' ? source : source ? (source[languages[0]!] ?? Object.values(source)[0]) : '';
            row[c.key] = typed || slugify(base ?? '') || `item-${i + 1}`;
          }
          rows.push(row);
        }
        setByPath(patch, f.path, rows);
        break;
      }
    }
  }
  return patch;
}
