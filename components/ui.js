"use client";

import { moneyShort, money } from "@/lib/format";

export function Card({ title, hint, actions, children, style }) {
  return (
    <section className="card" style={style}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {actions}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Kpi({ label, value, foot, tone, onClick }) {
  const colors = { good: "var(--green)", warn: "var(--amber)", bad: "var(--red)", gold: "var(--gold-soft)" };
  return (
    <div
      className="card kpi"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default", transition: "transform 0.15s, border-color 0.15s" }}
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: colors[tone] || "var(--text)" }}>{value}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card modal ${wide ? "" : "narrow"}`}>
        <div className="card-head">
          <h3>{title}</h3>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        <div className="card-body">{children}</div>
      </div>
    </div>
  );
}

export function Progress({ pct, tone }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const color = tone || (p > 100 ? "var(--red)" : p >= 90 ? "var(--amber)" : "var(--green)");
  return (
    <div className="bar" title={`${p.toFixed(0)}%`}>
      <span style={{ width: `${Math.min(p, 100)}%`, background: color }} />
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/* ---------------------------------------------------------- charts */

export function GroupedBars({ rows, height = 240, onBarClick }) {
  if (!rows.length) return <Empty>No budget lines yet.</Empty>;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.budget, r.consumed)));
  const rowH = 26;
  const h = rows.length * rowH + 16;
  const labelW = 168;

  return (
    <div>
      <div className="legend" style={{ marginBottom: 10 }}>
        <span><i style={{ background: "var(--blue)" }} />Budget / Proposed</span>
        <span><i style={{ background: "var(--gold)" }} />Consumed / Actual</span>
        {onBarClick && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--gold)" }}>💡 Click any bar for details</span>}
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto", overflowX: "auto" }}>
        <svg width="100%" height={h} viewBox={`0 0 700 ${h}`} style={{ minWidth: 560 }} role="img">
          {rows.map((r, i) => {
            const y = i * rowH + 4;
            const barW = 700 - labelW - 92;
            const bw = (r.budget / max) * barW;
            const cw = (r.consumed / max) * barW;
            const over = r.consumed > r.budget;
            return (
              <g key={i} onClick={() => onBarClick && onBarClick(r)} style={{ cursor: onBarClick ? "pointer" : "default" }}>
                <text x="0" y={y + 11} fill="var(--muted)" fontSize="11" fontFamily="var(--font-body)">
                  {r.label.length > 24 ? r.label.slice(0, 23) + "…" : r.label}
                </text>
                <rect x={labelW} y={y + 2} width={Math.max(bw, 1)} height="7" rx="2" fill="var(--blue)" opacity="0.65" />
                <rect x={labelW} y={y + 11} width={Math.max(cw, 1)} height="7" rx="2" fill={over ? "var(--red)" : "var(--gold)"} />
                <text x={labelW + Math.max(bw, cw) + 8} y={y + 13} fill="var(--faint)" fontSize="10" fontFamily="var(--font-mono)">
                  {moneyShort(r.consumed)} / {moneyShort(r.budget)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function Columns({ data, height = 210, color = "var(--gold)", onColClick }) {
  // data: [{ label, value }]
  if (!data.length) return <Empty>No spend recorded yet.</Empty>;
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = Math.max(560, data.length * 56);
  const padB = 34;
  const usable = height - padB - 18;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width="100%" viewBox={`0 0 ${w} ${height}`} style={{ minWidth: 520 }} role="img">
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1="0" x2={w} y1={18 + usable * (1 - f)} y2={18 + usable * (1 - f)} stroke="rgba(255,255,255,.07)" />
        ))}
        {data.map((d, i) => {
          const bw = w / data.length;
          const bh = (d.value / max) * usable;
          const x = i * bw + bw * 0.22;
          const y = 18 + usable - bh;
          return (
            <g key={i} onClick={() => onColClick && onColClick(d, i)} style={{ cursor: onColClick ? "pointer" : "default" }}>
              <rect x={x} y={y} width={bw * 0.56} height={Math.max(bh, 1)} rx="3" fill={color} opacity="0.9" />
              <text x={x + bw * 0.28} y={y - 5} textAnchor="middle" fill="var(--faint)" fontSize="10" fontFamily="var(--font-mono)">
                {d.value ? moneyShort(d.value) : ""}
              </text>
              <text x={x + bw * 0.28} y={height - 12} textAnchor="middle" fill="var(--muted)" fontSize="11">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Donut({ slices, total, caption, onSliceClick }) {
  const palette = ["#d4a437", "#4d94d1", "#3fbf8f", "#9b7fd4", "#e8a33d", "#e2604f", "#5fb8c9", "#c98fb0"];
  const sum = slices.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0;
  const R = 62, C = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="20" />
        {slices.map((s, i) => {
          const frac = s.value / sum;
          const dash = `${frac * C} ${C}`;
          const el = (
            <circle key={i} cx="80" cy="80" r={R} fill="none" stroke={palette[i % palette.length]}
              strokeWidth="20" strokeDasharray={dash} strokeDashoffset={-acc * C}
              transform="rotate(-90 80 80)" style={{ cursor: onSliceClick ? "pointer" : "default" }}
              onClick={() => onSliceClick && onSliceClick(s)} />
          );
          acc += frac;
          return el;
        })}
        <text x="80" y="76" textAnchor="middle" fill="var(--muted)" fontSize="10" letterSpacing="1.4">TOTAL</text>
        <text x="80" y="94" textAnchor="middle" fill="var(--text)" fontSize="15" fontFamily="var(--font-mono)">
          {moneyShort(total ?? sum)}
        </text>
      </svg>
      <div style={{ display: "grid", gap: 6, minWidth: 180, flex: 1 }}>
        {slices.map((s, i) => (
          <div key={i} onClick={() => onSliceClick && onSliceClick(s)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: onSliceClick ? "pointer" : "default" }}>
            <i style={{ width: 9, height: 9, borderRadius: 3, background: palette[i % palette.length] }} />
            <span style={{ flex: 1, color: "var(--muted)" }}>{s.label}</span>
            <span className="mono" style={{ color: "var(--text)" }}>{money(s.value)}</span>
          </div>
        ))}
        {caption && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 4 }}>{caption}</div>}
      </div>
    </div>
  );
}
