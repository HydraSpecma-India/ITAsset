"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, Kpi, GroupedBars, Columns, Donut, Empty, Progress } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, moneyShort, currentYear, dateStr, daysUntil, expiryState } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isIncludedInBudget(a) {
  if (a.remarks && a.remarks.includes("[INCLUDED_IN_IT_BUDGET]")) return true;
  if (a.remarks && a.remarks.includes("[EXCLUDED_FROM_BUDGET]")) return false;
  if (a.include_in_budget === false) return false;
  const catName = (a.it_categories?.name || "").toLowerCase();
  if (catName.includes("mobile") || catName.includes("tablet")) return false;
  return true;
}

export default function DashboardPage() {
  const [year, setYear] = useState(currentYear());
  const [summary, setSummary] = useState([]);
  const [assets, setAssets] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [years, setYears] = useState([currentYear()]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("v_it_budget_summary").select("budget_year");
      const set = new Set([currentYear(), currentYear() + 1, ...(data || []).map((d) => d.budget_year)]);
      setYears([...set].sort((a, b) => b - a));
    })();
  }, []);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const [s, a, e] = await Promise.all([
        supabase.from("v_it_budget_summary").select("*").eq("budget_year", year),
        supabase.from("it_assets").select("purchase_date,line_total,scope,category_id,status,remarks,it_categories(id,name,sort_order)").eq("budget_year", year),
        supabase.from("v_it_expiry_alerts").select("*"),
      ]);
      setSummary(s.data || []);
      setAssets(a.data || []);
      setAlerts(e.data || []);
      setLoading(false);
    })();
  }, [year]);

  const itAssets = useMemo(() => assets.filter((a) => isIncludedInBudget(a)), [assets]);

  const totals = useMemo(() => {
    const t = { budget: 0, consumed: 0, local: { b: 0, c: 0 }, global: { b: 0, c: 0 } };
    summary.forEach((r) => {
      t.budget += Number(r.budget_amount);
      const k = r.scope === "global" ? "global" : "local";
      t[k].b += Number(r.budget_amount);
    });

    itAssets.forEach((a) => {
      const val = Number(a.line_total);
      t.consumed += val;
      const k = a.scope === "global" ? "global" : "local";
      t[k].c += val;
    });

    t.balance = t.budget - t.consumed;
    t.pct = t.budget ? (t.consumed / t.budget) * 100 : 0;
    return t;
  }, [summary, itAssets]);

  const byCategory = useMemo(() => {
    const m = new Map();
    summary.forEach((r) => {
      const k = r.category_name;
      const c = m.get(k) || { label: k, budget: 0, consumed: 0, sort: r.sort_order };
      c.budget += Number(r.budget_amount);
      m.set(k, c);
    });

    itAssets.forEach((a) => {
      const k = a.it_categories?.name || "Others";
      const c = m.get(k) || { label: k, budget: 0, consumed: 0, sort: a.it_categories?.sort_order || 999 };
      c.consumed += Number(a.line_total);
      m.set(k, c);
    });

    return [...m.values()].sort((a, b) => b.consumed - a.consumed || a.sort - b.sort);
  }, [summary, itAssets]);

  const monthly = useMemo(() => {
    const arr = MONTHS.map((m) => ({ label: m, value: 0 }));
    itAssets.forEach((a) => {
      const mi = new Date(a.purchase_date + "T00:00:00").getMonth();
      arr[mi].value += Number(a.line_total);
    });
    return arr;
  }, [itAssets]);

  const alertBuckets = useMemo(() => {
    const b = { expired: [], critical: [], soon: [] };
    alerts.forEach((a) => {
      const d = daysUntil(a.expiry_date);
      if (d === null) return;
      if (d < 0) b.expired.push({ ...a, d });
      else if (d <= 30) b.critical.push({ ...a, d });
      else if (d <= 90) b.soon.push({ ...a, d });
    });
    return b;
  }, [alerts]);

  const upcoming = useMemo(
    () => [...alertBuckets.expired, ...alertBuckets.critical, ...alertBuckets.soon]
      .sort((a, b) => a.d - b.d).slice(0, 8),
    [alertBuckets]
  );

  const overspent = byCategory.filter((c) => c.consumed > c.budget && c.budget > 0);

  const [drilldown, setDrilldown] = useState(null);

  const openDrilldown = (title, filteredItems) => {
    const totalVal = filteredItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
    setDrilldown({
      title,
      items: filteredItems,
      totalVal,
    });
  };

  const handleKpiClick = (type) => {
    if (type === "budget") {
      openDrilldown(`IT Budget Allocation (${year})`, assets);
    } else if (type === "consumed") {
      openDrilldown(`IT Consumed Purchases (${year})`, itAssets);
    } else if (type === "balance") {
      openDrilldown(`Active IT Assets (${year})`, itAssets);
    } else if (type === "expiry") {
      openDrilldown(`Upcoming Expiries & Renewals`, upcoming);
    }
  };

  const handleCategoryClick = (catRow) => {
    const matching = assets.filter((a) => (a.it_categories?.name || "Others").toLowerCase() === catRow.label.toLowerCase());
    openDrilldown(`Category: ${catRow.label} (${year})`, matching);
  };

  const handleMonthlyClick = (colData, colIndex) => {
    const monthNum = String(colIndex + 1).padStart(2, "0");
    const matching = assets.filter((a) => (a.purchase_date || "").substring(5, 7) === monthNum);
    openDrilldown(`Monthly Spend: ${colData.label} ${year}`, matching);
  };

  const handleScopeClick = (scopeKey) => {
    const scopeLabel = scopeKey === "global" ? "Global" : "Local";
    const matching = itAssets.filter((a) => a.scope === scopeKey);
    openDrilldown(`${scopeLabel} Staff IT Purchases (${year})`, matching);
  };

  const exportDrilldownCsv = (title, items) => {
    csvDownload(`${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}.csv`, items.map((r) => ({
      "Asset Name": r.asset_name,
      "Purchase Date": r.purchase_date,
      "Invoice Number": r.it_invoices?.invoice_no || "",
      "Vendor Name": r.it_invoices?.it_vendors?.name || "",
      "Category": r.it_categories?.name || r.category_name || "",
      "Scope": r.scope === "global" ? "Global" : "Local",
      "Included in IT Budget?": isIncludedInBudget(r) ? "Yes (IT Budget)" : "No (Admin/Dept)",
      "Quantity": r.quantity || 1,
      "Unit Cost": r.unit_cost || r.line_total,
      "Line Total": r.line_total || 0,
      "Assigned Staff": r.staff_name || "",
      "Status": r.status || "in_use",
    })));
  };

  return (
    <Shell
      title="Dashboard"
      subtitle={`IT purchase and budget position · calendar year ${year}`}
      actions={
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 110 }}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      }
    >
      {loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <div className="grid" style={{ gap: 16 }}>
          <div className="grid g4">
            <Kpi label={`Budget ${year}`} value={money(totals.budget)} foot={`${summary.length} budget lines`} tone="gold" onClick={() => handleKpiClick("budget")} />
            <Kpi label="Consumed" value={money(totals.consumed)} foot={`${assets.length} purchase lines`} onClick={() => handleKpiClick("consumed")} />
            <Kpi
              label="Balance available"
              value={money(totals.balance)}
              foot={`${totals.pct.toFixed(1)}% of budget used`}
              tone={totals.balance < 0 ? "bad" : totals.pct >= 90 ? "warn" : "good"}
              onClick={() => handleKpiClick("balance")}
            />
            <Kpi
              label="Expiring in 90 days"
              value={alertBuckets.expired.length + alertBuckets.critical.length + alertBuckets.soon.length}
              foot={`${alertBuckets.expired.length} already expired`}
              tone={alertBuckets.expired.length || alertBuckets.critical.length ? "bad" : "good"}
              onClick={() => handleKpiClick("expiry")}
            />
          </div>

          <Card title="Utilisation" hint={`Local vs Global staff spend for ${year}`}>
            <div className="grid g2" style={{ alignItems: "center" }}>
              <div style={{ display: "grid", gap: 14 }}>
                {[["local", "Local staff"], ["global", "Global staff"]].map(([k, lbl]) => {
                  const b = totals[k].b, c = totals[k].c;
                  const p = b ? (c / b) * 100 : 0;
                  return (
                    <div key={k} onClick={() => handleScopeClick(k)} style={{ cursor: "pointer" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ color: "var(--muted)" }}>{lbl}</span>
                        <span className="mono" style={{ fontSize: 12.5 }}>
                          {moneyShort(c)} / {moneyShort(b)} · {b ? `${p.toFixed(0)}%` : "no budget"}
                        </span>
                      </div>
                      <Progress pct={p} />
                    </div>
                  );
                })}
                <div style={{ marginTop: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "var(--muted)" }}>Overall</span>
                    <span className="mono" style={{ fontSize: 12.5 }}>{totals.pct.toFixed(1)}%</span>
                  </div>
                  <Progress pct={totals.pct} />
                </div>
              </div>
              <Donut
                slices={[
                  { label: "Local staff", value: totals.local.c },
                  { label: "Global staff", value: totals.global.c },
                ]}
                total={totals.consumed}
                caption="Spend split by staff scope"
                onSliceClick={(s) => handleScopeClick(s.label.toLowerCase().includes("global") ? "global" : "local")}
              />
            </div>
          </Card>

          <div className="grid g2">
            <Card title="Budget vs consumed" hint="By category (click any bar to view details)" actions={<Link href="/budgets" className="btn ghost sm">Details</Link>}>
              <GroupedBars rows={byCategory} onBarClick={handleCategoryClick} />
            </Card>
            <div className="grid" style={{ gap: 16, alignContent: "start" }}>
              <Card title="Monthly spend" hint={`Purchases booked in ${year} (click bar for details)`}>
                <Columns data={monthly} onColClick={handleMonthlyClick} />
              </Card>
              {overspent.length > 0 && (
                <Card title="Over budget">
                  <div style={{ display: "grid", gap: 8 }}>
                    {overspent.map((c) => (
                      <div key={c.label} onClick={() => handleCategoryClick(c)} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, cursor: "pointer" }}>
                        <span style={{ color: "var(--muted)" }}>{c.label}</span>
                        <span className="mono" style={{ color: "var(--red)" }}>
                          +{moneyShort(c.consumed - c.budget)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>

          <Card
            title="Expiry & renewal watchlist"
            hint="Warranty, licence, AMC and replacement dates within 90 days"
            actions={<Link href="/expiry" className="btn ghost sm">View all</Link>}
          >
            {upcoming.length === 0 ? (
              <Empty>Nothing expiring in the next 90 days.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Asset</th><th>Type</th><th>Category</th><th>Assigned to</th>
                      <th>Date</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map((a, i) => {
                      const st = expiryState(a.d);
                      return (
                        <tr key={i} onClick={() => openDrilldown(`Expiry Detail: ${a.asset_name}`, [a])} style={{ cursor: "pointer" }}>
                          <td>{a.asset_name}{a.asset_tag ? ` · ${a.asset_tag}` : ""}</td>
                          <td>{a.alert_type}</td>
                          <td style={{ color: "var(--muted)" }}>{a.category_name}</td>
                          <td style={{ color: "var(--muted)" }}>{a.staff_name || "—"}</td>
                          <td className="mono">{dateStr(a.expiry_date)}</td>
                          <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {drilldown && (
            <Modal wide title={drilldown.title} onClose={() => setDrilldown(null)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  Total <strong>{drilldown.items.length}</strong> item(s) line total: <strong className="mono" style={{ color: "var(--gold)" }}>{money(drilldown.totalVal)}</strong>
                </div>
                <button className="btn sm" onClick={() => exportDrilldownCsv(drilldown.title, drilldown.items)}>
                  📥 Export Drilldown CSV
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Purchase Date</th>
                      <th>Asset Name</th>
                      <th>Category</th>
                      <th>Scope</th>
                      <th>Assigned Staff</th>
                      <th className="num">Qty</th>
                      <th className="num">Unit Cost</th>
                      <th className="num">Total</th>
                      <th>IT Budget?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldown.items.map((a, idx) => (
                      <tr key={a.id || idx}>
                        <td style={{ fontWeight: 600 }}>{a.it_invoices?.invoice_no || "—"}</td>
                        <td className="mono">{dateStr(a.purchase_date || a.expiry_date)}</td>
                        <td style={{ fontWeight: 500 }}>{a.asset_name}</td>
                        <td style={{ color: "var(--muted)" }}>{a.it_categories?.name || a.category_name || "—"}</td>
                        <td><span className={`pill ${a.scope === "global" ? "blue" : "grey"}`}>{a.scope === "global" ? "Global" : "Local"}</span></td>
                        <td style={{ color: "var(--muted)" }}>{a.staff_name || "—"}</td>
                        <td className="num mono">{a.quantity || 1}</td>
                        <td className="num mono">{money(a.unit_cost || a.line_total)}</td>
                        <td className="num mono" style={{ fontWeight: 600 }}>{money(a.line_total || 0)}</td>
                        <td>
                          <span className={`pill ${isIncludedInBudget(a) ? "gold" : "red"}`}>
                            {isIncludedInBudget(a) ? "✓ IT Budget" : "✕ Admin/Dept"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Modal>
          )}
        </div>
      )}
    </Shell>
  );
}
