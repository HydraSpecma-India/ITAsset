"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Empty, Kpi } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, dateStr, currentYear, csvDownload, ASSET_STATUS, daysUntil, expiryState } from "@/lib/format";

export default function AssetsPage() {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [year, setYear] = useState("all");
  const [cat, setCat] = useState("all");
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("purchase_date");

  const [budgetFilter, setBudgetFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [a, c] = await Promise.all([
      supabase.from("it_assets")
        .select("*, it_categories(name), it_invoices(invoice_no, invoice_date, it_vendors(name))")
        .order("purchase_date", { ascending: false }),
      supabase.from("it_categories").select("*").order("sort_order"),
    ]);
    setRows(a.data || []);
    setCategories(c.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const years = useMemo(() => [...new Set(rows.map((r) => r.budget_year))].sort((a, b) => b - a), [rows]);

  function isIncludedInBudget(r) {
    if (r.remarks && r.remarks.includes("[EXCLUDED_FROM_BUDGET]")) return false;
    return r.include_in_budget !== false;
  }

  async function toggleScope(r) {
    const nextScope = r.scope === "global" ? "local" : "global";
    setRows((prev) => prev.map((item) => (item.id === r.id ? { ...item, scope: nextScope } : item)));
    const { error } = await supabase.from("it_assets").update({ scope: nextScope }).eq("id", r.id);
    if (error) {
      alert("Database error updating scope: " + error.message);
      load();
    }
  }

  async function toggleBudgetInclude(r) {
    const current = isIncludedInBudget(r);
    const nextVal = !current;
    let nextRemarks = (r.remarks || "").trim();
    if (nextVal) {
      nextRemarks = nextRemarks.replace(/\[EXCLUDED_FROM_BUDGET\]/g, "").trim();
    } else if (!nextRemarks.includes("[EXCLUDED_FROM_BUDGET]")) {
      nextRemarks = (`[EXCLUDED_FROM_BUDGET] ${nextRemarks}`).trim();
    }

    setRows((prev) => prev.map((item) => (item.id === r.id ? { ...item, include_in_budget: nextVal, remarks: nextRemarks } : item)));
    
    const { error } = await supabase.from("it_assets").update({ remarks: nextRemarks }).eq("id", r.id);
    if (error) {
      alert("Database error updating budget inclusion: " + error.message);
      load();
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (year !== "all" && r.budget_year !== Number(year)) return false;
      if (cat !== "all" && r.category_id !== cat) return false;
      if (scope !== "all" && r.scope !== scope) return false;
      if (status !== "all" && r.status !== status) return false;
      const isInc = isIncludedInBudget(r);
      if (budgetFilter === "it_only" && !isInc) return false;
      if (budgetFilter === "excluded_only" && isInc) return false;
      if (!s) return true;
      return [r.asset_name, r.asset_tag, r.serial_no, r.model, r.staff_name, r.staff_code,
              r.department, r.location, r.remarks, r.it_categories?.name, r.it_invoices?.invoice_no,
              r.it_invoices?.it_vendors?.name]
        .filter(Boolean).join(" ").toLowerCase().includes(s);
    });
    out = [...out].sort((a, b) => {
      if (sort === "cost") return Number(b.line_total) - Number(a.line_total);
      if (sort === "name") return a.asset_name.localeCompare(b.asset_name);
      if (sort === "staff") return (a.staff_name || "").localeCompare(b.staff_name || "");
      return String(b.purchase_date).localeCompare(String(a.purchase_date));
    });
    return out;
  }, [rows, q, year, cat, scope, status, budgetFilter, sort]);

  const totals = useMemo(() => {
    const t = { value: 0, qty: 0, local: 0, global: 0, itBudget: 0, excluded: 0 };
    filtered.forEach((r) => {
      const val = Number(r.line_total);
      t.value += val;
      t.qty += r.quantity;
      t[r.scope === "global" ? "global" : "local"] += val;
      if (r.include_in_budget !== false) {
        t.itBudget += val;
      } else {
        t.excluded += val;
      }
    });
    return t;
  }, [filtered]);

  function exportCsv() {
    csvDownload("asset-register.csv", filtered.map((r) => ({
      asset_name: r.asset_name, asset_tag: r.asset_tag || "", serial_no: r.serial_no || "",
      model: r.model || "", category: r.it_categories?.name || "", scope: r.scope,
      include_in_it_budget: r.include_in_budget !== false ? "Yes" : "No (Admin/Dept)",
      item_type: r.item_type, staff_name: r.staff_name || "", department: r.department || "",
      location: r.location || "", quantity: r.quantity, unit_cost: r.unit_cost, line_total: r.line_total,
      purchase_date: r.purchase_date, warranty_end: r.warranty_end || "", license_end: r.license_end || "",
      amc_end: r.amc_end || "", replacement_due: r.replacement_due || "", status: r.status,
      invoice_no: r.it_invoices?.invoice_no || "", vendor: r.it_invoices?.it_vendors?.name || "",
    })));
  }

  return (
    <Shell
      title="Asset Register"
      subtitle="Every purchased item with cost, owner and expiry dates"
      actions={<button className="btn ghost sm" onClick={exportCsv}>Export CSV</button>}
    >
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi label="Items shown" value={filtered.length} foot={`${totals.qty} units`} />
        <Kpi label="Total Asset Value" value={money(totals.value)} tone="gold" />
        <Kpi label="IT Budget Spend" value={money(totals.itBudget)} foot="Counted in IT Budget" />
        <Kpi label="Admin / Dept Spend" value={money(totals.excluded)} foot="Excluded from IT Budget" />
      </div>

      <div className="toolbar">
        <div className="field" style={{ minWidth: 240, flex: 1 }}>
          <span className="field-label">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Asset, serial, staff, invoice, vendor…" />
        </div>
        <div className="field">
          <span className="field-label">Year</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="all">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Category</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Local + Global</option>
            <option value="local">Local staff</option>
            <option value="global">Global staff</option>
          </select>
        </div>
        <div className="field">
          <span className="field-label">IT Budget?</span>
          <select value={budgetFilter} onChange={(e) => setBudgetFilter(e.target.value)}>
            <option value="all">All (IT + Admin)</option>
            <option value="it_only">IT Budget Only</option>
            <option value="excluded_only">Admin/Dept Excluded Only</option>
          </select>
        </div>
        <div className="field">
          <span className="field-label">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {ASSET_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="purchase_date">Newest first</option>
            <option value="cost">Highest cost</option>
            <option value="name">Asset name</option>
            <option value="staff">Staff name</option>
          </select>
        </div>
      </div>

      <Card>
        {loading ? <div className="loading">Loading…</div> : filtered.length === 0 ? (
          <Empty>No assets match these filters.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th><th>Category</th><th>Scope (Click to Toggle)</th><th>IT Budget? (Click to Toggle)</th><th>Assigned to</th>
                  <th>Purchased</th><th className="num">Qty</th><th className="num">Value</th>
                  <th>Next expiry</th><th>Status</th><th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const dates = [
                    ["Warranty", r.warranty_end], ["Licence", r.license_end],
                    ["AMC", r.amc_end], ["Replace", r.replacement_due],
                  ].filter(([, d]) => d).map(([k, d]) => ({ k, d, n: daysUntil(d) }))
                   .sort((a, b) => a.n - b.n);
                  const next = dates[0];
                  const st = next ? expiryState(next.n) : null;
                  const isItBudget = r.include_in_budget !== false;

                  return (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.asset_name}</div>
                        <div style={{ fontSize: 11, color: "var(--faint)" }}>
                          {[r.asset_tag, r.model, r.serial_no].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{r.it_categories?.name}</td>
                      <td>
                        <button
                          className={`pill ${r.scope === "global" ? "blue" : "grey"}`}
                          onClick={() => toggleScope(r)}
                          style={{ cursor: "pointer", border: "1px solid var(--hs-charcoal)" }}
                          title="Click to toggle between Local and Global scope"
                        >
                          {r.scope === "global" ? "Global ⇄" : "Local ⇄"}
                        </button>
                      </td>
                      <td>
                        <button
                          className={`pill ${isItBudget ? "gold" : "grey"}`}
                          onClick={() => toggleBudgetInclude(r)}
                          style={{ cursor: "pointer", border: "1px solid var(--hs-charcoal)" }}
                          title="Click to toggle whether this asset counts towards IT Budget or Admin/Dept Budget"
                        >
                          {isItBudget ? "✓ IT Budget" : "✕ Admin/Dept"}
                        </button>
                      </td>
                      <td>
                        <div>{r.staff_name || "—"}</div>
                        <div style={{ fontSize: 11, color: "var(--faint)" }}>{[r.department, r.location].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="mono">{dateStr(r.purchase_date)}</td>
                      <td className="num mono">{r.quantity}</td>
                      <td className="num mono" style={{ opacity: isItBudget ? 1 : 0.65 }}>
                        {money(r.line_total)}
                        {!isItBudget && <div style={{ fontSize: 10, color: "var(--faint)" }}>Excluded</div>}
                      </td>
                      <td>
                        {next ? (
                          <>
                            <span className={`pill ${st.cls}`}>{st.label}</span>
                            <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 3 }}>{next.k} · {dateStr(next.d)}</div>
                          </>
                        ) : <span style={{ color: "var(--faint)" }}>—</span>}
                      </td>
                      <td>
                        <span className={`pill ${r.status === "disposed" ? "red" : r.status === "in_use" ? "green" : "grey"}`}>
                          {ASSET_STATUS.find((s) => s.value === r.status)?.label}
                        </span>
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>
                        {r.it_invoices?.invoice_no || "—"}
                        <div style={{ fontSize: 11, color: "var(--faint)" }}>{r.it_invoices?.it_vendors?.name || ""}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="6">Total</td>
                  <td className="num mono">{totals.qty}</td>
                  <td className="num mono">{money(totals.value)}</td>
                  <td colSpan="3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}
