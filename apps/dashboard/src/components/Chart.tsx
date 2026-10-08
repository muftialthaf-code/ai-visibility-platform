import type { Point } from '@/lib/reports';

const COLORS = ['var(--brand)', 'var(--ok)', 'var(--warn)', '#8a5cf6'];

/** A simple line chart of weekly percentages, drawn as SVG on the server. The data is also in the table under it. */
export function TrendChart({ lines, title }: { lines: Array<{ name: string; points: Point[] }>; title: string }) {
  const weeks = [...new Set(lines.flatMap((l) => l.points.map((p) => p.week)))].sort();
  if (weeks.length === 0) return <p className="muted">No measurements yet.</p>;
  const W = 640, H = 220, L = 38, R = 12, T = 12, B = 28;
  const x = (i: number) => (weeks.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (weeks.length - 1));
  const y = (v: number) => T + (1 - v) * (H - T - B);
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto', maxWidth: W }}>
        <title>{title}</title>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth="1" />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(g * 100)}%</text>
          </g>
        ))}
        {weeks.map((w, i) => (i % Math.ceil(weeks.length / 6) === 0 ? <text key={w} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{w.slice(5)}</text> : null))}
        {lines.map((l, li) => {
          const pts = l.points.map((p) => ({ i: weeks.indexOf(p.week), v: p.mentioned })).filter((p): p is { i: number; v: number } => p.v !== null);
          return (
            <g key={l.name} stroke={COLORS[li % COLORS.length]} fill={COLORS[li % COLORS.length]}>
              <polyline fill="none" strokeWidth="2.5" points={pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')} />
              {pts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="3.5" />)}
            </g>
          );
        })}
      </svg>
      <figcaption className="row small">
        {lines.map((l, li) => <span key={l.name}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: COLORS[li % COLORS.length], marginInlineEnd: 4 }} />{l.name}</span>)}
      </figcaption>
    </figure>
  );
}
