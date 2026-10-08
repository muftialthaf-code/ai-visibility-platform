export type JsonLd = Record<string, unknown> & { '@type': string };

const CONTEXT = 'https://schema.org';

export interface OrganizationInput {
  name: string;
  url: string;
  description?: string;
  logo?: string;
  /** Use "LocalBusiness" for businesses with a physical location. */
  type?: 'Organization' | 'LocalBusiness';
  sameAs?: string[];
  areaServed?: string[];
}

export function organization(i: OrganizationInput): JsonLd {
  return strip({
    '@context': CONTEXT,
    '@type': i.type ?? 'Organization',
    name: i.name,
    url: i.url,
    description: i.description,
    logo: i.logo,
    sameAs: i.sameAs?.length ? i.sameAs : undefined,
    areaServed: i.areaServed?.length ? i.areaServed : undefined,
  });
}

export function website(i: { name: string; url: string; inLanguage: string }): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'WebSite',
    name: i.name,
    url: i.url,
    inLanguage: i.inLanguage,
  };
}

export function service(i: { name: string; description: string; url: string; providerName: string; areaServed?: string[] }): JsonLd {
  return strip({
    '@context': CONTEXT,
    '@type': 'Service',
    name: i.name,
    description: i.description,
    url: i.url,
    provider: { '@type': 'Organization', name: i.providerName },
    areaServed: i.areaServed?.length ? i.areaServed : undefined,
  });
}

export function faqPage(items: Array<{ question: string; answer: string }>): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: items.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    })),
  };
}

export function breadcrumbs(items: Array<{ name: string; url: string }>): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

export function person(i: { name: string; description?: string; url?: string; worksFor?: string }): JsonLd {
  return strip({
    '@context': CONTEXT,
    '@type': 'Person',
    name: i.name,
    description: i.description,
    url: i.url,
    worksFor: i.worksFor ? { '@type': 'Organization', name: i.worksFor } : undefined,
  });
}

export interface BlogPostingInput {
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified: string;
  inLanguage: string;
  authorName: string;
  authorUrl?: string;
  publisherName: string;
  image?: string;
}

export function blogPosting(i: BlogPostingInput): JsonLd {
  return strip({
    '@context': CONTEXT,
    '@type': 'BlogPosting',
    headline: i.headline,
    description: i.description,
    mainEntityOfPage: i.url,
    url: i.url,
    datePublished: i.datePublished,
    dateModified: i.dateModified,
    inLanguage: i.inLanguage,
    image: i.image,
    author: strip({ '@type': 'Person', name: i.authorName, url: i.authorUrl }),
    publisher: { '@type': 'Organization', name: i.publisherName },
  });
}

/** Serialise for a <script type="application/ld+json"> tag, safe against "</script>" injection. */
export function toScript(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const REQUIRED: Record<string, string[]> = {
  Organization: ['name', 'url'],
  LocalBusiness: ['name', 'url'],
  WebSite: ['name', 'url'],
  Service: ['name', 'description', 'provider'],
  FAQPage: ['mainEntity'],
  BreadcrumbList: ['itemListElement'],
  Person: ['name'],
  BlogPosting: ['headline', 'datePublished', 'author', 'publisher'],
};

/** Minimal structural validation: returns a list of problems (empty means valid). */
export function validateJsonLd(node: JsonLd): string[] {
  const problems: string[] = [];
  if (node['@context'] !== CONTEXT) problems.push('missing or wrong @context');
  const required = REQUIRED[node['@type']];
  if (!required) {
    problems.push(`unknown @type "${node['@type']}"`);
    return problems;
  }
  for (const key of required) {
    const v = node[key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
      problems.push(`${node['@type']}: missing "${key}"`);
    }
  }
  if (node['@type'] === 'FAQPage' && Array.isArray(node.mainEntity)) {
    node.mainEntity.forEach((q: any, i: number) => {
      if (!q?.name || !q?.acceptedAnswer?.text) problems.push(`FAQPage: question ${i + 1} needs a name and answer text`);
    });
  }
  return problems;
}

function strip<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}
