"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Progress, Empty } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { money, currentYear, csvDownload } from "@/lib/format";

function isIncludedInBudget(a) {
  if (a.remarks && a.remarks.includes("[INCLUDED_IN_IT_BUDGET]")) return true;
  if (a.remarks && a.remarks.includes("[EXCLUDED_FROM_BUDGET]")) return false;
  if (a.include_in_budget === false) return false;
  const catName = (a.it_categories?.name || "").toLowerCase();
  if (catName.includes("mobile") || catName.includes("tablet")) return false;
  return true;
}

export default function BudgetsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [year, setYear] = useState(currentYear());
  const [categories, setCategories] = useState([]);
  const [rows, setRows] = useState([]);
  const [assets, setAssets] = useState([]);
  const [draft, setDraft] = useState({});
  const [draftNotes, setDraftNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, s, a] = await Promise.all([
      supabase.from("it_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("it_budgets").select("*").eq("budget_year", year),
      supabase.from("it_assets").select("line_total,scope,category_id,remarks,it_categories(name)").eq("budget_year", year),
    ]);
    setCategories(c.data || []);
    setRows(s.data || []);
    setAssets(a.data || []);
    const d = {};
    const dn = {};
    (s.data || []).forEach((r) => {
      d[`${r.category_id}|${r.scope}`] = String(r.amount);
      dn[`${r.category_id}|${r.scope}`] = r.notes || "";
    });
    setDraft(d);
    setDraftNotes(dn);
    setLoading(false);
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => {
    const budgetMap = new Map();
    const notesMap = new Map();
    rows.forEach((r) => {
      budgetMap.set(`${r.category_id}|${r.scope}`, Number(r.amount || 0));
      notesMap.set(`${r.category_id}|${r.scope}`, r.notes || "");
    });

    const consumedMap = new Map();
    assets.filter(isIncludedInBudget).forEach((a) => {
      const k = `${a.category_id}|${a.scope}`;
      consumedMap.set(k, (consumedMap.get(k) || 0) + Number(a.line_total || 0));
    });

    return categories.map((c) => {
      const lb = budgetMap.get(`${c.id}|local`) || 0;
      const lc = consumedMap.get(`${c.id}|local`) || 0;
      const ln = notesMap.get(`${c.id}|local`) || "";
      const gb = budgetMap.get(`${c.id}|global`) || 0;
      const gc = consumedMap.get(`${c.id}|global`) || 0;
      const gn = notesMap.get(`${c.id}|global`) || "";
      return {
        id: c.id, name: c.name,
        local: { budget: lb, consumed: lc, notes: ln },
        global: { budget: gb, consumed: gc, notes: gn },
      };
    });
  }, [categories, rows, assets]);

  const totals = useMemo(() => {
    const t = { lb: 0, lc: 0, gb: 0, gc: 0 };
    view.forEach((v) => {
      t.lb += v.local.budget; t.lc += v.local.consumed;
      t.gb += v.global.budget; t.gc += v.global.consumed;
    });
    return t;
  }, [view]);

  async function save() {
    setSaving(true);
    setMsg(null);
    const payload = [];
    categories.forEach((c) => {
      ["local", "global"].forEach((scope) => {
        const key = `${c.id}|${scope}`;
        const raw = draft[key];
        const notesVal = draftNotes[key] || null;
        const amount = Number(raw || 0);
        if (!raw && !notesVal && !rows.find((r) => `${r.category_id}|${r.scope}` === key && Number(r.amount) > 0)) return;
        payload.push({ budget_year: year, category_id: c.id, scope, amount: isNaN(amount) ? 0 : amount, notes: notesVal });
      });
    });
    const { error } = await supabase.from("it_budgets").upsert(payload, { onConflict: "budget_year,category_id,scope" });
    setSaving(false);
    setMsg(error ? { t: "err", m: error.message } : { t: "ok", m: `Budget and remarks for ${year} saved.` });
    if (!error) load();
  }

  function exportCsv() {
    csvDownload(`budget-vs-actual-${year}.csv`, view.flatMap((v) => ["local", "global"].map((s) => ({
      year, category: v.name, scope: s,
      budget: v[s].budget, consumed: v[s].consumed, balance: v[s].budget - v[s].consumed,
      remarks: draftNotes[`${v.id}|${s}`] || v[s].notes || "",
    }))));
  }

  const cell = (v, scope, id) => {
    const bal = v[scope].budget - v[scope].consumed;
    const pct = v[scope].budget ? (v[scope].consumed / v[scope].budget) * 100 : v[scope].consumed ? 100 : 0;
    const key = `${id}|${scope}`;
    return (
      <>
        <td className="num" style={{ minWidth: 118 }}>
          {isAdmin ? (
            <input
              type="number" min="0" step="1000" className="mono"
              style={{ textAlign: "right", padding: "6px 8px" }}
              value={draft[key] ?? ""}
              placeholder="0"
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          ) : money(v[scope].budget)}
        </td>
        <td className="num mono">{money(v[scope].consumed)}</td>
        <td className="num mono" style={{ color: bal < 0 ? "var(--red)" : "var(--text)" }}>{money(bal)}</td>
        <td style={{ width: 80 }}><Progress pct={pct} /></td>
        <td style={{ minWidth: 160 }}>
          {isAdmin ? (
            <input
              type="text"
              style={{ padding: "4px 8px", fontSize: 12, width: "100%" }}
              value={draftNotes[key] ?? ""}
              placeholder="Why added / justification…"
              onChange={(e) => setDraftNotes({ ...draftNotes, [key]: e.target.value })}
            />
          ) : (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {draftNotes[key] || v[scope].notes || "—"}
            </span>
          )}
        </td>
      </>
    );
  };

  return (
    <Shell
      title="Budget vs Actual"
      subtitle="Category-wise budget split by local and global staff with remarks"
      actions={
        <>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 110 }}>
            {[currentYear() + 1, currentYear(), currentYear() - 1, currentYear() - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className="btn ghost sm" onClick={exportCsv}>Export CSV</button>
          {isAdmin && <button className="btn sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save budget"}</button>}
        </>
      }
    >
      {msg && <div className={`alert ${msg.t}`}>{msg.m}</div>}
      {!isAdmin && <div className="alert info">You have read-only access. Budget figures and remarks can only be edited by an administrator.</div>}

      <Card title={`Calendar year ${year}`} hint="Consumption is matched to purchases by category, staff scope and purchase date">
        {loading ? <div className="loading">Loading…</div> : view.length === 0 ? (
          <Empty>No categories set up yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th rowSpan="2" style={{ minWidth: 160 }}>Category</th>
                  <th colSpan="5" style={{ textAlign: "center", borderLeft: "1px solid var(--line-soft)" }}>Local staff</th>
                  <th colSpan="5" style={{ textAlign: "center", borderLeft: "1px solid var(--line-soft)" }}>Global staff</th>
                  <th rowSpan="2" className="num">Total balance</th>
                </tr>
                <tr>
                  <th className="num" style={{ borderLeft: "1px solid var(--line-soft)" }}>Budget</th>
                  <th className="num">Consumed</th>
                  <th className="num">Balance</th>
                  <th>Used</th>
                  <th>Remarks / Justification</th>
                  <th className="num" style={{ borderLeft: "1px solid var(--line-soft)" }}>Budget</th>
                  <th className="num">Consumed</th>
                  <th className="num">Balance</th>
                  <th>Used</th>
                  <th>Remarks / Justification</th>
                </tr>
              </thead>
              <tbody>
                {view.map((v) => {
                  const tb = v.local.budget + v.global.budget - v.local.consumed - v.global.consumed;
                  return (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600 }}>{v.name}</td>
                      {cell(v, "local", v.id)}
                      {cell(v, "global", v.id)}
                      <td className="num mono" style={{ color: tb < 0 ? "var(--red)" : "var(--text)", fontWeight: 600 }}>
                        {money(tb)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num mono">{money(totals.lb)}</td>
                  <td className="num mono">{money(totals.lc)}</td>
                  <td className="num mono">{money(totals.lb - totals.lc)}</td>
                  <td />
                  <td />
                  <td className="num mono">{money(totals.gb)}</td>
                  <td className="num mono">{money(totals.gc)}</td>
                  <td className="num mono">{money(totals.gb - totals.gc)}</td>
                  <td />
                  <td />
                  <td className="num mono">{money(totals.lb + totals.gb - totals.lc - totals.gc)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}
