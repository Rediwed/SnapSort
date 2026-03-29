/**
 * Stat card with an inline SVG area-sparkline behind the value.
 * Props:
 *   label   – small uppercase heading
 *   value   – large displayed value (string)
 *   data    – array of numbers for the sparkline
 *   variant – colour key: accent | cyan | green | orange | red | pink
 *   sub     – optional smaller text below value
 */
export default function SparklineCard({ label, value, data = [], variant = 'accent', sub }) {
  const color = `var(--${variant})`;
  const fill  = `var(--${variant}-muted)`;

  /* Build SVG path from data */
  const W = 200;
  const H = 60;
  const PAD = 2;

  let path = '';
  let areaPath = '';
  if (data.length > 1) {
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const stepX = (W - PAD * 2) / (data.length - 1);

    const points = data.map((v, i) => ({
      x: PAD + i * stepX,
      y: PAD + (H - PAD * 2) * (1 - (v - min) / range),
    }));

    path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    areaPath = `${path} L${points[points.length - 1].x},${H} L${points[0].x},${H} Z`;
  }

  return (
    <div className={`stat-card ${variant}`} style={{ position: 'relative', overflow: 'hidden', minHeight: 100 }}>
      {/* Sparkline behind content */}
      {data.length > 1 && (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: '60%',
            pointerEvents: 'none',
          }}
        >
          <path d={areaPath} fill={fill} />
          <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      {/* Content on top */}
      <span className="stat-label" style={{ position: 'relative', zIndex: 1 }}>{label}</span>
      <span className="stat-value" style={{ position: 'relative', zIndex: 1 }}>{value}</span>
      {sub && <span className="stat-sub" style={{ position: 'relative', zIndex: 1 }}>{sub}</span>}
    </div>
  );
}
