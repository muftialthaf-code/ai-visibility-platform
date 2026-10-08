import { describe, expect, it } from 'vitest';
import {
  articlePath, containment, extractNumbers, fleschReadingEase, jaccard, lineDiff, longestSharedRun, parseArticle,
  renderMarkdownSafe, serializeArticle, wordCount,
} from './index.ts';

const sample = `---
title: How do I choose an eSIM?
description: A short guide.
slug: how-do-i-choose-an-esim
datePublished: 2026-10-01
dateModified: 2026-10-02
takeaways:
  - Check your phone first
faq:
  - question: What is an eSIM?
    answer: A SIM built into the phone.
sources:
  - title: Example
    url: https://example.com/a
    date: 2026-09-30
---

Start with your phone. Most new models support eSIM.

## Which phones work?

Check settings.
`;

describe('articles', () => {
  it('parses frontmatter and body, including YAML dates', () => {
    const a = parseArticle(sample);
    expect(a.title).toBe('How do I choose an eSIM?');
    expect(a.datePublished).toBe('2026-10-01');
    expect(a.faq[0]).toEqual({ question: 'What is an eSIM?', answer: 'A SIM built into the phone.' });
    expect(a.sources[0]?.date).toBe('2026-09-30');
    expect(a.body.startsWith('Start with your phone.')).toBe(true);
  });

  it('round-trips through serialize and parse without changing anything', () => {
    const a = parseArticle(sample);
    expect(parseArticle(serializeArticle(a))).toEqual(a);
    expect(serializeArticle(parseArticle(serializeArticle(a)))).toBe(serializeArticle(a));
  });

  it('reports which field is wrong', () => {
    expect(() => parseArticle('---\ntitle: x\n---\nbody')).toThrow(/description|slug/);
    expect(() => parseArticle(sample.replace('slug: how-do-i-choose-an-esim', 'slug: Bad Slug'))).toThrow(/slug/);
    expect(() => parseArticle(sample.replace('https://example.com/a', 'ftp://x'))).toThrow(/sources/);
  });

  it('builds article paths', () => expect(articlePath('acme', 'ar', 'x')).toBe('tenants/acme/articles/ar/x.md'));
});

describe('renderMarkdownSafe', () => {
  it('escapes raw HTML and script tags', () => {
    const html = renderMarkdownSafe('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
  it('drops javascript: links but keeps the text, and marks external links', () => {
    const html = renderMarkdownSafe('[bad](javascript:alert(1)) and [ok](https://example.com/x) and [rel](/about/)');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('bad');
    expect(html).toContain('<a href="https://example.com/x" rel="noopener nofollow">ok</a>');
    expect(html).toContain('<a href="/about/">rel</a>');
  });
  it('never emits an h1 and drops remote images', () => {
    const html = renderMarkdownSafe('# Title\n\n![alt text](https://evil.test/p.png)');
    expect(html).not.toContain('<h1');
    expect(html).toContain('<h2');
    expect(html).not.toContain('<img');
    expect(html).toContain('alt text');
  });
});

describe('text measures', () => {
  it('counts words ignoring markdown syntax', () => {
    expect(wordCount('# Title\n\n- one two\n- **three** [four](https://x.test)\n')).toBe(5);
  });
  it('scores simple text as easier than dense text', () => {
    const easy = 'The cat sat on the mat. It was a sunny day. We like to play.';
    const hard = 'Notwithstanding considerable organisational heterogeneity, institutional stakeholders systematically underestimate implementation complexity.';
    expect(fleschReadingEase(easy)).toBeGreaterThan(80);
    expect(fleschReadingEase(hard)).toBeLessThan(20);
  });
  it('measures overlap: identical, partial, unrelated', () => {
    const a = 'one two three four five six seven eight nine ten';
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, 'alpha beta gamma delta epsilon zeta eta theta')).toBe(0);
    expect(containment('four five six seven', a)).toBe(1);
    expect(containment(a, 'four five six seven')).toBeLessThan(0.5);
  });
  it('finds the longest copied run', () => {
    expect(longestSharedRun('we say that the quick brown fox jumps high today', 'they said the quick brown fox jumps over')).toBe(5);
    expect(longestSharedRun('', 'x')).toBe(0);
  });
  it('extracts numbers worth checking', () => {
    expect(extractNumbers('Sales grew 45% to 3.2 million in 2025.')).toEqual(expect.arrayContaining(['45%', '3.2 million', '2025']));
  });
  it('diffs lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'c' },
    ]);
    expect(lineDiff('same', 'same').every((o) => o.type === 'same')).toBe(true);
  });
});
