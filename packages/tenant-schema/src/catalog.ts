import { z } from 'zod';
import { localized, slug } from './schema.ts';

/** One purchasable plan or product, in the platform's own shape (never the supplier's). */
export const catalogItemSchema = z.object({
  id: slug,
  name: z.union([z.string().min(1), localized]),
  /** Country or region the plan covers, for example "Saudi Arabia" or "Europe". */
  destination: z.string().min(1),
  /** Data allowance in GB. null means unlimited. */
  dataGb: z.number().positive().nullable(),
  validityDays: z.number().int().positive(),
  price: z.number().nonnegative(),
  /** ISO 4217 code, for example USD or SAR. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Where to buy it. */
  url: z.string().url().optional(),
});

export const catalogSchema = z.object({
  version: z.literal(1),
  /** When the supplier data was fetched (ISO timestamp). Shown on the site so visitors know how fresh prices are. */
  fetchedAt: z.string(),
  items: z.array(catalogItemSchema),
});

export type CatalogItem = z.infer<typeof catalogItemSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
