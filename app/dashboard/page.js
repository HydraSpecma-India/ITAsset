"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Shell from "@/components/Shell";
import { Card, Kpi, GroupedBars, Columns, Donut, Empty, Progress } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { useDept } from "@/lib/department";
import { money, moneyShort, currentYear, dateStr, daysUntil, expiryState, csvDownload } from "@/lib/format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isIncludedInBudget(a) {
  if (!a) return true;
  if (a.remarks && a.remarks.includes("[INCLUDED_IN_IT_BUDGET]")) return true;
  if (a.remarks && a.remarks.includes("[EXCLUDED_FROM_BUDGET]")) return false;
  if (a.include_in_budget === false) return false;
  const catName = (a.it_categories?.name || a.category_name || "").toLowerCase();
  if (catName.includes("mobile") || catName.includes("tablet")) return false;
  return true;
}

export default function DashboardPage() {
  const { dept } = useDept();
  const [year, setYear] = useState(currentYear());
  const [summary, setSummary] = useState([]);
  const [assets, setAssets] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [years, setYears] = useState([currentYear()]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("it_budgets").select("budget_year");
      const set = new Set([currentYear(), currentYear() + 1, ...(data || []).map((d) => d.budget_year)]);
      setYears([...set].sort((a, b) => b - a));
    })();
  }, []);

  useEffect(() => {
    setLoading(true);
    (async () => {
      let bQuery = supabase.from("it_budgets").select("*, it_categories(id,name,category_type,sort_order)").eq("budget_year", year);
      let aQuery = supabase.from("it_assets").select("*, it_categories(id,name,category_type,sort_order), it_invoices(invoice_no, it_vendors(name))").eq("budget_year", year);
      let eQuery = supabase.from("v_it_expiry_alerts").select("*");

      if (dept && dept !== "All") {
        if (dept === "IT") {
          bQuery = bQuery.or("department.eq.IT,department.is.null");
          aQuery = aQuery.or("department.eq.IT,department.is.null");
          eQuery = eQuery.or("department.eq.IT,department.is.null");
        } else {
          bQuery = bQuery.eq("department", dept);
          aQuery = aQuery.eq("department", dept);
          eQuery = eQuery.eq("department", dept);
        }
      }

      const [s, a, e] = await Promise.all([
        bQuery,
        aQuery,
        eQuery,
      ]);
      setSummary(s.data || []);
      setAssets(a.data || []);
      setAlerts(e.data || []);
      setLoading(false);
    })();
  }, [year, dept]);

  const itAssets = useMemo(() => assets.filter((a) => isIncludedInBudget(a)), [assets]);

  const totals = useMemo(() => {
    const t = {
      budget: 0, consumed: 0,
      capexBudget: 0, capexConsumed: 0,
      opexBudget: 0, opexConsumed: 0,
      local: { b: 0, c: 0 }, global: { b: 0, c: 0 }
    };
    summary.forEach((r) => {
      const bAmt = Number(r.amount || 0);
      t.budget += bAmt;
      const k = r.scope === "global" ? "global" : "local";
      t[k].b += bAmt;
      const catType = r.it_categories?.category_type || "capex";
      if (catType === "opex") {
        t.opexBudget += bAmt;
      } else {
        t.capexBudget += bAmt;
      }
    });

    itAssets.forEach((a) => {
      const val = Number(a.line_total || 0);
      t.consumed += val;
      const k = a.scope === "global" ? "global" : "local";
      t[k].c += val;
      const catType = a.it_categories?.category_type || "capex";
      if (catType === "opex") {
        t.opexConsumed += val;
      } else {
        t.capexConsumed += val;
      }
    });

    t.balance = t.budget - t.consumed;
    t.pct = t.budget ? (t.consumed / t.budget) * 100 : 0;
    return t;
  }, [summary, itAssets]);

  const byCategory = useMemo(() => {
    const m = new Map();
    summary.forEach((r) => {
      const k = r.it_categories?.name || "Others";
      const c = m.get(k) || { label: k, budget: 0, consumed: 0, sort: r.it_categories?.sort_order || 999 };
      c.budget += Number(r.amount || 0);
      m.set(k, c);
    });

    itAssets.forEach((a) => {
      const k = a.it_categories?.name || "Others";
      const c = m.get(k) || { label: k, budget: 0, consumed: 0, sort: a.it_categories?.sort_order || 999 };
      c.consumed += Number(a.line_total || 0);
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

  const [activeSelection, setActiveSelection] = useState({
    title: `All Purchases (${year})`,
    filterKey: "all",
    filterVal: null,
  });

  const getMonthFromDateStr = (d) => {
    if (!d) return "";
    const str = String(d);
    if (str.includes("-")) {
      const parts = str.split("-");
      if (parts.length === 3) return parts[0].length === 4 ? parts[1].padStart(2, "0") : parts[1].padStart(2, "0");
    }
    if (str.includes("/")) {
      const parts = str.split("/");
      if (parts.length === 3) return parts[1].padStart(2, "0");
    }
    return "";
  };

  const activeItems = useMemo(() => {
    if (!assets || assets.length === 0) return [];
    const { filterKey, filterVal } = activeSelection;

    if (filterKey === "category") {
      return assets.filter((a) => (a.it_categories?.name || "Others").toLowerCase() === String(filterVal).toLowerCase());
    }
    if (filterKey === "month") {
      return assets.filter((a) => getMonthFromDateStr(a.purchase_date) === filterVal);
    }
    if (filterKey === "scope") {
      return itAssets.filter((a) => a.scope === filterVal);
    }
    if (filterKey === "it_only") {
      return itAssets;
    }
    if (filterKey === "admin_only") {
      return assets.filter((a) => !isIncludedInBudget(a));
    }
    if (filterKey === "capex") {
      return itAssets.filter((a) => (a.it_categories?.category_type || "capex") !== "opex");
    }
    if (filterKey === "opex") {
      return itAssets.filter((a) => (a.it_categories?.category_type || "capex") === "opex");
    }
    if (filterKey === "expiry") {
      return upcoming;
    }
    return assets;
  }, [assets, itAssets, upcoming, activeSelection]);

  const activeTotalVal = useMemo(() => {
    return activeItems.reduce((sum, item) => sum + Number(item?.line_total || (Number(item?.quantity || 1) * Number(item?.unit_cost || 0))), 0);
  }, [activeItems]);

  const handleKpiClick = (type) => {
    if (type === "budget") {
      setActiveSelection({ title: `IT Budget Allocation (${year})`, filterKey: "all" });
    } else if (type === "consumed") {
      setActiveSelection({ title: `IT Consumed Purchases (${year})`, filterKey: "it_only" });
    } else if (type === "balance") {
      setActiveSelection({ title: `Active IT Assets (${year})`, filterKey: "it_only" });
    } else if (type === "capex") {
      setActiveSelection({ title: `📦 CapEx IT Purchases (${year})`, filterKey: "capex" });
    } else if (type === "opex") {
      setActiveSelection({ title: `🔄 OpEx IT Purchases (${year})`, filterKey: "opex" });
    } else if (type === "expiry") {
      setActiveSelection({ title: `Upcoming Expiries & Renewals`, filterKey: "expiry" });
    }
  };

  const handleCategoryClick = (catRow) => {
    if (!catRow || !catRow.label) return;
    setActiveSelection({ title: `Category: ${catRow.label} (${year})`, filterKey: "category", filterVal: catRow.label });
  };

  const handleMonthlyClick = (colData, colIndex) => {
    const monthNum = String(colIndex + 1).padStart(2, "0");
    setActiveSelection({ title: `Monthly Spend: ${colData?.label || "Month"} ${year}`, filterKey: "month", filterVal: monthNum });
  };

  const handleScopeClick = (scopeKey) => {
    const scopeLabel = scopeKey === "global" ? "Global" : "Local";
    setActiveSelection({ title: `${scopeLabel} Staff IT Purchases (${year})`, filterKey: "scope", filterVal: scopeKey });
  };

  const exportDrilldownCsv = (title, items) => {
    const safeTitle = (title || "drilldown").toLowerCase().replace(/[^a-z0-9]/g, "-");
    csvDownload(`${safeTitle}.csv`, (items || []).map((r) => ({
      "Asset Name": r.asset_name || "—",
      "Purchase Date": r.purchase_date || r.expiry_date || "",
      "Invoice Number": r.it_invoices?.invoice_no || r.invoice_no || "",
      "Vendor Name": r.it_invoices?.it_vendors?.name || "",
      "Category": r.it_categories?.name || r.category_name || "",
      "Scope": r.scope === "global" ? "Global" : "Local",
      "Included in IT Budget?": isIncludedInBudget(r) ? "Yes (IT Budget)" : "No (Admin/Dept)",
      "Quantity": r.quantity || 1,
      "Unit Cost": r.unit_cost || r.line_total || 0,
      "Line Total": r.line_total || (Number(r.quantity || 1) * Number(r.unit_cost || 0)),
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14 }}>
            <Kpi label={`Budget ${year}`} value={money(totals.budget)} foot={`${summary.length} lines`} tone="gold" onClick={() => handleKpiClick("budget")} />
            <Kpi label="Consumed" value={money(totals.consumed)} foot={`${assets.length} items`} onClick={() => handleKpiClick("consumed")} />
            <Kpi label="📦 CapEx Spend" value={money(totals.capexConsumed)} foot={`Budget: ${moneyShort(totals.capexBudget)}`} tone="good" onClick={() => handleKpiClick("capex")} />
            <Kpi label="🔄 OpEx Spend" value={money(totals.opexConsumed)} foot={`Budget: ${moneyShort(totals.opexBudget)}`} tone="warn" onClick={() => handleKpiClick("opex")} />
            <Kpi
              label="Balance available"
              value={money(totals.balance)}
              foot={`${totals.pct.toFixed(1)}% used`}
              tone={totals.balance < 0 ? "bad" : totals.pct >= 90 ? "warn" : "good"}
              onClick={() => handleKpiClick("balance")}
            />
            <Kpi
              label="Expiring in 90 days"
              value={alertBuckets.expired.length + alertBuckets.critical.length + alertBuckets.soon.length}
              foot={`${alertBuckets.expired.length} expired`}
              tone={alertBuckets.expired.length || alertBuckets.critical.length ? "bad" : "good"}
              onClick={() => handleKpiClick("expiry")}
            />
          </div>

          <Card title="Utilisation" hint={`Local vs Global staff spend for ${year} (click bar/slice for details)`}>
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
            <Card title="Budget vs consumed" hint="By category (click any bar to filter table below)" actions={<Link href="/budgets" className="btn ghost sm">Details</Link>}>
              <GroupedBars rows={byCategory} onBarClick={handleCategoryClick} />
            </Card>
            <div className="grid" style={{ gap: 16, alignContent: "start" }}>
              <Card title="Monthly spend" hint={`Purchases booked in ${year} (click bar to filter table below)`}>
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

          {/* INLINE ACTIVE DETAILS TABLE CARD */}
          <Card
            title={`📌 ${activeSelection.title}`}
            hint={`${activeItems.length} item(s) found · Total value ${money(activeTotalVal)}`}
            actions={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {activeSelection.filterKey !== "all" && (
                  <button className="btn ghost sm" onClick={() => setActiveSelection({ title: `All Purchases (${year})`, filterKey: "all" })}>
                    🔄 Show All
                  </button>
                )}
                <button className="btn sm" onClick={() => exportDrilldownCsv(activeSelection.title, activeItems)}>
                  📥 Export CSV
                </button>
              </div>
            }
          >
            {activeItems.length === 0 ? (
              <Empty>No asset purchases match this selection.</Empty>
            ) : (
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
                    {activeItems.map((a, idx) => {
                      if (!a) return null;
                      const isInc = isIncludedInBudget(a);
                      return (
                        <tr key={a.id || idx}>
                          <td style={{ fontWeight: 600 }}>{a.it_invoices?.invoice_no || a.invoice_no || "—"}</td>
                          <td className="mono">{dateStr(a.purchase_date || a.expiry_date)}</td>
                          <td style={{ fontWeight: 500 }}>{a.asset_name || "—"}</td>
                          <td style={{ color: "var(--muted)" }}>{a.it_categories?.name || a.category_name || "—"}</td>
                          <td><span className={`pill ${a.scope === "global" ? "blue" : "grey"}`}>{a.scope === "global" ? "Global" : "Local"}</span></td>
                          <td style={{ color: "var(--muted)" }}>{a.staff_name || "—"}</td>
                          <td className="num mono">{a.quantity || 1}</td>
                          <td className="num mono">{money(a.unit_cost || a.line_total || 0)}</td>
                          <td className="num mono" style={{ fontWeight: 600 }}>{money(a.line_total || (Number(a.quantity || 1) * Number(a.unit_cost || 0)))}</td>
                          <td>
                            <span className={`pill ${isInc ? "gold" : "red"}`}>
                              {isInc ? "✓ IT Budget" : "✕ Admin/Dept"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

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
                        <tr key={i} onClick={() => setActiveSelection({ title: `Expiry Detail: ${a.asset_name}`, filterKey: "expiry" })} style={{ cursor: "pointer" }}>
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
        </div>
      )}
    </Shell>
  );
}
