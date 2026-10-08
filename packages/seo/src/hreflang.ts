export interface LocaleInfo {
  default: string;
  supported: string[];
}

const RTL = new Set(['ar', 'he', 'fa', 'ur']);

export function direction(lang: string): 'rtl' | 'ltr' {
  return RTL.has(lang.split('-')[0]!) ? 'rtl' : 'ltr';
}

/** Path for a language: the default language lives at the root, others under /<lang>. */
export function localizedPath(path: string, lang: string, locales: LocaleInfo): string {
  const clean = '/' + path.replace(/^\/+|\/+$/g, '');
  const base = clean === '/' ? '' : clean;
  const prefix = lang === locales.default ? '' : `/${lang}`;
  const out = `${prefix}${base}` || '/';
  return out === '/' ? '/' : `${out}/`;
}

export function absoluteUrl(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface Alternate {
  hreflang: string;
  href: string;
}

/** hreflang alternates for one page (path given without any language prefix), including x-default. */
export function hreflangAlternates(siteUrl: string, path: string, locales: LocaleInfo): Alternate[] {
  const links: Alternate[] = locales.supported.map((lang) => ({
    hreflang: lang,
    href: absoluteUrl(siteUrl, localizedPath(path, lang, locales)),
  }));
  if (locales.supported.length > 1) {
    links.push({ hreflang: 'x-default', href: absoluteUrl(siteUrl, localizedPath(path, locales.default, locales)) });
  }
  return links;
}
