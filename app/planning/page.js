"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Empty, Kpi, GroupedBars } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { money, moneyShort, currentYear, csvDownload } from "@/lib/format";

export default function PlanningPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [planYear, setPlanYear] = useState(currentYear() + 1);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState([]);
  const [assets, setAssets] = useState([]);
  const [plan, setPlan] = useState([]);
  const [draft, setDraft] = useState({});
  const [draftNotes, setDraftNotes] = useState({});
  const [uplift, setUplift] = useState(10);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, s, a, p] = await Promise.all([
      supabase.from("it_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("v_it_budget_summary").select("*").in("budget_year", [planYear - 1, planYear - 2]),
      supabase.from("it_assets").select("category_id,scope,line_total,license_end,amc_end,replacement_due,status"),
      supabase.from("it_plan_lines").select("*").eq("plan_year", planYear),
    ]);
    setCategories(c.data || []);
    setSummary(s.data || []);
    setAssets(a.data || []);
    setPlan(p.data || []);
    const d = {};
    const dn = {};
    (p.data || []).forEach((r) => {
      d[`${r.category_id}|${r.scope}`] = String(r.planned_amount);
      dn[`${r.category_id}|${r.scope}`] = r.notes || "";
    });
    setDraft(d);
    setDraftNotes(dn);
    setLoading(false);
  }, [planYear]);

  useEffect(() => { load(); }, [load]);

  const commitments = useMemo(() => {
    const m = new Map();
    assets.forEach((a) => {
      if (a.status === "disposed") return;
      const hits = [a.license_end, a.amc_end, a.replacement_due]
        .filter((d) => d && new Date(d + "T00:00:00").getFullYear() === planYear);
      if (!hits.length) return;
      const k = `${a.category_id}|${a.scope}`;
      m.set(k, (m.get(k) || 0) + Number(a.line_total) * hits.length);
    });
    return m;
  }, [assets, planYear]);

  const rows = useMemo(() => {
    const bud = new Map();
    summary.forEach((r) => bud.set(`${r.budget_year}|${r.category_id}|${r.scope}`, r));
    const planMap = new Map(plan.map((p) => [`${p.category_id}|${p.scope}`, p]));

    const out = [];
    categories.forEach((c) => {
      ["local", "global"].forEach((scope) => {
        const key = `${c.id}|${scope}`;
        const cy = bud.get(`${planYear - 1}|${key}`) || {};
        const py = bud.get(`${planYear - 2}|${key}`) || {};
        const committed = commitments.get(key) || 0;
        const lastActual = Number(cy.consumed || 0);
        const suggested = Math.max(committed, Math.round((lastActual * (1 + uplift / 100)) / 500) * 500);
        if (!lastActual && !committed && !Number(cy.budget_amount || 0) && !planMap.get(key)) return;
        out.push({
          key, category_id: c.id, name: c.name, scope,
          prevActual: Number(py.consumed || 0),
          curBudget: Number(cy.budget_amount || 0),
          curActual: lastActual,
          committed, suggested,
          existing: planMap.get(key),
        });
      });
    });
    return out;
  }, [categories, summary, plan, commitments, planYear, uplift]);

  const totals = useMemo(() => {
    const t = { curBudget: 0, curActual: 0, committed: 0, suggested: 0, planned: 0 };
    rows.forEach((r) => {
      t.curBudget += r.curBudget;
      t.curActual += r.curActual;
      t.committed += r.committed;
      t.suggested += r.suggested;
      t.planned += Number(draft[r.key] || 0);
    });
    return t;
  }, [rows, draft]);

  const chartRows = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      const c = m.get(r.name) || { label: r.name, budget: 0, consumed: 0 };
      c.budget += Number(draft[r.key] || 0);
      c.consumed += r.curActual;
      m.set(r.name, c);
    });
    return [...m.values()].filter((r) => r.budget || r.consumed).sort((a, b) => b.budget - a.budget);
  }, [rows, draft]);

  function autofill() {
    const d = { ...draft };
    rows.forEach((r) => { d[r.key] = String(r.suggested); });
    setDraft(d);
    setMsg({ t: "info", m: `Filled from last year's actuals + ${uplift}% uplift, floored at committed renewals. Adjust any line before saving.` });
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const payload = rows.map((r) => ({
      plan_year: planYear, category_id: r.category_id, scope: r.scope,
      planned_amount: Number(draft[r.key] || 0),
      basis: `Prior-year actual ${Math.round(r.curActual)}; committed renewals ${Math.round(r.committed)}`,
      notes: draftNotes[r.key] || null,
    }));
    const { error } = await supabase.from("it_plan_lines").upsert(payload, { onConflict: "plan_year,category_id,scope" });
    setSaving(false);
    setMsg(error ? { t: "err", m: error.message } : { t: "ok", m: `Proposal for ${planYear} saved.` });
    if (!error) load();
  }

  async function promote() {
    if (!confirm(`Copy the ${planYear} proposal into the approved budget for ${planYear}?`)) return;
    const payload = rows.map((r) => ({
      budget_year: planYear, category_id: r.category_id, scope: r.scope,
      amount: Number(draft[r.key] || 0),
      notes: draftNotes[r.key] || `Approved from ${planYear} proposal`,
    }));
    const { error } = await supabase.from("it_budgets").upsert(payload, { onConflict: "budget_year,category_id,scope" });
    setMsg(error ? { t: "err", m: error.message } : { t: "ok", m: `Approved budget for ${planYear} created. See Budget vs Actual.` });
  }

  function exportCsv() {
    csvDownload(`budget-proposal-${planYear}.csv`, rows.map((r) => ({
      plan_year: planYear, category: r.name, scope: r.scope,
      actual_prev: r.prevActual, budget_last: r.curBudget, actual_last: r.curActual,
      committed_renewals: r.committed, suggested: r.suggested, proposed: Number(draft[r.key] || 0),
      remarks: draftNotes[r.key] || r.existing?.notes || "",
    })));
  }

  return (
    <Shell
      title="Next Year Budget"
      subtitle="Build the proposal from actual consumption plus committed renewals and replacements"
      actions={
        <>
          <select value={planYear} onChange={(e) => setPlanYear(Number(e.target.value))} style={{ width: 110 }}>
            {[currentYear() + 2, currentYear() + 1, currentYear()].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn ghost sm" onClick={exportCsv}>Export CSV</button>
          {isAdmin && <button className="btn sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save proposal"}</button>}
        </>
      }
    >
      {msg && <div className={`alert ${msg.t}`}>{msg.m}</div>}
      {!isAdmin && <div className="alert info">Read-only view of the proposal prepared by IT.</div>}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi label={`${planYear - 1} budget`} value={money(totals.curBudget)} />
        <Kpi label={`${planYear - 1} actual`} value={money(totals.curActual)} foot={totals.curBudget ? `${((totals.curActual / totals.curBudget) * 100).toFixed(0)}% utilised` : ""} />
        <Kpi label={`Committed in ${planYear}`} value={money(totals.committed)} foot="Renewals, AMC and replacements already dated" tone="warn" />
        <Kpi label={`Proposed ${planYear}`} value={money(totals.planned)} foot={`Suggested ${moneyShort(totals.suggested)}`} tone="gold" />
      </div>

      <Card
        title={`Proposal for ${planYear}`}
        hint="Suggested = prior-year actual + uplift, never below committed renewals"
        actions={
          isAdmin && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Uplift %</span>
              <input type="number" value={uplift} onChange={(e) => setUplift(Number(e.target.value))} style={{ width: 70, padding: "5px 8px" }} />
              <button className="btn ghost sm" onClick={autofill}>Auto-fill</button>
              <button className="btn ghost sm" onClick={promote}>Approve → budget</button>
            </div>
          )
        }
      >
        {loading ? <div className="loading">Loading…</div> : rows.length === 0 ? (
          <Empty>No history yet. Record some invoices or set a budget first.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th><th>Scope</th>
                  <th className="num">{planYear - 2} actual</th>
                  <th className="num">{planYear - 1} budget</th>
                  <th className="num">{planYear - 1} actual</th>
                  <th className="num">Committed {planYear}</th>
                  <th className="num">Suggested</th>
                  <th className="num">Proposed {planYear}</th>
                  <th className="num">vs last budget</th>
                  <th>Remarks / Justification</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const proposed = Number(draft[r.key] || 0);
                  const delta = proposed - r.curBudget;
                  return (
                    <tr key={r.key}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td><span className={`pill ${r.scope === "global" ? "blue" : "grey"}`}>{r.scope === "global" ? "Global" : "Local"}</span></td>
                      <td className="num mono" style={{ color: "var(--faint)" }}>{money(r.prevActual)}</td>
                      <td className="num mono">{money(r.curBudget)}</td>
                      <td className="num mono">{money(r.curActual)}</td>
                      <td className="num mono" style={{ color: r.committed ? "var(--amber)" : "var(--faint)" }}>{money(r.committed)}</td>
                      <td className="num mono" style={{ color: "var(--muted)" }}>{money(r.suggested)}</td>
                      <td className="num" style={{ minWidth: 120 }}>
                        {isAdmin ? (
                          <input type="number" step="500" className="mono" style={{ textAlign: "right", padding: "6px 8px" }}
                            value={draft[r.key] ?? ""} placeholder="0"
                            onChange={(e) => setDraft({ ...draft, [r.key]: e.target.value })} />
                        ) : money(proposed)}
                      </td>
                      <td className="num mono" style={{ color: delta > 0 ? "var(--amber)" : delta < 0 ? "var(--green)" : "var(--faint)" }}>
                        {delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${moneyShort(delta)}`}
                      </td>
                      <td style={{ minWidth: 180 }}>
                        {isAdmin ? (
                          <input
                            type="text"
                            style={{ padding: "4px 8px", fontSize: 12, width: "100%" }}
                            value={draftNotes[r.key] ?? ""}
                            placeholder="Why added / justification…"
                            onChange={(e) => setDraftNotes({ ...draftNotes, [r.key]: e.target.value })}
                          />
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            {draftNotes[r.key] || r.existing?.notes || "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="2">Total</td>
                  <td className="num mono">{money(rows.reduce((a, r) => a + r.prevActual, 0))}</td>
                  <td className="num mono">{money(totals.curBudget)}</td>
                  <td className="num mono">{money(totals.curActual)}</td>
                  <td className="num mono">{money(totals.committed)}</td>
                  <td className="num mono">{money(totals.suggested)}</td>
                  <td className="num mono" style={{ color: "var(--gold-soft)" }}>{money(totals.planned)}</td>
                  <td className="num mono">{moneyShort(totals.planned - totals.curBudget)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title="Proposal vs last year's actual" hint="Blue = proposed, gold = prior-year actual" style={{ marginTop: 16 }}>
        <GroupedBars rows={chartRows} />
      </Card>
    </Shell>
  );
}
