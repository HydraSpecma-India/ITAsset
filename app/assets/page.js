"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Empty, Kpi } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, dateStr, currentYear, csvDownload, ASSET_STATUS, daysUntil, expiryState } from "@/lib/format";
import { useAuth } from "@/lib/session";
import { useDept } from "@/lib/department";

export default function AssetsPage() {
  const { profile } = useAuth();
  const { dept, isDeptAdmin } = useDept();
  const isAdmin = isDeptAdmin;
  const isEmployee = profile?.role === "employee";

  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [year, setYear] = useState("all");
  const [month, setMonth] = useState("all");
  const [cat, setCat] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("purchase_date");

  const [budgetFilter, setBudgetFilter] = useState("all");

  const [bulkEdit, setBulkEdit] = useState(false);
  const [bulkForms, setBulkForms] = useState({});
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;

    const activeDept = dept || profile?.department || "IT";

    setLoading(true);
    let assetQuery = supabase.from("it_assets")
        .select("*, it_categories(name, category_type), it_invoices(invoice_no, invoice_date, it_vendors(name))")
        .order("purchase_date", { ascending: false });
    let catQuery = supabase.from("it_categories").select("*").order("sort_order");

    if (activeDept && activeDept !== "All") {
      if (activeDept === "IT") {
        assetQuery = assetQuery.or("budget_department.eq.IT,budget_department.is.null");
        catQuery = catQuery.or("budget_department.eq.IT,budget_department.is.null");
      } else {
        assetQuery = assetQuery.eq("budget_department", activeDept);
        catQuery = catQuery.eq("budget_department", activeDept);
      }
    }

    const [a, c, emp, deptData] = await Promise.all([
      assetQuery,
      catQuery,
      supabase.from("it_employees").select("*").eq("is_active", true).order("full_name"),
      supabase.from("it_departments").select("*").eq("is_active", true).order("name"),
    ]);
    setRows(a.data || []);
    setCategories(c.data || []);
    setEmployees(emp.data || []);
    setDepartments(deptData.data || []);
    setLoading(false);
  }, [dept, profile]);

  useEffect(() => {
    if (profile) load();
  }, [profile, load]);

  const years = useMemo(() => [...new Set(rows.map((r) => r.budget_year))].sort((a, b) => b - a), [rows]);

  function isIncludedInBudget(r) {
    if (r.remarks && r.remarks.includes("[INCLUDED_IN_IT_BUDGET]")) return true;
    if (r.remarks && r.remarks.includes("[EXCLUDED_FROM_BUDGET]")) return false;
    if (r.include_in_budget === false) return false;
    const catName = (r.it_categories?.name || "").toLowerCase();
    if (catName.includes("mobile") || catName.includes("tablet")) return false;
    return true;
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
      if (!nextRemarks.includes("[INCLUDED_IN_IT_BUDGET]")) {
        nextRemarks = (`[INCLUDED_IN_IT_BUDGET] ${nextRemarks}`).trim();
      }
    } else {
      nextRemarks = nextRemarks.replace(/\[INCLUDED_IN_IT_BUDGET\]/g, "").trim();
      if (!nextRemarks.includes("[EXCLUDED_FROM_BUDGET]")) {
        nextRemarks = (`[EXCLUDED_FROM_BUDGET] ${nextRemarks}`).trim();
      }
    }

    setRows((prev) => prev.map((item) => (item.id === r.id ? { ...item, remarks: nextRemarks } : item)));
    
    const { error } = await supabase.from("it_assets").update({ remarks: nextRemarks }).eq("id", r.id);
    if (error) {
      alert("Database error updating budget inclusion: " + error.message);
      load();
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (isEmployee) {
        const myName = (profile?.full_name || "").trim().toLowerCase();
        const myEmail = (profile?.email || "").trim().toLowerCase();
        const myCode = (profile?.staff_code || "").trim().toLowerCase();

        const staff = (r.staff_name || "").trim().toLowerCase();
        const staffCode = (r.staff_code || "").trim().toLowerCase();

        if (!staff && !staffCode) return false;

        const isMatch =
          staff === myName ||
          staff === myEmail ||
          (myCode && staffCode === myCode);

        if (!isMatch) return false;
      }
      if (year !== "all" && r.budget_year !== Number(year)) return false;
      if (month !== "all") {
        const m = (r.purchase_date || "").substring(5, 7);
        if (m !== month) return false;
      }
      if (cat !== "all" && r.category_id !== cat) return false;
      if (typeFilter !== "all" && (r.it_categories?.category_type || "capex") !== typeFilter) return false;
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
  }, [rows, q, year, month, cat, typeFilter, scope, status, budgetFilter, sort, isEmployee, profile]);

  const totals = useMemo(() => {
    const t = { value: 0, qty: 0, local: 0, global: 0, itBudget: 0, excluded: 0 };
    filtered.forEach((r) => {
      const val = Number(r.line_total);
      t.value += val;
      t.qty += r.quantity;
      t[r.scope === "global" ? "global" : "local"] += val;
      if (isIncludedInBudget(r)) {
        t.itBudget += val;
      } else {
        t.excluded += val;
      }
    });
    return t;
  }, [filtered]);

  const [erpModalOpen, setErpModalOpen] = useState(false);
  const [erpTab, setErpTab] = useState("api"); // "api" | "json"
  const [erpForm, setErpForm] = useState({
    url: "https://hydraspecma-prod.operations.dynamics.com/data/FixedAssets",
    username: "",
    password: "",
    jsonText: "",
  });
  const [erpBusy, setErpBusy] = useState(false);
  const [erpMsg, setErpMsg] = useState(null);
  const [erpResult, setErpResult] = useState(null);

  const [d365MasterList, setD365MasterList] = useState([]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("itbm_d365_master");
        if (saved) setD365MasterList(JSON.parse(saved));
      } catch (err) {}
    }
  }, []);

  async function handleD365Sync(e) {
    if (e) e.preventDefault();
    setErpBusy(true);
    setErpMsg(null);
    setErpResult(null);

    try {
      let parsed = [];
      let jsonStr = erpForm.jsonText.trim();
      if (!jsonStr) throw new Error("Please paste or fetch D365FO OData response.");

      try {
        const raw = JSON.parse(jsonStr);
        parsed = Array.isArray(raw) ? raw : (raw.value || []);
      } catch (err) {
        throw new Error("Invalid JSON format. Please ensure you copied the complete D365FO OData response.");
      }

      if (parsed.length > 0) {
        setD365MasterList(parsed);
        if (typeof window !== "undefined") {
          localStorage.setItem("itbm_d365_master", JSON.stringify(parsed));
        }
      }

      const res = await fetch("/api/d365-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDept: dept, syncMode: "manual", manualItems: parsed }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Sync failed");

      setErpResult(data);
      setErpMsg({ t: "ok", m: `Successfully synced! Loaded ${parsed.length} D365 Master assets into dropdown selection list and updated ${data.updatedCount} database items.` });
      load();
    } catch (err) {
      setErpMsg({ t: "err", m: err.message || String(err) });
    } finally {
      setErpBusy(false);
    }
  }

  async function autoFetchD365Directly() {
    setErpBusy(true);
    setErpMsg(null);
    const filterUrl = "https://hydraspecma-prod.operations.dynamics.com/data/FixedAssets?$select=FixedAssetNumber,FixedAssetGroupId,Name,SerialNumber";
    try {
      const res = await fetch(filterUrl, { credentials: "include" });
      if (!res.ok) throw new Error("CORS / Authentication required");
      const data = await res.json();
      const items = data.value || [];
      setErpForm({ ...erpForm, jsonText: JSON.stringify(items, null, 2) });
      setD365MasterList(items);
      if (typeof window !== "undefined") {
        localStorage.setItem("itbm_d365_master", JSON.stringify(items));
      }
      setErpMsg({ t: "ok", m: `Auto-pulled ${items.length} Fixed Assets directly from D365FO! Loaded into asset dropdown list.` });
    } catch (err) {
      window.open(filterUrl, "D365DataWindow", "width=1024,height=768,scrollbars=yes,resizable=yes");
      setErpMsg({ t: "err", m: "Direct fetch requires SSO session in tab. Opened filtered OData tab; copy and paste JSON below." });
    } finally {
      setErpBusy(false);
    }
  }

  function startBulkGridEdit() {
    const initial = {};
    filtered.forEach((r) => {
      initial[r.id] = {
        asset_no: r.asset_no || "",
        asset_group_id: r.asset_group_id || "",
        category_id: r.category_id || "",
        scope: r.scope || "local",
        staff_name: r.staff_name || "",
        department: r.department || "",
        warranty_end: r.warranty_end || "",
        remarks: r.remarks || "",
      };
    });
    setBulkForms(initial);
    setBulkEdit(true);
  }

  async function saveBulkGridEdit() {
    setBulkSaving(true);
    try {
      for (const r of filtered) {
        const f = bulkForms[r.id];
        if (!f) continue;
        if (
          f.asset_no !== r.asset_no ||
          f.asset_group_id !== r.asset_group_id ||
          f.category_id !== r.category_id ||
          f.scope !== r.scope ||
          f.staff_name !== r.staff_name ||
          f.department !== r.department ||
          f.warranty_end !== r.warranty_end ||
          f.remarks !== r.remarks
        ) {
          await supabase.from("it_assets").update({
            asset_no: f.asset_no || null,
            asset_group_id: f.asset_group_id || null,
            category_id: f.category_id || null,
            scope: f.scope || "local",
            staff_name: f.staff_name || null,
            department: f.department || null,
            warranty_end: f.warranty_end || null,
            remarks: f.remarks || null,
          }).eq("id", r.id);
        }
      }
      setBulkEdit(false);
      load();
    } catch (err) {
      alert("Error saving bulk edits: " + err.message);
    } finally {
      setBulkSaving(false);
    }
  }

  function exportCsv() {
    csvDownload("asset-register.csv", filtered.map((r) => ({
      asset_name: r.asset_name,
      asset_no_erp: r.asset_no || "",
      asset_group_id: r.asset_group_id || "",
      asset_tag: r.asset_tag || "",
      serial_no: r.serial_no || "",
      model: r.model || "",
      category: r.it_categories?.name || "",
      scope: r.scope,
      include_in_it_budget: r.include_in_budget !== false ? "Yes" : "No (Admin/Dept)",
      item_type: r.item_type,
      staff_name: r.staff_name || "",
      department: r.department || "",
      location: r.location || "",
      quantity: r.quantity,
      unit_cost: r.unit_cost,
      line_total: r.line_total,
      purchase_date: r.purchase_date,
      warranty_end: r.warranty_end || "",
      license_end: r.license_end || "",
      amc_end: r.amc_end || "",
      replacement_due: r.replacement_due || "",
      status: r.status,
      invoice_no: r.it_invoices?.invoice_no || "",
      vendor: r.it_invoices?.it_vendors?.name || "",
    })));
  }

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [savingId, setSavingId] = useState(null);

  function startInlineEdit(r) {
    setEditingId(r.id);
    setEditForm({
      category_id: r.category_id || "",
      scope: r.scope || "local",
      staff_name: r.staff_name || "",
      department: r.department || "",
      warranty_end: r.warranty_end || "",
      remarks: r.remarks || "",
    });
  }

  function handleStaffSelection(empName) {
    const matchedEmp = employees.find((e) => e.full_name === empName);
    setEditForm((prev) => ({
      ...prev,
      staff_name: empName,
      department: matchedEmp ? matchedEmp.department : prev.department,
    }));
  }

  async function saveInlineEdit(r) {
    setSavingId(r.id);
    const updates = {
      category_id: editForm.category_id || null,
      scope: editForm.scope || "local",
      staff_name: editForm.staff_name || null,
      department: editForm.department || null,
      warranty_end: editForm.warranty_end || null,
      remarks: editForm.remarks || null,
    };

    const { error } = await supabase.from("it_assets").update(updates).eq("id", r.id);
    setSavingId(null);
    if (error) {
      alert("Error saving line: " + error.message);
    } else {
      setEditingId(null);
      load();
    }
  }

  async function splitAssetLine(r) {
    if (r.quantity <= 1) return alert("Quantity is 1. Nothing to split.");
    
    if (!confirm(`Split "${r.asset_name}" (Qty: ${r.quantity}) into ${r.quantity} separate 1-qty line items?`)) {
      return;
    }

    setLoading(true);
    try {
      const { error: updateErr } = await supabase.from("it_assets").update({ quantity: 1 }).eq("id", r.id);
      if (updateErr) throw updateErr;

      const newCount = r.quantity - 1;
      const newItems = [];
      for (let i = 0; i < newCount; i++) {
        newItems.push({
          invoice_id: r.invoice_id || null,
          asset_name: r.asset_name,
          asset_tag: r.asset_tag ? `${r.asset_tag}-${i + 2}` : null,
          serial_no: r.serial_no ? `${r.serial_no}-${i + 2}` : null,
          model: r.model || null,
          category_id: r.category_id,
          scope: r.scope || "local",
          item_type: r.item_type || "hardware",
          staff_name: null,
          staff_code: null,
          department: null,
          location: r.location || null,
          quantity: 1,
          unit_cost: r.unit_cost,
          purchase_date: r.purchase_date,
          warranty_end: r.warranty_end || null,
          license_end: r.license_end || null,
          amc_end: r.amc_end || null,
          replacement_due: r.replacement_due || null,
          status: r.status || "in_use",
          remarks: r.remarks || null,
        });
      }

      const { error: insertErr } = await supabase.from("it_assets").insert(newItems);
      if (insertErr) throw insertErr;

      load();
    } catch (e) {
      alert("Error splitting asset: " + e.message);
      setLoading(false);
    }
  }

  async function splitAllMultiQtyAssets() {
    const multiQtyRows = rows.filter((r) => r.quantity > 1);
    if (!multiQtyRows.length) return alert("No multi-quantity assets found.");

    if (!confirm(`Found ${multiQtyRows.length} assets with Qty > 1. Auto-split all into individual 1-qty line items?`)) {
      return;
    }

    setLoading(true);
    try {
      for (const r of multiQtyRows) {
        await supabase.from("it_assets").update({ quantity: 1 }).eq("id", r.id);

        const newCount = r.quantity - 1;
        const newItems = [];
        for (let i = 0; i < newCount; i++) {
          newItems.push({
            invoice_id: r.invoice_id || null,
            asset_name: r.asset_name,
            asset_tag: r.asset_tag ? `${r.asset_tag}-${i + 2}` : null,
            serial_no: r.serial_no ? `${r.serial_no}-${i + 2}` : null,
            model: r.model || null,
            category_id: r.category_id,
            scope: r.scope || "local",
            item_type: r.item_type || "hardware",
            staff_name: null,
            staff_code: null,
            department: null,
            location: r.location || null,
            quantity: 1,
            unit_cost: r.unit_cost,
            purchase_date: r.purchase_date,
            warranty_end: r.warranty_end || null,
            license_end: r.license_end || null,
            amc_end: r.amc_end || null,
            replacement_due: r.replacement_due || null,
            status: r.status || "in_use",
            remarks: r.remarks || null,
          });
        }
        await supabase.from("it_assets").insert(newItems);
      }
      load();
    } catch (e) {
      alert("Error splitting assets: " + e.message);
      setLoading(false);
    }
  }

  return (
    <Shell
      title="Asset Register"
      subtitle={`Complete ${dept === "All" ? "Department" : dept} asset inventory with scope, user and budget tracking`}
      actions={
        <div style={{ display: "flex", gap: 10 }}>
          {isAdmin && (
            <button
              className="btn ghost sm"
              onClick={() => setErpModalOpen(true)}
              style={{ color: "var(--gold)", borderColor: "var(--gold)", fontWeight: 700 }}
              title="Sync FixedAssetNumber and FixedAssetGroupId from Microsoft Dynamics 365 FO ERP"
            >
              🔄 Sync D365 ERP
            </button>
          )}
          {isAdmin && (
            bulkEdit ? (
              <>
                <button className="btn sm" onClick={saveBulkGridEdit} disabled={bulkSaving}>
                  {bulkSaving ? "Saving All…" : "💾 Save All Changes"}
                </button>
                <button className="btn ghost sm" onClick={() => setBulkEdit(false)}>✕ Cancel</button>
              </>
            ) : (
              <>
                {rows.some((r) => r.quantity > 1) && (
                  <button
                    className="btn ghost sm"
                    onClick={splitAllMultiQtyAssets}
                    style={{ borderColor: "var(--gold)", color: "var(--gold)" }}
                    title="Split all multi-qty items into 1-qty lines to assign to individual employees"
                  >
                    ✂️ Auto-Split Multi-Qty
                  </button>
                )}
                <button className="btn ghost sm" onClick={startBulkGridEdit} style={{ borderColor: "var(--gold)", color: "var(--gold)" }}>
                  ⚡ Bulk Grid Edit Mode
                </button>
              </>
            )
          )}
          <button className="btn ghost sm" onClick={exportCsv}>Export CSV</button>
        </div>
      }
    >
      {!isEmployee && (
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Kpi label="Items shown" value={filtered.length} foot={`${totals.qty} units`} />
          <Kpi label="Total Asset Value" value={money(totals.value)} tone="gold" />
          <Kpi label="IT Budget Spend" value={money(totals.itBudget)} foot="Counted in IT Budget" />
          <Kpi label="Admin / Dept Spend" value={money(totals.excluded)} foot="Excluded from IT Budget" />
        </div>
      )}

      {isEmployee && (
        <div className="grid g2" style={{ marginBottom: 16 }}>
          <Kpi label="Assets Assigned to Me" value={filtered.length} foot={`${totals.qty} total units`} tone="gold" />
          <Kpi label="Assigned User" value={profile?.full_name || "Employee"} foot={profile?.email || ""} />
        </div>
      )}

      <div className="toolbar">
        <div className="field" style={{ minWidth: 240, flex: 1 }}>
          <span className="field-label">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Asset, serial, staff, invoice, vendor…" />
        </div>
        {!isEmployee && (
          <>
            <div className="field">
              <span className="field-label">Year</span>
              <select value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="all">All years</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="field-label">Month</span>
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                <option value="all">All months</option>
                <option value="01">January</option>
                <option value="02">February</option>
                <option value="03">March</option>
                <option value="04">April</option>
                <option value="05">May</option>
                <option value="06">June</option>
                <option value="07">July</option>
                <option value="08">August</option>
                <option value="09">September</option>
                <option value="10">October</option>
                <option value="11">November</option>
                <option value="12">December</option>
              </select>
            </div>
          </>
        )}
        <div className="field">
          <span className="field-label">Category</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">CapEx / OpEx</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All Types</option>
            <option value="capex">CapEx Only</option>
            <option value="opex">OpEx Only</option>
          </select>
        </div>
        {!isEmployee && (
          <>
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
          </>
        )}
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
            {!isEmployee && <option value="cost">Highest cost</option>}
            <option value="name">Asset name</option>
            <option value="staff">Staff name</option>
          </select>
        </div>
      </div>

      <Card title={isEmployee ? "My Assigned Assets" : "Asset Register Lines"} hint={bulkEdit ? "⚡ Bulk Grid Edit Mode ACTIVE: Edit fields directly in table cells below" : "Click '✏️ Edit' on any row for instant inline grid editing"}>
        {loading ? <div className="loading">Loading…</div> : filtered.length === 0 ? (
          <Empty>{isEmployee ? "No assets are currently assigned to your account." : "No assets match these filters."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Asset No (ERP)</th>
                  <th>Category</th>
                  {!isEmployee && <th>Scope</th>}
                  {!isEmployee && <th>IT Budget?</th>}
                  <th>Staff Name</th>
                  <th>Department</th>
                  <th>Purchased</th>
                  {!isEmployee && <th>Warranty End</th>}
                  <th>Remarks</th>
                  <th className="num">Qty</th>
                  {!isEmployee && <th className="num">Value</th>}
                  {isAdmin && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isItBudget = isIncludedInBudget(r);
                  const isEditing = editingId === r.id;
                  const isSaving = savingId === r.id;
                  const bForm = bulkForms[r.id] || {};

                  if (bulkEdit) {
                    return (
                      <tr key={r.id} style={{ background: "rgba(255,204,0,0.06)" }}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.asset_name}</div>
                          <div style={{ fontSize: 11, color: "var(--faint)" }}>
                            {[r.asset_tag, r.model, r.serial_no].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        <td>
                          {d365MasterList.length > 0 && (
                            <select
                              value={bForm.asset_no || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                const matched = d365MasterList.find((item) => (item.FixedAssetNumber || item.asset_no) === val);
                                if (matched) {
                                  setBulkForms({
                                    ...bulkForms,
                                    [r.id]: {
                                      ...bForm,
                                      asset_no: matched.FixedAssetNumber || matched.asset_no,
                                      asset_group_id: matched.FixedAssetGroupId || matched.asset_group_id || bForm.asset_group_id,
                                    },
                                  });
                                } else {
                                  setBulkForms({ ...bulkForms, [r.id]: { ...bForm, asset_no: val } });
                                }
                              }}
                              style={{ padding: "3px 6px", fontSize: 11, width: 120, marginBottom: 4, border: "1px solid var(--gold)" }}
                              title="Pick an ERP asset to auto-populate Asset No and Group ID"
                            >
                              <option value="">-- Pick D365 Asset --</option>
                              {d365MasterList.map((item, idx) => {
                                const num = item.FixedAssetNumber || item.asset_no;
                                const grp = item.FixedAssetGroupId || item.asset_group_id || "";
                                const name = item.Name || item.asset_name || "";
                                return (
                                  <option key={idx} value={num}>
                                    {num} {grp ? `(${grp})` : ""} — {name.slice(0, 18)}
                                  </option>
                                );
                              })}
                            </select>
                          )}
                          <input
                            type="text"
                            placeholder="D365 Asset No"
                            value={bForm.asset_no || ""}
                            onChange={(e) => setBulkForms({ ...bulkForms, [r.id]: { ...bForm, asset_no: e.target.value } })}
                            style={{ padding: "4px 6px", fontSize: 12, width: 110 }}
                          />
                          <input
                            type="text"
                            placeholder="Group ID"
                            value={bForm.asset_group_id || ""}
                            onChange={(e) => setBulkForms({ ...bulkForms, [r.id]: { ...bForm, asset_group_id: e.target.value } })}
                            style={{ padding: "3px 6px", fontSize: 11, width: 110, marginTop: 2 }}
                          />
                        </td>
                        <td>
                          <select
                            value={bForm.category_id || ""}
                            onChange={(e) => setBulkForms({ ...bulkForms, [r.id]: { ...bForm, category_id: e.target.value } })}
                            style={{ padding: "4px 6px", fontSize: 12 }}
                          >
                            <option value="">— Category —</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={bForm.scope || "local"}
                            onChange={(e) => setBulkForms({ ...bulkForms, [r.id]: { ...bForm, scope: e.target.value } })}
                            style={{ padding: "4px 6px", fontSize: 12 }}
                          >
                            <option value="local">Local</option>
                            <option value="global">Global</option>
                          </select>
                        </td>
                        <td>
                          <span className={`pill ${isItBudget ? "gold" : "grey"}`}>
                            {isItBudget ? "✓ IT Budget" : "✕ Admin/Dept"}
                          </span>
                        </td>
                        <td>
                          <select
                            value={bForm.staff_name || ""}
                            onChange={(e) => {
                              const empName = e.target.value;
                              const matched = employees.find((emp) => emp.full_name === empName);
                              setBulkForms({
                                ...bulkForms,
                                [r.id]: {
                                  ...bForm,
                                  staff_name: empName,
                                  department: matched ? matched.department : bForm.department,
                                },
                              });
                            }}
                            style={{ padding: "4px 6px", fontSize: 12, minWidth: 140 }}
                          >
                            <option value="">— Select Staff —</option>
                            {employees.map((emp) => (
                              <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={bForm.department || ""}
                            onChange={(e) => setBulkForms({ ...bulkForms, [r.id]: { ...bForm, department: e.target.value } })}
                            style={{ padding: "4px 6px", fontSize: 12, minWidth: 120 }}
                          >
                            <option value="">— Select Dept —</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.name}>{d.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>{dateStr(r.purchase_date)}</td>
                        <td>
                          <input
                            type="date"
                            value={bForm.warranty_end || ""}
                            onChange={(e) => setBulkForms({ ...bulkForms, [r.id]: { ...bForm, warranty_end: e.target.value } })}
                            style={{ padding: "4px 6px", fontSize: 12, width: 130 }}
                          />
                        </td>
                        <td>
                          <input
                            value={bForm.remarks || ""}
                            onChange={(e) => setBulkForms({ ...bulkForms, [r.id]: { ...bForm, remarks: e.target.value } })}
                            placeholder="Remarks"
                            style={{ padding: "4px 6px", fontSize: 12, width: 120 }}
                          />
                        </td>
                        <td className="num mono">{r.quantity}</td>
                        <td className="num mono" style={{ fontWeight: 600 }}>{money(r.line_total)}</td>
                        <td>—</td>
                      </tr>
                    );
                  }

                  if (isEditing) {
                    return (
                      <tr key={r.id} style={{ background: "rgba(255,204,0,0.08)" }}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.asset_name}</div>
                          <div style={{ fontSize: 11, color: "var(--faint)" }}>
                            {[r.asset_tag, r.model, r.serial_no].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        <td>
                          <span className="pill gold" style={{ fontSize: 11 }}>{r.asset_no || "—"}</span>
                        </td>
                        <td>
                          <select
                            value={editForm.category_id}
                            onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })}
                            style={{ padding: "4px 6px", fontSize: 12 }}
                          >
                            <option value="">— Category —</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={editForm.scope}
                            onChange={(e) => setEditForm({ ...editForm, scope: e.target.value })}
                            style={{ padding: "4px 6px", fontSize: 12 }}
                          >
                            <option value="local">Local</option>
                            <option value="global">Global</option>
                          </select>
                        </td>
                        <td>
                          <span className={`pill ${isItBudget ? "gold" : "grey"}`}>
                            {isItBudget ? "✓ IT Budget" : "✕ Admin/Dept"}
                          </span>
                        </td>
                        <td>
                          <select
                            value={editForm.staff_name}
                            onChange={(e) => handleStaffSelection(e.target.value)}
                            style={{ padding: "4px 6px", fontSize: 12, minWidth: 140 }}
                          >
                            <option value="">— Select Staff —</option>
                            {employees.map((emp) => (
                              <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={editForm.department}
                            onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                            style={{ padding: "4px 6px", fontSize: 12, minWidth: 120 }}
                          >
                            <option value="">— Select Dept —</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.name}>{d.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="mono" style={{ fontSize: 12 }}>{dateStr(r.purchase_date)}</td>
                        <td>
                          <input
                            type="date"
                            value={editForm.warranty_end}
                            onChange={(e) => setEditForm({ ...editForm, warranty_end: e.target.value })}
                            style={{ padding: "4px 6px", fontSize: 12, width: 130 }}
                          />
                        </td>
                        <td>
                          <input
                            value={editForm.remarks}
                            onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                            placeholder="Remarks"
                            style={{ padding: "4px 6px", fontSize: 12, width: 130 }}
                          />
                        </td>
                        <td className="num mono">{r.quantity}</td>
                        <td className="num mono" style={{ fontWeight: 600 }}>{money(r.line_total)}</td>
                        <td>
                          <div className="btn-row">
                            <button className="btn sm" onClick={() => saveInlineEdit(r)} disabled={isSaving}>
                              {isSaving ? "…" : "💾 Save"}
                            </button>
                            <button className="btn ghost sm" onClick={() => setEditingId(null)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={r.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.asset_name}</div>
                        <div style={{ fontSize: 11, color: "var(--faint)" }}>
                          {[r.asset_tag, r.model, r.serial_no].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td>
                        {r.asset_no ? (
                          <div>
                            <span className="pill gold" style={{ fontSize: 11, padding: "2px 6px" }}>{r.asset_no}</span>
                            {r.asset_group_id && (
                              <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 2 }}>
                                Grp: {r.asset_group_id}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--faint)" }}>—</span>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.it_categories?.name || "—"}</div>
                        {r.it_categories?.category_type && (
                          <span className={`pill ${r.it_categories.category_type === "opex" ? "amber" : "blue"}`} style={{ fontSize: 9, padding: "1px 5px", marginTop: 2 }}>
                            {r.it_categories.category_type.toUpperCase()}
                          </span>
                        )}
                      </td>
                      {!isEmployee && (
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
                      )}
                      {!isEmployee && (
                        <td>
                          <button
                            className={`pill ${isItBudget ? "gold" : "grey"}`}
                            onClick={() => toggleBudgetInclude(r)}
                            style={{ cursor: "pointer", border: "1px solid var(--hs-charcoal)" }}
                            title="Click to toggle IT Budget vs Admin/Dept Budget"
                          >
                            {isItBudget ? "✓ IT Budget" : "✕ Admin/Dept"}
                          </button>
                        </td>
                      )}
                      <td style={{ fontWeight: 600 }}>{r.staff_name || "—"}</td>
                      <td><span className="pill grey">{r.department || "—"}</span></td>
                      <td className="mono" style={{ fontSize: 12 }}>{dateStr(r.purchase_date)}</td>
                      {!isEmployee && <td className="mono" style={{ fontSize: 12 }}>{dateStr(r.warranty_end)}</td>}
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{r.remarks || "—"}</td>
                      <td className="num mono">{r.quantity}</td>
                      {!isEmployee && (
                        <td className="num mono" style={{ opacity: isItBudget ? 1 : 0.65 }}>
                          {money(r.line_total)}
                        </td>
                      )}
                      {isAdmin && (
                        <td>
                          <div className="btn-row">
                            <button className="btn ghost sm" onClick={() => startInlineEdit(r)}>
                              ✏️ Edit
                            </button>
                            {r.quantity > 1 && (
                              <button
                                className="btn ghost sm"
                                onClick={() => splitAssetLine(r)}
                                style={{ borderColor: "var(--gold)", color: "var(--gold)" }}
                                title={`Split ${r.quantity} quantity into ${r.quantity} separate 1-qty items so each can be assigned to a different employee`}
                              >
                                ✂️ Split Qty
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={isEmployee ? 7 : 10}>Total</td>
                  <td className="num mono">{totals.qty}</td>
                  {!isEmployee && <td className="num mono">{money(totals.value)}</td>}
                  {isAdmin && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {erpModalOpen && (
        <div className="modal-backdrop" onClick={() => setErpModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                <span>🔄 D365FO ERP Fixed Assets Interactive Sync</span>
              </h3>
              <button className="btn ghost sm" onClick={() => setErpModalOpen(false)}>✕</button>
            </div>

            <div style={{ background: "rgba(255, 204, 0, 0.08)", border: "1px solid var(--gold)", borderRadius: 8, padding: 14, marginTop: 12, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "var(--gold)", marginBottom: 6 }}>
                📌 D365FO Filtered Single Sign-On Sync Workflow:
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--fg)", lineHeight: 1.6 }}>
                <li>Click <strong>Step 1</strong> to log in to D365FO with your HydraSpecma Microsoft credentials.</li>
                <li>Click <strong>Step 2</strong> to auto-fetch or open the optimized filtered OData feed (<code>FixedAssetNumber, FixedAssetGroupId, Name, SerialNumber</code>).</li>
                <li>Fetched assets automatically populate the <strong>ERP Asset Selector dropdown</strong> in the Asset Register!</li>
              </ol>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn sm"
                  style={{ background: "var(--gold-dim)", color: "var(--gold)", border: "1px solid var(--gold)", fontWeight: 700, padding: "9px 10px", fontSize: 12 }}
                  onClick={() => {
                    window.open(
                      "https://hydraspecma-prod.operations.dynamics.com/",
                      "D365LoginWindow",
                      "width=1024,height=768,scrollbars=yes,resizable=yes"
                    );
                  }}
                >
                  🔑 Step 1: Sign In to D365FO ↗
                </button>
                <button
                  type="button"
                  className="btn sm"
                  style={{ background: "var(--gold)", color: "#000", fontWeight: 700, padding: "9px 10px", fontSize: 12 }}
                  onClick={autoFetchD365Directly}
                >
                  ⚡ Step 2: Auto-Fetch Filtered Data ↗
                </button>
              </div>
            </div>

            {erpMsg && (
              <div className={`alert ${erpMsg.t === "ok" ? "success" : "danger"}`} style={{ marginBottom: 14 }}>
                {erpMsg.m}
              </div>
            )}

            <form onSubmit={handleD365Sync}>
              <div className="field" style={{ marginBottom: 12 }}>
                <label className="field-label" style={{ fontWeight: 600 }}>
                  Step 2: Paste D365FO FixedAssets OData Response or Screen Text
                </label>
                <textarea
                  rows={7}
                  value={erpForm.jsonText}
                  onChange={(e) => setErpForm({ ...erpForm, jsonText: e.target.value })}
                  placeholder={`Paste D365 OData JSON here (e.g.):\n{\n  "value": [\n    {\n      "FixedAssetNumber": "FA-001928",\n      "FixedAssetGroupId": "COMP-HW",\n      "Name": "Dell Laptop 5540",\n      "SerialNumber": "SN-9812938"\n    }\n  ]\n}`}
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                  required
                />
              </div>

              <div className="modal-footer" style={{ justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  Auto-extracts FixedAssetNumber & FixedAssetGroupId
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn ghost sm" onClick={() => setErpModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn sm" disabled={erpBusy}>
                    {erpBusy ? "Syncing with Database…" : "⚡ Extract & Sync All Assets"}
                  </button>
                </div>
              </div>
            </form>

            {erpResult && erpResult.matchedDetails && erpResult.matchedDetails.length > 0 && (
              <div style={{ marginTop: 16, borderTop: "1px solid var(--hs-charcoal)", paddingTop: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--gold)", marginBottom: 8 }}>
                  ✅ Matched & Updated {erpResult.matchedDetails.length} Asset Item(s):
                </div>
                <div style={{ maxHeight: 160, overflowY: "auto", fontSize: 12 }}>
                  {erpResult.matchedDetails.map((item, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <span>{item.asset_name}</span>
                      <span className="mono gold">Asset No: {item.asset_no} (Grp: {item.group_id})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
