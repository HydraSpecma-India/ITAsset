"use client";

import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Empty, Kpi } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, dateStr, daysUntil, expiryState, csvDownload } from "@/lib/format";

const TYPES = ["Warranty", "Licence / Subscription", "AMC / Service contract", "Replacement due"];
const WINDOWS = [
  { value: "expired", label: "Already expired" },
  { value: "30", label: "Next 30 days" },
  { value: "90", label: "Next 90 days" },
  { value: "180", label: "Next 6 months" },
  { value: "365", label: "Next 12 months" },
  { value: "all", label: "Everything" },
];

export default function ExpiryPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("all");
  const [win, setWin] = useState("90");
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("v_it_expiry_alerts").select("*").order("expiry_date");
      setRows((data || []).map((r) => ({ ...r, days: daysUntil(r.expiry_date) })));
      setLoading(false);
    })();
  }, []);

  const counts = useMemo(() => ({
    expired: rows.filter((r) => r.days < 0).length,
    d30: rows.filter((r) => r.days >= 0 && r.days <= 30).length,
    d90: rows.filter((r) => r.days > 30 && r.days <= 90).length,
    value: rows.filter((r) => r.days <= 90).reduce((a, r) => a + Number(r.line_total), 0),
  }), [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (type !== "all" && r.alert_type !== type) return false;
      if (win === "expired" && r.days >= 0) return false;
      if (win !== "expired" && win !== "all" && r.days > Number(win)) return false;
      if (!s) return true;
      return [r.asset_name, r.asset_tag, r.serial_no, r.staff_name, r.department, r.location, r.category_name]
        .filter(Boolean).join(" ").toLowerCase().includes(s);
    });
  }, [rows, type, win, q]);

  function exportCsv() {
    csvDownload("expiry-alerts.csv", filtered.map((r) => ({
      alert_type: r.alert_type, expiry_date: r.expiry_date, days_left: r.days,
      asset_name: r.asset_name, asset_tag: r.asset_tag || "", serial_no: r.serial_no || "",
      category: r.category_name, scope: r.scope, staff_name: r.staff_name || "",
      department: r.department || "", location: r.location || "", value: r.line_total,
    })));
  }

  return (
    <Shell
      title="Expiry & Renewals"
      subtitle="Warranty, licence, AMC and replacement dates across the asset base"
      actions={<button className="btn ghost sm" onClick={exportCsv}>Export CSV</button>}
    >
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi label="Already expired" value={counts.expired} tone={counts.expired ? "bad" : "good"} foot="Needs action now" />
        <Kpi label="Expiring in 30 days" value={counts.d30} tone={counts.d30 ? "warn" : "good"} />
        <Kpi label="Expiring in 31–90 days" value={counts.d90} />
        <Kpi label="Asset value at risk" value={money(counts.value)} foot="Items expiring within 90 days" tone="gold" />
      </div>

      <div className="toolbar">
        <div className="field" style={{ minWidth: 260, flex: 1 }}>
          <span className="field-label">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Asset, serial, staff, department…" />
        </div>
        <div className="field">
          <span className="field-label">Alert type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Window</span>
          <select value={win} onChange={(e) => setWin(e.target.value)}>
            {WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </div>
      </div>

      <Card title={`${filtered.length} alert${filtered.length === 1 ? "" : "s"}`}>
        {loading ? <div className="loading">Loading…</div> : filtered.length === 0 ? (
          <Empty>Nothing to renew in this window.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th><th>Type</th><th>Asset</th><th>Category</th>
                  <th>Scope</th><th>Assigned to</th><th>Expiry date</th><th className="num">Asset value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const st = expiryState(r.days);
                  return (
                    <tr key={`${r.asset_id}-${r.alert_type}-${i}`}>
                      <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                      <td style={{ color: "var(--muted)" }}>{r.alert_type}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.asset_name}</div>
                        <div style={{ fontSize: 11, color: "var(--faint)" }}>
                          {[r.asset_tag, r.serial_no].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{r.category_name}</td>
                      <td><span className={`pill ${r.scope === "global" ? "blue" : "grey"}`}>{r.scope === "global" ? "Global" : "Local"}</span></td>
                      <td>
                        <div>{r.staff_name || "—"}</div>
                        <div style={{ fontSize: 11, color: "var(--faint)" }}>{[r.department, r.location].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="mono">{dateStr(r.expiry_date)}</td>
                      <td className="num mono">{money(r.line_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}
