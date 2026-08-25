"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Progress, Empty } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { money, currentYear, csvDownload } from "@/lib/format";

export default function BudgetsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [year, setYear] = useState(currentYear());
  const [categories, setCategories] = useState([]);
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, s] = await Promise.all([
      supabase.from("it_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("v_it_budget_summary").select("*").eq("budget_year", year),
    ]);
    setCategories(c.data || []);
    setRows(s.data || []);
    const d = {};
    (s.data || []).forEach((r) => { d[`${r.category_id}|${r.scope}`] = String(r.budget_amount); });
    setDraft(d);
    setLoading(false);
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => map.set(`${r.category_id}|${r.scope}`, r));
    return categories.map((c) => {
      const l = map.get(`${c.id}|local`) || {};
      const g = map.get(`${c.id}|global`) || {};
      return {
        id: c.id, name: c.name,
        local: { budget: Number(l.budget_amount || 0), consumed: Number(l.consumed || 0) },
        global: { budget: Number(g.budget_amount || 0), consumed: Number(g.consumed || 0) },
      };
    });
  }, [categories, rows]);

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
        const amount = Number(raw || 0);
        if (!raw && !rows.find((r) => `${r.category_id}|${r.scope}` === key && Number(r.budget_amount) > 0)) return;
        payload.push({ budget_year: year, category_id: c.id, scope, amount: isNaN(amount) ? 0 : amount });
      });
    });
    const { error } = await supabase.from("it_budgets").upsert(payload, { onConflict: "budget_year,category_id,scope" });
    setSaving(false);
    setMsg(error ? { t: "err", m: error.message } : { t: "ok", m: `Budget for ${year} saved.` });
    if (!error) load();
  }

  function exportCsv() {
    csvDownload(`budget-vs-actual-${year}.csv`, view.flatMap((v) => ["local", "global"].map((s) => ({
      year, category: v.name, scope: s,
      budget: v[s].budget, consumed: v[s].consumed, balance: v[s].budget - v[s].consumed,
    }))));
  }

  const cell = (v, scope, id) => {
    const bal = v[scope].budget - v[scope].consumed;
    const pct = v[scope].budget ? (v[scope].consumed / v[scope].budget) * 100 : v[scope].consumed ? 100 : 0;
    return (
      <>
        <td className="num" style={{ minWidth: 118 }}>
          {isAdmin ? (
            <input
              type="number" min="0" step="1000" className="mono"
              style={{ textAlign: "right", padding: "6px 8px" }}
              value={draft[`${id}|${scope}`] ?? ""}
              placeholder="0"
              onChange={(e) => setDraft({ ...draft, [`${id}|${scope}`]: e.target.value })}
            />
          ) : money(v[scope].budget)}
        </td>
        <td className="num mono">{money(v[scope].consumed)}</td>
        <td className="num mono" style={{ color: bal < 0 ? "var(--red)" : "var(--text)" }}>{money(bal)}</td>
        <td style={{ width: 96 }}><Progress pct={pct} /></td>
      </>
    );
  };

  return (
    <Shell
      title="Budget vs Actual"
      subtitle="Category-wise budget split by local and global staff"
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
      {!isAdmin && <div className="alert info">You have read-only access. Budget figures can only be edited by an administrator.</div>}

      <Card title={`Calendar year ${year}`} hint="Consumption is matched to purchases by category, staff scope and purchase date">
        {loading ? <div className="loading">Loading…</div> : view.length === 0 ? (
          <Empty>No categories set up yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th rowSpan="2" style={{ minWidth: 170 }}>Category</th>
                  <th colSpan="4" style={{ textAlign: "center", borderLeft: "1px solid var(--line-soft)" }}>Local staff</th>
                  <th colSpan="4" style={{ textAlign: "center", borderLeft: "1px solid var(--line-soft)" }}>Global staff</th>
                  <th rowSpan="2" className="num">Total balance</th>
                </tr>
                <tr>
                  <th className="num" style={{ borderLeft: "1px solid var(--line-soft)" }}>Budget</th>
                  <th className="num">Consumed</th>
                  <th className="num">Balance</th>
                  <th>Used</th>
                  <th className="num" style={{ borderLeft: "1px solid var(--line-soft)" }}>Budget</th>
                  <th className="num">Consumed</th>
                  <th className="num">Balance</th>
                  <th>Used</th>
                </tr>
              </thead>
              <tbody>
                {view.map((v) => {
                  const tb = v.local.budget + v.global.budget - v.local.consumed - v.global.consumed;
                  return (
                    <tr key={v.id}>
                      <td>{v.name}</td>
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
                  <td className="num mono">{money(totals.gb)}</td>
                  <td className="num mono">{money(totals.gc)}</td>
                  <td className="num mono">{money(totals.gb - totals.gc)}</td>
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
