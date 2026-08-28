"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Empty, Kpi, GroupedBars } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { useDept } from "@/lib/department";
import { money, moneyShort, currentYear, csvDownload } from "@/lib/format";

export default function PlanningPage() {
  const { dept, isDeptAdmin } = useDept();
  const isAdmin = isDeptAdmin;
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
    if (!profile) return;

    const activeDept = dept || profile?.department || "IT";

    setLoading(true);
    let catQuery = supabase.from("it_categories").select("*").eq("is_active", true).order("sort_order");
    let planQuery = supabase.from("it_plan_lines").select("*").eq("plan_year", planYear);
    let assetQuery = supabase.from("it_assets").select("category_id,scope,line_total,department,license_end,amc_end,replacement_due,status");

    if (activeDept && activeDept !== "All") {
      if (activeDept === "IT") {
        catQuery = catQuery.or("budget_department.eq.IT,budget_department.is.null");
        planQuery = planQuery.or("budget_department.eq.IT,budget_department.is.null");
        assetQuery = assetQuery.or("budget_department.eq.IT,budget_department.is.null");
      } else {
        catQuery = catQuery.eq("budget_department", activeDept);
        planQuery = planQuery.eq("budget_department", activeDept);
        assetQuery = assetQuery.eq("budget_department", activeDept);
      }
    }

    const [c, s, a, p] = await Promise.all([
      catQuery,
      supabase.from("v_it_budget_summary").select("*").in("budget_year", [planYear - 1, planYear - 2]),
      assetQuery,
      planQuery,
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
  }, [planYear, dept, profile]);

  useEffect(() => {
    if (profile) load();
  }, [profile, load]);

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
          key, category_id: c.id, name: c.name, category_type: c.category_type || "capex", scope,
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

  const capexRows = useMemo(() => rows.filter((r) => (r.category_type || "capex") !== "opex"), [rows]);
  const opexRows = useMemo(() => rows.filter((r) => (r.category_type || "capex") === "opex"), [rows]);

  const totals = useMemo(() => {
    const t = {
      curBudget: 0, curActual: 0, committed: 0, suggested: 0, planned: 0,
      capexCurBudget: 0, capexCurActual: 0, capexPlanned: 0, capexSuggested: 0, capexCommitted: 0, capexPrevActual: 0,
      opexCurBudget: 0, opexCurActual: 0, opexPlanned: 0, opexSuggested: 0, opexCommitted: 0, opexPrevActual: 0,
    };
    rows.forEach((r) => {
      const planAmt = Number(draft[r.key] || 0);
      t.curBudget += r.curBudget;
      t.curActual += r.curActual;
      t.committed += r.committed;
      t.suggested += r.suggested;
      t.planned += planAmt;

      if ((r.category_type || "capex") === "opex") {
        t.opexCurBudget += r.curBudget;
        t.opexCurActual += r.curActual;
        t.opexPlanned += planAmt;
        t.opexSuggested += r.suggested;
        t.opexCommitted += r.committed;
        t.opexPrevActual += r.prevActual;
      } else {
        t.capexCurBudget += r.curBudget;
        t.capexCurActual += r.curActual;
        t.capexPlanned += planAmt;
        t.capexSuggested += r.suggested;
        t.capexCommitted += r.committed;
        t.capexPrevActual += r.prevActual;
      }
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
    const targetDept = dept === "All" ? "IT" : dept;
    const payload = rows.map((r) => ({
      plan_year: planYear, category_id: r.category_id, scope: r.scope,
      planned_amount: Number(draft[r.key] || 0),
      basis: `Prior-year actual ${Math.round(r.curActual)}; committed renewals ${Math.round(r.committed)}`,
      notes: draftNotes[r.key] || null,
      budget_department: targetDept,
    }));
    const { error } = await supabase.from("it_plan_lines").upsert(payload, { onConflict: "plan_year,category_id,scope,budget_department" });
    setSaving(false);
    setMsg(error ? { t: "err", m: error.message } : { t: "ok", m: `Proposal for ${planYear} saved.` });
    if (!error) load();
  }

  async function promote() {
    if (!confirm(`Copy the ${planYear} proposal into the approved budget for ${planYear}?`)) return;
    const targetDept = dept === "All" ? "IT" : dept;
    const payload = rows.map((r) => ({
      budget_year: planYear, category_id: r.category_id, scope: r.scope,
      amount: Number(draft[r.key] || 0),
      notes: draftNotes[r.key] || `Approved from ${planYear} proposal`,
      budget_department: targetDept,
    }));
    const { error } = await supabase.from("it_budgets").upsert(payload, { onConflict: "budget_year,category_id,scope,budget_department" });
    setMsg(error ? { t: "err", m: error.message } : { t: "ok", m: `Approved budget for ${planYear} created. See Budget vs Actual.` });
  }

  function exportCsv() {
    csvDownload(`budget-proposal-${planYear}.csv`, rows.map((r) => ({
      plan_year: planYear, category: r.name, type: (r.category_type || "capex").toUpperCase(), scope: r.scope,
      actual_prev: r.prevActual, budget_last: r.curBudget, actual_last: r.curActual,
      committed_renewals: r.committed, suggested: r.suggested, proposed: Number(draft[r.key] || 0),
      remarks: draftNotes[r.key] || r.existing?.notes || "",
    })));
  }

  const renderTableSection = (sectionRows, sectionTotals, title, typeBadge) => (
    <Card
      title={`${typeBadge} ${title} for ${planYear}`}
      hint="Suggested = prior-year actual + uplift, floored at committed renewals"
    >
      {sectionRows.length === 0 ? (
        <Empty>No items recorded in this category type.</Empty>
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
              {sectionRows.map((r) => {
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
                <td colSpan="2">Subtotal</td>
                <td className="num mono">{money(sectionTotals.prevActual)}</td>
                <td className="num mono">{money(sectionTotals.curBudget)}</td>
                <td className="num mono">{money(sectionTotals.curActual)}</td>
                <td className="num mono">{money(sectionTotals.committed)}</td>
                <td className="num mono">{money(sectionTotals.suggested)}</td>
                <td className="num mono" style={{ color: "var(--gold-soft)" }}>{money(sectionTotals.planned)}</td>
                <td className="num mono">{moneyShort(sectionTotals.planned - sectionTotals.curBudget)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <Shell
      title="Next Year Budget"
      subtitle={`${dept === "All" ? "All Departments" : dept} budget proposal built from actual consumption plus committed renewals`}
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div style={{ padding: 14, background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.3)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase" }}>CapEx Proposed {planYear}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }} className="mono">{money(totals.capexPlanned)}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Suggested: {moneyShort(totals.capexSuggested)}</div>
        </div>
        <div style={{ padding: 14, background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--amber)", textTransform: "uppercase" }}>OpEx Proposed {planYear}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }} className="mono">{money(totals.opexPlanned)}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Suggested: {moneyShort(totals.opexSuggested)}</div>
        </div>
        <div style={{ padding: 14, background: "rgba(234,179,8,0.12)", border: "1px solid var(--gold)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--gold)", textTransform: "uppercase" }}>Total Proposed {planYear}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: "var(--gold)" }} className="mono">{money(totals.planned)}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>Last Budget: {moneyShort(totals.curBudget)}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Budget Proposal Breakdown by Category</h3>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--faint)" }}>Uplift %</span>
            <input type="number" value={uplift} onChange={(e) => setUplift(Number(e.target.value))} style={{ width: 70, padding: "5px 8px" }} />
            <button className="btn ghost sm" onClick={autofill}>Auto-fill</button>
            <button className="btn ghost sm" onClick={promote}>Approve → budget</button>
          </div>
        )}
      </div>

      {loading ? <div className="loading">Loading…</div> : (
        <div className="stack" style={{ gap: 20 }}>
          {renderTableSection(capexRows, {
            prevActual: totals.capexPrevActual, curBudget: totals.capexCurBudget, curActual: totals.capexCurActual,
            committed: totals.capexCommitted, suggested: totals.capexSuggested, planned: totals.capexPlanned
          }, "CapEx (Capital Expenditure)", "📦")}

          {renderTableSection(opexRows, {
            prevActual: totals.opexPrevActual, curBudget: totals.opexCurBudget, curActual: totals.opexCurActual,
            committed: totals.opexCommitted, suggested: totals.opexSuggested, planned: totals.opexPlanned
          }, "OpEx (Operating Expenditure)", "🔄")}
        </div>
      )}

      <Card title="Proposal vs last year's actual" hint="Blue = proposed, gold = prior-year actual" style={{ marginTop: 20 }}>
        <GroupedBars rows={chartRows} />
      </Card>
    </Shell>
  );
}
