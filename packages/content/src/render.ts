import { Marked } from 'marked';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_LINK = /^(https?:|mailto:|\/|#)/i;

/**
 * Markdown to HTML for content that came from an AI model or a web search. Raw HTML in the
 * source is shown as text, links are limited to http(s), mailto and relative paths, and external
 * links carry rel="noopener nofollow". The output is safe to inject into a page.
 */
const md = new Marked({
  gfm: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (!SAFE_LINK.test(href.trim())) return inner;
      const external = /^https?:/i.test(href);
      return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' rel="noopener nofollow"' : ''}>${inner}</a>`;
    },
    image({ href, text }) {
      // Remote images are not allowed: they can leak visitors' addresses and are rarely licensed.
      return text ? escapeHtml(text) : '';
    },
  },
});

export function renderMarkdownSafe(source: string): string {
  const html = md.parse(source, { async: false }) as string;
  // A "# Heading" in content must not create a second <h1>: the page template owns the only one.
  return html.replace(/<(\/?)h1(?=[\s>])/g, '<$1h2');
}
