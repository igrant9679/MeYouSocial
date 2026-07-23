/**
 * Server-rendered SVG charts for the dashboard and report. No client library —
 * paths are computed at render time from real rows, motion is CSS-only
 * (`.anim-draw`, `.anim-grow` in globals.css) and collapses under
 * prefers-reduced-motion. Colors come from the app's hue tokens; the
 * blue/teal/amber/violet set passed the CVD-safety validator together.
 */

type Pt = { label: string; value: number };

function scale(points: Pt[], w: number, h: number, padL: number, padB: number, padT: number) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const innerW = w - padL - 8;
  const innerH = h - padT - padB;
  const x = (i: number) => padL + (points.length < 2 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  return { x, y, max, innerH };
}

function fmt(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Area line chart with grid, endpoint label, and per-point hover tooltips. */
export function AreaChart({
  points,
  color,
  title,
  height = 150,
}: {
  points: Pt[];
  color: string;
  title: string;
  height?: number;
}) {
  const w = 460;
  const padL = 34;
  const padB = 18;
  const padT = 14;
  const { x, y, max } = scale(points, w, height, padL, padB, padT);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${height - padB} L${x(0).toFixed(1)} ${height - padB} Z`;
  const last = points[points.length - 1];
  const gridYs = [0.25, 0.6, 1].map((f) => padT + (height - padT - padB) * (1 - f) + (height - padT - padB) * 0);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-auto block" role="img" aria-label={`${title}: latest ${fmt(last?.value ?? 0)}`}>
      {[0.33, 0.66, 1].map((f) => {
        const gy = y(max * f);
        return (
          <g key={f}>
            <line x1={padL} y1={gy} x2={w - 8} y2={gy} stroke="var(--line)" strokeWidth="1" />
            <text x={4} y={gy + 3} fontSize="8" fill="var(--mute)" className="font-mono">{fmt(Math.round(max * f))}</text>
          </g>
        );
      })}
      <text x={x(0) - 6} y={height - 5} fontSize="8" fill="var(--mute)" className="font-mono">{points[0]?.label}</text>
      <text x={x(points.length - 1) - 14} y={height - 5} fontSize="8" fill="var(--mute)" className="font-mono">{last?.label}</text>

      <path d={area} fill={color} opacity="0.10" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" pathLength={1} className="anim-draw" />
      <circle cx={x(points.length - 1)} cy={y(last?.value ?? 0)} r="3.5" fill={color} />
      <text x={Math.min(x(points.length - 1) - 8, w - 42)} y={Math.max(10, y(last?.value ?? 0) - 8)} fontSize="9" fontWeight="700" fill={color} className="font-mono">
        {fmt(last?.value ?? 0)}
      </text>

      {points.map((p, i) => {
        const cx = x(i);
        const cy = y(p.value);
        const tipW = 62;
        const tx = Math.max(padL, Math.min(cx - tipW / 2, w - tipW - 4));
        const ty = cy > 44 ? cy - 34 : cy + 10;
        const bandW = points.length < 2 ? w : (w - padL) / (points.length - 1);
        return (
          <g key={i} className="chart-pt">
            <rect x={cx - bandW / 2} y={padT} width={bandW} height={height - padT - padB} fill="transparent" />
            <circle cx={cx} cy={cy} r="3.5" fill={color} className="chart-dot" />
            <g className="chart-tip">
              <rect x={tx} y={ty} width={tipW} height={20} rx={5} fill="var(--ink)" />
              <text x={tx + tipW / 2} y={ty + 13} textAnchor="middle" fontSize="8.5" fill="var(--bg)" className="font-mono">
                {p.label} · {fmt(p.value)}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** Tiny sparkline for KPI tiles. */
export function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const w = 100;
  const h = 26;
  const max = Math.max(1, ...points);
  const min = Math.min(...points);
  const span = Math.max(1, max - min);
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => 3 + (h - 6) * (1 - (v - min) / span);
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[26px] block mt-1.5" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" pathLength={1} className="anim-draw" />
    </svg>
  );
}

/** Horizontal bar list with grow-in animation and direct value labels. */
export function HBars({ rows }: { rows: Array<{ label: string; value: number; color: string; href?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[96px_1fr_34px] items-center gap-2 text-xs">
          <span className="truncate">{r.label}</span>
          <span className="h-[14px] rounded bg-[var(--panel)] overflow-hidden">
            <span
              className="block h-full rounded anim-grow"
              style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: r.color, animationDelay: `${i * 80}ms` }}
            />
          </span>
          <span className="font-mono font-bold text-right tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
