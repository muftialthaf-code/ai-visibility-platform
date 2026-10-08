import type { ResearchPack, ReviewData } from './types.ts';

/**
 * Rebuild enough of the research for a revision from what the pull request stores: the sources and each
 * claim's wording. The original notes are not stored, so the claims stand in as the evidence.
 */
export function researchPackFromReview(review: ReviewData): ResearchPack {
  const facts = Object.values(review.claims ?? {})
    .flat()
    .map((c) => ({ claim: c.text, sourceUrl: c.sourceUrl, quote: c.text }));
  const seen = new Set<string>();
  const unique = facts.filter((f) => (seen.has(f.claim + f.sourceUrl) ? false : (seen.add(f.claim + f.sourceUrl), true)));
  return { notes: unique.map((f) => f.claim).join('\n'), facts: unique, sources: review.sources };
}
