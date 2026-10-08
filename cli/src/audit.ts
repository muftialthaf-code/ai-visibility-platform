import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AI_CRAWLERS, validateJsonLd, type JsonLd } from '@avp/seo';

/** Audit a built tenant site for the AEO/GEO technical requirements. Returns a list of problems. */
export function auditSite(dir: string): string[] {
  const problems: string[] = [];
  const fail = (file: string, msg: string) => problems.push(`${file}: ${msg}`);

  const htmlFiles = walk(dir).filter((f) => f.endsWith('.html'));
  if (htmlFiles.length === 0) return [`${dir}: no HTML files found (was the site built?)`];

  for (const file of htmlFiles) {
    const name = relative(dir, file);
    const html = readFileSync(file, 'utf8');
    const attr = (re: RegExp) => re.exec(html)?.[1];

    const lang = attr(/<html[^>]*\blang="([^"]+)"/);
    const dirAttr = attr(/<html[^>]*\bdir="([^"]+)"/);
    if (!lang) fail(name, 'missing <html lang>');
    if (lang === 'ar' && dirAttr !== 'rtl') fail(name, 'Arabic page is not dir="rtl"');
    if (!attr(/<title>([^<]+)<\/title>/)) fail(name, 'missing <title>');
    if (!attr(/<meta name="description" content="([^"]+)"/)) fail(name, 'missing meta description');
    if (!attr(/<link rel="canonical" href="([^"]+)"/)) fail(name, 'missing canonical link');
    if (!attr(/<meta property="og:title" content="([^"]+)"/)) fail(name, 'missing Open Graph title');
    if (!attr(/<meta name="twitter:card" content="([^"]+)"/)) fail(name, 'missing Twitter card');

    const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
    if (h1s !== 1) fail(name, `expected exactly one <h1>, found ${h1s}`);

    const headings = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    for (let i = 1; i < headings.length; i++) {
      if (headings[i]! - headings[i - 1]! > 1) fail(name, `heading level jumps from h${headings[i - 1]} to h${headings[i]}`);
    }

    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        const data = JSON.parse(m[1]!) as JsonLd;
        for (const p of validateJsonLd(data)) fail(name, `JSON-LD ${p}`);
      } catch {
        fail(name, 'JSON-LD is not valid JSON');
      }
    }
  }

  // Alternates must be reciprocal: every hreflang target page must exist in the build.
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<link rel="alternate" hreflang="[^"]+" href="https?:\/\/[^/"]+([^"]*)"/g)) {
      const target = join(dir, m[1]!, m[1]!.endsWith('/') ? 'index.html' : '');
      if (!existsSync(target)) fail(relative(dir, file), `hreflang points at a page that was not built: ${m[1]}`);
    }
  }

  const need = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : (fail(f, 'missing'), ''));
  const robots = need('robots.txt');
  if (robots && !/^User-agent: \*\s*\nDisallow: \/\s*$/m.test(robots)) {
    for (const bot of AI_CRAWLERS) if (!robots.includes(`User-agent: ${bot}`)) fail('robots.txt', `does not mention ${bot}`);
    if (!/^Sitemap: /m.test(robots)) fail('robots.txt', 'missing Sitemap line');
  }
  const llms = need('llms.txt');
  if (llms && !/^# .+\n\n> .+/.test(llms)) fail('llms.txt', 'does not start with "# Name" and a "> summary" line');
  need('rss.xml');

  const sitemap = need('sitemap.xml');
  for (const m of sitemap.matchAll(/<loc>https?:\/\/[^/<]+([^<]*)<\/loc>/g)) {
    if (!existsSync(join(dir, m[1]!, 'index.html'))) fail('sitemap.xml', `lists a page that was not built: ${m[1]}`);
  }

  return problems;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
