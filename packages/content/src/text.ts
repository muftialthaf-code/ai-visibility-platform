/** Strip Markdown syntax down to the words a reader sees. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ')
    .replace(/[|*_>~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  return plainText(text).toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
}

export const wordCount = (markdown: string) => words(markdown).length;

/** Rough English syllable count, good enough for a readability score. */
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Flesch reading ease (English). Higher is easier: 60 to 70 is plain English, below 30 is very hard. */
export function fleschReadingEase(markdown: string): number {
  const text = plainText(markdown);
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const ws = text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (ws.length === 0) return 0;
  const syl = ws.reduce((n, w) => n + syllables(w), 0);
  return Math.round((206.835 - 1.015 * (ws.length / sentences) - 84.6 * (syl / ws.length)) * 10) / 10;
}

export function shingles(text: string, n = 3): Set<string> {
  const ws = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(' '));
  return out;
}

/** How much two texts overlap, 0 to 1. Jaccard on word shingles: 1 is identical, near 0 is unrelated. */
export function jaccard(a: string, b: string, n = 3): number {
  const A = shingles(a, n);
  const B = shingles(b, n);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Share of `text`'s shingles that also appear in `reference`. Catches a short text lifted from a long one. */
export function containment(text: string, reference: string, n = 3): number {
  const A = shingles(text, n);
  const R = shingles(reference, n);
  if (A.size === 0) return 0;
  let inter = 0;
  for (const s of A) if (R.has(s)) inter++;
  return inter / A.size;
}

/** Longest run of consecutive words that two texts share. Used to catch copied passages. */
export function longestSharedRun(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.length === 0 || B.length === 0) return 0;
  let best = 0;
  let prev = new Array<number>(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    const cur = new Array<number>(B.length + 1).fill(0);
    for (let j = 1; j <= B.length; j++) {
      if (A[i - 1] === B[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) best = cur[j]!;
      }
    }
    prev = cur;
  }
  return best;
}

export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

/** Line diff by longest common subsequence. Fine for article-sized files. */
export function lineDiff(before: string, after: string): DiffOp[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) ops.push({ type: 'del', text: a[i++]! });
    else ops.push({ type: 'add', text: b[j++]! });
  }
  while (i < a.length) ops.push({ type: 'del', text: a[i++]! });
  while (j < b.length) ops.push({ type: 'add', text: b[j++]! });
  return ops;
}

/** Numbers and percentages that appear in prose, so each can be checked against a cited claim. */
export function extractNumbers(markdown: string): string[] {
  const text = plainText(markdown);
  const found = text.match(/\b\d[\d,.]*\s?(%|percent|million|billion|thousand|k\b|x\b)?/gi) ?? [];
  return [...new Set(found.map((s) => s.trim().replace(/[.,]$/, '')))].filter((s) => s.length > 0);
}
