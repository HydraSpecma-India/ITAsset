"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Progress, Empty, Modal } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { useDept } from "@/lib/department";
import { money, currentYear, csvDownload } from "@/lib/format";

function isIncludedInBudget(a) {
  if (!a) return true;
  if (a.remarks && a.remarks.includes("[INCLUDED_IN_IT_BUDGET]")) return true;
  if (a.remarks && a.remarks.includes("[EXCLUDED_FROM_BUDGET]")) return false;
  if (a.include_in_budget === false) return false;
  const catName = (a.it_categories?.name || "").toLowerCase();
  if (catName.includes("mobile") || catName.includes("tablet")) return false;
  return true;
}

export default function BudgetsPage() {
  const { profile } = useAuth();
  const { dept } = useDept();
  const isAdmin = profile?.role === "admin" || profile?.role === "dept_admin";
  const [year, setYear] = useState(currentYear());
  const [typeFilter, setTypeFilter] = useState("all");
  const [categories, setCategories] = useState([]);
  const [rows, setRows] = useState([]);
  const [assets, setAssets] = useState([]);
  const [draft, setDraft] = useState({});
  const [draftNotes, setDraftNotes] = useState({});
  const [versions, setVersions] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedVer, setSelectedVer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    if (!profile) return;

    const activeDept = dept || profile?.department || "IT";

    setLoading(true);
    let catQuery = supabase.from("it_categories").select("*").eq("is_active", true).order("sort_order");
    let budgetQuery = supabase.from("it_budgets").select("*").eq("budget_year", year);
    let assetQuery = supabase.from("it_assets").select("line_total,scope,category_id,department,remarks,it_categories(name)").eq("budget_year", year);
    let verQuery = supabase.from("it_budget_versions").select("*").eq("budget_year", year).order("version_number", { ascending: false });

    if (activeDept && activeDept !== "All") {
      if (activeDept === "IT") {
        catQuery = catQuery.or("budget_department.eq.IT,budget_department.is.null");
        budgetQuery = budgetQuery.or("budget_department.eq.IT,budget_department.is.null");
        assetQuery = assetQuery.or("budget_department.eq.IT,budget_department.is.null");
        verQuery = verQuery.or("budget_department.eq.IT,budget_department.is.null");
      } else {
        catQuery = catQuery.eq("budget_department", activeDept);
        budgetQuery = budgetQuery.eq("budget_department", activeDept);
        assetQuery = assetQuery.eq("budget_department", activeDept);
        verQuery = verQuery.eq("budget_department", activeDept);
      }
    }

    const [c, s, a, v] = await Promise.all([
      catQuery,
      budgetQuery,
      assetQuery,
      verQuery,
    ]);

    const cats = c.data || [];
    const budgetRows = s.data || [];
    const assetRows = a.data || [];
    let verRows = v.data || [];

    if (verRows.length === 0 && (budgetRows.length > 0 || cats.length > 0)) {
      const initSnap = [];
      cats.forEach((catItem) => {
        ["local", "global"].forEach((scp) => {
          const r = budgetRows.find((b) => b.category_id === catItem.id && b.scope === scp);
          initSnap.push({
            category_id: catItem.id,
            name: catItem.name,
            scope: scp,
            amount: Number(r?.amount || 0),
            notes: r?.notes || "",
          });
        });
      });

      const snapDept = activeDept === "All" ? "IT" : activeDept;
      const { data: createdVer } = await supabase.from("it_budget_versions").insert({
        budget_year: year,
        version_number: 1,
        version_name: "v1.0 (Initial Budget)",
        change_summary: `Initial budget snapshot for ${year}`,
        snapshot_data: initSnap,
        created_by: "System / Admin",
        budget_department: snapDept,
      }).select();

      if (createdVer && createdVer.length > 0) {
        verRows = createdVer;
      }
    }

    setCategories(cats);
    setRows(budgetRows);
    setAssets(assetRows);
    setVersions(verRows);
    if (verRows.length > 0) {
      setSelectedVer(verRows[0]);
    } else {
      setSelectedVer(null);
    }
    const d = {};
    const dn = {};
    budgetRows.forEach((r) => {
      d[`${r.category_id}|${r.scope}`] = String(r.amount);
      dn[`${r.category_id}|${r.scope}`] = r.notes || "";
    });
    setDraft(d);
    setDraftNotes(dn);
    setLoading(false);
  }, [year, dept, profile]);

  useEffect(() => {
    if (profile) load();
  }, [profile, load]);

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

    return categories
      .filter((c) => typeFilter === "all" || (c.category_type || "capex") === typeFilter)
      .map((c) => {
        const lb = budgetMap.get(`${c.id}|local`) || 0;
        const lc = consumedMap.get(`${c.id}|local`) || 0;
        const ln = notesMap.get(`${c.id}|local`) || "";
        const gb = budgetMap.get(`${c.id}|global`) || 0;
        const gc = consumedMap.get(`${c.id}|global`) || 0;
        const gn = notesMap.get(`${c.id}|global`) || "";
        return {
          id: c.id, name: c.name, category_type: c.category_type || "capex",
          local: { budget: lb, consumed: lc, notes: ln },
          global: { budget: gb, consumed: gc, notes: gn },
        };
      });
  }, [categories, rows, assets, typeFilter]);

  const totals = useMemo(() => {
    const t = { lb: 0, lc: 0, gb: 0, gc: 0, capexBudget: 0, capexConsumed: 0, opexBudget: 0, opexConsumed: 0 };
    view.forEach((v) => {
      t.lb += v.local.budget; t.lc += v.local.consumed;
      t.gb += v.global.budget; t.gc += v.global.consumed;
      if ((v.category_type || "capex") === "opex") {
        t.opexBudget += v.local.budget + v.global.budget;
        t.opexConsumed += v.local.consumed + v.global.consumed;
      } else {
        t.capexBudget += v.local.budget + v.global.budget;
        t.capexConsumed += v.local.consumed + v.global.consumed;
      }
    });
    return t;
  }, [view]);

  async function save() {
    setSaving(true);
    setMsg(null);

    try {
      const { data: latestVerRes } = await supabase
        .from("it_budget_versions")
        .select("version_number")
        .eq("budget_year", year)
        .order("version_number", { ascending: false })
        .limit(1);

      const lastVerNo = latestVerRes && latestVerRes.length > 0 ? Number(latestVerRes[0].version_number) : 0;
      const nextVerNo = lastVerNo + 1;

      const snapshotItems = [];
      const changesList = [];

      for (const c of categories) {
        for (const scope of ["local", "global"]) {
          const key = `${c.id}|${scope}`;
          const raw = draft[key];
          const notesVal = draftNotes[key] || null;
          const amount = isNaN(Number(raw)) ? 0 : Number(raw || 0);

          const oldRow = rows.find((r) => r.category_id === c.id && r.scope === scope);
          const oldAmt = Number(oldRow?.amount || 0);
          const oldNote = oldRow?.notes || "";

          if (amount !== oldAmt || (notesVal || "") !== oldNote) {
            const diff = amount - oldAmt;
            const diffStr = diff !== 0 ? (diff > 0 ? `+${money(diff)}` : money(diff)) : "Remarks updated";
            changesList.push(`${c.name} (${scope}): ${money(oldAmt)} → ${money(amount)} (${diffStr})`);
          }

          snapshotItems.push({ category_id: c.id, name: c.name, scope, amount, notes: notesVal });

          if (oldRow?.id) {
            const { error: updErr } = await supabase
              .from("it_budgets")
              .update({ amount, notes: notesVal, updated_at: new Date().toISOString() })
              .eq("id", oldRow.id);
            if (updErr) throw updErr;
          } else if (amount > 0 || notesVal) {
            const targetDept = dept === "All" ? "IT" : dept;
            const { error: insErr } = await supabase
              .from("it_budgets")
              .insert({ budget_year: year, category_id: c.id, scope, amount, notes: notesVal, budget_department: targetDept });
            if (insErr) throw insErr;
          }
        }
      }

      const summaryText = changesList.length
        ? `Modified ${changesList.length} line(s):\n• ` + changesList.join("\n• ")
        : `Version v${nextVerNo}.0 - Saved budget for ${year}`;

      const { data: verInserted, error: verErr } = await supabase.from("it_budget_versions").insert({
        budget_year: year,
        version_number: nextVerNo,
        version_name: `v${nextVerNo}.0`,
        change_summary: summaryText,
        snapshot_data: snapshotItems,
        created_by: profile?.full_name || profile?.email || "Admin",
        budget_department: targetDept,
      }).select();

      if (verErr) {
        console.error("Version insert error:", verErr);
        throw verErr;
      }

      setSaving(false);
      setMsg({ t: "ok", m: `Budget & Version v${nextVerNo}.0 for ${year} saved successfully!` });

      await load();
      if (verInserted && verInserted[0]) {
        setSelectedVer(verInserted[0]);
      }
    } catch (err) {
      console.error("Save budget error:", err);
      setSaving(false);
      setMsg({ t: "err", m: "Failed to save budget: " + (err.message || "Unknown error") });
    }
  }

  async function restoreVersion(ver) {
    if (!confirm(`⚠️ Are you sure you want to restore Version v${ver.version_number}.0? This will override current active budget values for ${year}.`)) return;

    setLoading(true);
    try {
      const snap = ver.snapshot_data || [];

      for (const item of snap) {
        const oldRow = rows.find((r) => r.category_id === item.category_id && r.scope === item.scope);
        const amount = Number(item.amount || 0);
        const notesVal = item.notes || null;

        if (oldRow?.id) {
          await supabase.from("it_budgets").update({ amount, notes: notesVal, updated_at: new Date().toISOString() }).eq("id", oldRow.id);
        } else if (amount > 0 || notesVal) {
          await supabase.from("it_budgets").insert({ budget_year: year, category_id: item.category_id, scope: item.scope, amount, notes: notesVal });
        }
      }

      const { data: latestVerRes } = await supabase
        .from("it_budget_versions")
        .select("version_number")
        .eq("budget_year", year)
        .order("version_number", { ascending: false })
        .limit(1);

      const lastVerNo = latestVerRes && latestVerRes.length > 0 ? Number(latestVerRes[0].version_number) : 0;
      const nextVerNo = lastVerNo + 1;

      await supabase.from("it_budget_versions").insert({
        budget_year: year,
        version_number: nextVerNo,
        version_name: `v${nextVerNo}.0 (Restored from v${ver.version_number}.0)`,
        change_summary: `Restored active budget state to Version v${ver.version_number}.0 (${ver.version_name || ""})`,
        snapshot_data: snap,
        created_by: profile?.full_name || profile?.email || "Admin",
      });

      alert(`Successfully restored active budget to Version v${ver.version_number}.0!`);
      setHistoryOpen(false);
      await load();
    } catch (err) {
      alert("Error restoring version: " + err.message);
      setLoading(false);
    }
  }

  function exportCsv() {
    csvDownload(`budget-vs-actual-${year}.csv`, view.flatMap((v) => ["local", "global"].map((s) => ({
      year, category: v.name, type: (v.category_type || "capex").toUpperCase(), scope: s,
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

  const capexView = useMemo(() => view.filter((v) => (v.category_type || "capex") !== "opex"), [view]);
  const opexView = useMemo(() => view.filter((v) => (v.category_type || "capex") === "opex"), [view]);

  const capexTotals = useMemo(() => {
    const t = { lb: 0, lc: 0, gb: 0, gc: 0 };
    capexView.forEach((v) => {
      t.lb += v.local.budget; t.lc += v.local.consumed;
      t.gb += v.global.budget; t.gc += v.global.consumed;
    });
    return t;
  }, [capexView]);

  const opexTotals = useMemo(() => {
    const t = { lb: 0, lc: 0, gb: 0, gc: 0 };
    opexView.forEach((v) => {
      t.lb += v.local.budget; t.lc += v.local.consumed;
      t.gb += v.global.budget; t.gc += v.global.consumed;
    });
    return t;
  }, [opexView]);

  const renderBudgetTable = (sectionView, sectionTotals, title, typeBadge) => (
    <Card title={`${typeBadge} ${title} — ${year}`} hint="Category-wise budget split by local and global staff">
      {sectionView.length === 0 ? (
        <Empty>No categories in this section.</Empty>
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
              {sectionView.map((v) => {
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
                <td>Subtotal</td>
                <td className="num mono">{money(sectionTotals.lb)}</td>
                <td className="num mono">{money(sectionTotals.lc)}</td>
                <td className="num mono">{money(sectionTotals.lb - sectionTotals.lc)}</td>
                <td />
                <td />
                <td className="num mono">{money(sectionTotals.gb)}</td>
                <td className="num mono">{money(sectionTotals.gc)}</td>
                <td className="num mono">{money(sectionTotals.gb - sectionTotals.gc)}</td>
                <td />
                <td />
                <td className="num mono">{money(sectionTotals.lb + sectionTotals.gb - sectionTotals.lc - sectionTotals.gc)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <Shell
      title="Budget vs Actual"
      subtitle={`${dept === "All" ? "All Departments" : dept} category-wise budget split by local and global staff with CapEx / OpEx & version history`}
      actions={
        <>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 110 }}>
            {[currentYear() + 1, currentYear(), currentYear() - 1, currentYear() - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: 120 }}>
            <option value="all">All Types</option>
            <option value="capex">CapEx Only</option>
            <option value="opex">OpEx Only</option>
          </select>
          <button
            className="btn ghost sm"
            onClick={() => setHistoryOpen(true)}
            style={{ borderColor: "var(--gold)", color: "var(--gold)" }}
          >
            📜 Version History ({versions.length ? `v${versions[0].version_number}.0` : "v1.0"})
          </button>
          <button className="btn ghost sm" onClick={exportCsv}>Export CSV</button>
          {isAdmin && <button className="btn sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save budget"}</button>}
        </>
      }
    >
      {msg && <div className={`alert ${msg.t}`}>{msg.m}</div>}
      {!isAdmin && <div className="alert info">You have read-only access. Budget figures and remarks can only be edited by an administrator.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div style={{ padding: 14, background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.3)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase" }}>CapEx (Capital Expenditure)</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 700 }} className="mono">{money(totals.capexBudget)}</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Consumed: <strong>{money(totals.capexConsumed)}</strong></span>
          </div>
        </div>
        <div style={{ padding: 14, background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--amber)", textTransform: "uppercase" }}>OpEx (Operating Expenditure)</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 700 }} className="mono">{money(totals.opexBudget)}</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Consumed: <strong>{money(totals.opexConsumed)}</strong></span>
          </div>
        </div>
      </div>

      {loading ? <div className="loading">Loading…</div> : (
        <div className="stack" style={{ gap: 20 }}>
          {(typeFilter === "all" || typeFilter === "capex") && renderBudgetTable(capexView, capexTotals, "CapEx Budget (Capital Expenditure)", "📦")}
          {(typeFilter === "all" || typeFilter === "opex") && renderBudgetTable(opexView, opexTotals, "OpEx Budget (Operating Expenditure)", "🔄")}
        </div>
      )}

      {historyOpen && (
        <Modal title={`📜 Budget Version Control & Revision History — ${year}`} onClose={() => setHistoryOpen(false)} full>
          <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 16, minHeight: 460 }}>
            {/* Left Sidebar: Version List */}
            <div style={{ borderRight: "1px solid var(--hs-charcoal)", paddingRight: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
                Revisions ({versions.length})
              </div>
              {versions.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--faint)", fontStyle: "italic" }}>
                  No revisions recorded yet for {year}. Saving budget changes automatically creates a new version snapshot.
                </div>
              ) : (
                versions.map((ver, idx) => {
                  const isSelected = (selectedVer?.id || versions[0]?.id) === ver.id;
                  return (
                    <div
                      key={ver.id}
                      onClick={() => setSelectedVer(ver)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: isSelected ? "var(--gold-dim)" : "rgba(255,255,255,0.03)",
                        border: isSelected ? "1px solid var(--gold)" : "1px solid var(--line-soft)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: isSelected ? "var(--gold)" : "var(--text)" }}>
                          {ver.version_name || `v${ver.version_number}.0`}
                        </span>
                        {idx === 0 && <span className="pill gold" style={{ fontSize: 10 }}>Current</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                        {new Date(ver.created_at).toLocaleString()}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>
                        By {ver.created_by || "Admin"}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Right Main Panel: Selected Version Details & Diff */}
            <div>
              {(() => {
                const activeVer = selectedVer || versions[0];
                if (!activeVer) return <Empty>No version history recorded yet.</Empty>;

                const activeIdx = versions.findIndex((v) => v.id === activeVer.id);
                const prevVer = versions[activeIdx + 1];

                const currentSnap = activeVer.snapshot_data || [];
                const prevSnap = prevVer?.snapshot_data || [];

                const prevMap = new Map(prevSnap.map((item) => [`${item.category_id}|${item.scope}`, item]));

                const diffRows = currentSnap.map((cur) => {
                  const key = `${cur.category_id}|${cur.scope}`;
                  const prev = prevMap.get(key) || { amount: 0, notes: "" };
                  const curAmt = Number(cur.amount || 0);
                  const prevAmt = Number(prev.amount || 0);
                  const diffAmt = curAmt - prevAmt;
                  return {
                    ...cur,
                    prevAmt,
                    diffAmt,
                    prevNotes: prev.notes || "",
                    hasChanged: diffAmt !== 0 || (cur.notes || "") !== (prev.notes || ""),
                  };
                });

                const totalCur = currentSnap.reduce((a, b) => a + Number(b.amount || 0), 0);
                const totalPrev = prevSnap.reduce((a, b) => a + Number(b.amount || 0), 0);
                const totalDiff = totalCur - totalPrev;

                return (
                  <div className="stack" style={{ gap: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--hs-charcoal)", paddingBottom: 10 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 16, color: "var(--gold)" }}>
                          {activeVer.version_name || `Version v${activeVer.version_number}.0`}
                        </h3>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          Saved on {new Date(activeVer.created_at).toLocaleString()} by <strong>{activeVer.created_by || "Admin"}</strong>
                        </div>
                      </div>
                      {isAdmin && activeIdx !== 0 && (
                        <button className="btn sm" onClick={() => restoreVersion(activeVer)}>
                          ↺ Restore Version v{activeVer.version_number}.0
                        </button>
                      )}
                    </div>

                    {activeVer.change_summary && (
                      <div className="alert info" style={{ whiteSpace: "pre-line", fontSize: 12 }}>
                        <strong>Summary of Changes:</strong>
                        {"\n"}{activeVer.change_summary}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 16 }}>
                      <div style={{ flex: 1, padding: 10, background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid var(--hs-charcoal)" }}>
                        <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Version Budget Total</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }} className="mono">{money(totalCur)}</div>
                      </div>
                      {prevVer && (
                        <div style={{ flex: 1, padding: 10, background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid var(--hs-charcoal)" }}>
                          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>vs Previous Version (v{prevVer.version_number}.0)</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: totalDiff > 0 ? "var(--green)" : totalDiff < 0 ? "var(--red)" : "var(--faint)" }} className="mono">
                            {totalDiff === 0 ? "No Net Change" : `${totalDiff > 0 ? "+" : ""}${money(totalDiff)}`}
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>
                      Line-by-Line Breakdown & Changes {prevVer ? `(vs v${prevVer.version_number}.0)` : "(Initial Snapshot)"}
                    </div>

                    <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th>Scope</th>
                            {prevVer && <th className="num">Previous (v{prevVer.version_number}.0)</th>}
                            <th className="num">Version Amount</th>
                            {prevVer && <th className="num">Difference</th>}
                            <th>Remarks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diffRows.map((r, i) => (
                            <tr key={i} style={{ background: r.hasChanged ? "rgba(255,204,0,0.08)" : "transparent" }}>
                              <td style={{ fontWeight: 600 }}>{r.name}</td>
                              <td><span className={`pill ${r.scope === "global" ? "blue" : "grey"}`}>{r.scope}</span></td>
                              {prevVer && <td className="num mono" style={{ color: "var(--muted)" }}>{money(r.prevAmt)}</td>}
                              <td className="num mono" style={{ fontWeight: 600 }}>{money(r.amount)}</td>
                              {prevVer && (
                                <td className="num mono" style={{ fontWeight: 700, color: r.diffAmt > 0 ? "var(--green)" : r.diffAmt < 0 ? "var(--red)" : "var(--faint)" }}>
                                  {r.diffAmt === 0 ? "—" : `${r.diffAmt > 0 ? "+" : ""}${money(r.diffAmt)}`}
                                </td>
                              )}
                              <td style={{ fontSize: 12, color: "var(--muted)" }}>
                                {r.notes || "—"}
                                {prevVer && r.prevNotes && r.prevNotes !== r.notes && (
                                  <div style={{ fontSize: 11, color: "var(--faint)", textDecoration: "line-through" }}>Prev: {r.prevNotes}</div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
