import { z } from 'zod';

/** BCP-47-ish language code, e.g. "en", "ar", "pt-BR". */
export const langCode = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Use a language code like "en" or "ar"');

export const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only');

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour like #0a7d5a');

const hostname = z
  .string()
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i, 'Hostname only, with no protocol or path');

/** A string translated per language: { en: "...", ar: "..." }. */
export const localized = z
  .record(langCode, z.string().min(1))
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one language');

const localizedList = z.record(langCode, z.array(z.string().min(1)));

export const identitySchema = z.object({
  name: z.string().min(1),
  domain: hostname,
  tagline: localized,
  logo: z.string().optional(),
  brand: z.object({
    colors: z.object({
      primary: hexColor,
      accent: hexColor,
      background: hexColor,
      text: hexColor,
    }),
    fonts: z
      .object({
        heading: z.string().optional(),
        body: z.string().optional(),
      })
      .default({}),
  }),
  /** The platform brand never appears on tenant sites unless this is true. */
  showPlatformBrand: z.boolean().default(false),
});

export const languagesSchema = z
  .object({
    default: langCode,
    supported: z.array(langCode).min(1),
  })
  .refine((l) => l.supported.includes(l.default), {
    message: 'The default language must be one of the supported languages',
    path: ['default'],
  });

export const offeringSchema = z.object({
  id: slug,
  name: localized,
  summary: localized,
  /** Optional plain-language pricing note for this offering. */
  pricing: localized.optional(),
});

export const profileSchema = z.object({
  description: localized,
  audience: localized,
  geography: z.array(z.string()).default([]),
  differentiators: localizedList.default({}),
  offerings: z.array(offeringSchema).default([]),
  pricingApproach: localized.optional(),
});

export const personaSchema = z.object({
  id: slug,
  name: localized,
  painPoints: localizedList.default({}),
});

export const competitorSchema = z.object({
  name: z.string().min(1),
  domain: hostname.optional(),
});

export const voiceSchema = z.object({
  tone: localized,
  dos: z.array(z.string()).default([]),
  donts: z.array(z.string()).default([]),
  /** Phrases that must never appear in any generated or published copy. */
  bannedClaims: z.array(z.string().min(1)).default([]),
});

export const authorSchema = z.object({
  policy: z.enum(['person', 'organization', 'team']),
  name: z.string().min(1),
  bio: localized,
  url: z.string().url().optional(),
});

const pageToggles = z.object({
  home: z.boolean().default(true),
  services: z.boolean().default(true),
  pricing: z.boolean().default(true),
  about: z.boolean().default(true),
  faq: z.boolean().default(true),
  contact: z.boolean().default(true),
  blog: z.boolean().default(true),
  legal: z.boolean().default(true),
});

export const siteSchema = z.object({
  template: z.string().default('default'),
  pages: pageToggles.default(pageToggles.parse({})),
  modules: z
    .object({
      caseStudies: z.boolean().default(false),
      locations: z.boolean().default(false),
      catalog: z.boolean().default(false),
      comparisons: z.boolean().default(false),
    })
    .default({ caseStudies: false, locations: false, catalog: false, comparisons: false }),
});

export const faqItemSchema = z.object({
  question: localized,
  answer: localized,
});

/**
 * Integration settings hold destinations and public identifiers only.
 * Secrets (API keys, tokens) live in repository / host secret stores, never here.
 */
export const integrationsSchema = z.object({
  leadForm: z
    .object({
      type: z.enum(['email', 'webhook', 'google-sheet', 'crm']),
      /** Email address or secret-store key name, never a credential. */
      destination: z.string().min(1),
    })
    .optional(),
  analytics: z
    .object({
      provider: z.enum(['plausible', 'ga4', 'none']),
      id: z.string().optional(),
    })
    .default({ provider: 'none' }),
  feeds: z
    .array(
      z.object({
        id: slug,
        type: z.enum(['api', 'csv']),
        /** Name of the secret holding the URL/credentials, if any. */
        secretName: z.string().optional(),
        url: z.string().url().optional(),
      }),
    )
    .default([]),
});

export const agentSchema = z.object({
  articlesPerDay: z.number().int().min(0).max(10).default(1),
  publishMode: z.enum(['approval', 'auto']).default('approval'),
  paused: z.boolean().default(false),
  monthlyBudgetUsd: z.number().min(0).default(0),
  articleWords: z
    .object({ min: z.number().int().min(100).default(800), max: z.number().int().max(5000).default(1500) })
    .default({ min: 800, max: 1500 }),
});

export const crawlersSchema = z.object({
  allowAI: z.boolean().default(true),
  /** Per-crawler override, e.g. { "GPTBot": false }. */
  overrides: z.record(z.string(), z.boolean()).default({}),
});

export const tenantSchema = z.object({
  schemaVersion: z.literal(1),
  /** Folder name. A leading underscore marks a template that is never deployed. */
  id: z.string().regex(/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only'),
  status: z.enum(['active', 'paused']).default('paused'),
  identity: identitySchema,
  languages: languagesSchema,
  profile: profileSchema,
  personas: z.array(personaSchema).default([]),
  pillars: z.array(z.string()).default([]),
  questionTypes: z.array(z.string()).default([]),
  competitors: z.array(competitorSchema).default([]),
  keywords: z.array(z.string()).default([]),
  voice: voiceSchema,
  author: authorSchema,
  site: siteSchema.default(siteSchema.parse({})),
  faq: z.array(faqItemSchema).default([]),
  integrations: integrationsSchema.default(integrationsSchema.parse({})),
  agent: agentSchema.default(agentSchema.parse({})),
  crawlers: crawlersSchema.default(crawlersSchema.parse({})),
  /**
   * Markdown for the legal pages, written or approved by the business owner.
   * A page with no text here is not generated, so the platform never invents legal terms.
   */
  legal: z.object({ privacy: localized.optional(), terms: localized.optional() }).default({}),
  /** Prompts the weekly tracker runs to measure AI visibility. */
  trackerPrompts: z.array(z.string().min(1)).default([]),
  /** Claims this business must never make (legal / compliance notes). */
  compliance: z.object({ neverClaim: z.array(z.string().min(1)).default([]), notes: z.string().optional() }).default({ neverClaim: [] }),
});

export type TenantConfig = z.infer<typeof tenantSchema>;
export type Localized = z.infer<typeof localized>;
