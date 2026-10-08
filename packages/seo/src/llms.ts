export interface LlmsSection {
  title: string;
  links: Array<{ title: string; url: string; note?: string }>;
}

export interface LlmsInput {
  name: string;
  summary: string;
  details?: string;
  sections: LlmsSection[];
}

/** Build an llms.txt following the llmstxt.org format: H1, blockquote summary, then link sections. */
export function buildLlmsTxt(i: LlmsInput): string {
  const out: string[] = [`# ${i.name}`, '', `> ${i.summary}`, ''];
  if (i.details) out.push(i.details, '');
  for (const section of i.sections) {
    if (section.links.length === 0) continue;
    out.push(`## ${section.title}`, '');
    for (const l of section.links) out.push(`- [${l.title}](${l.url})${l.note ? `: ${l.note}` : ''}`);
    out.push('');
  }
  return out.join('\n').trimEnd() + '\n';
}

export interface LlmsFullPage {
  title: string;
  url: string;
  body: string;
}

/** Optional llms-full.txt: all key pages concatenated as plain text. */
export function buildLlmsFullTxt(i: { name: string; summary: string; pages: LlmsFullPage[] }): string {
  const out = [`# ${i.name}`, '', `> ${i.summary}`, ''];
  for (const p of i.pages) out.push(`## ${p.title}`, '', `Source: ${p.url}`, '', p.body.trim(), '');
  return out.join('\n').trimEnd() + '\n';
}
