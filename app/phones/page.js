"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell, { isPhoneModuleAuthorized } from "@/components/Shell";
import { Card, Field, Modal, Empty } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, dateStr, todayISO, daysUntil, csvDownload } from "@/lib/format";
import { useAuth } from "@/lib/session";
import { useDept } from "@/lib/department";

const PHONE_TIERS = [
  { id: "iPhone (₹55k)", label: "iPhone (Budget ₹55,000)", budget: 55000, icon: "🍏", desc: "Executive Tier (Budget: ₹55,000)" },
  { id: "Android High (₹55k)", label: "Android High (Budget ₹55,000)", budget: 55000, icon: "🤖", desc: "Premium Android Tier (Budget: ₹55,000)" },
  { id: "Android Standard (₹25k)", label: "Android Standard (Budget ₹25,000)", budget: 25000, icon: "📱", desc: "Standard Staff Tier (Budget: ₹25,000)" },
];

const STATUS_OPTIONS = [
  "Active",
  "Eligible",
  "Applied",
  "Expiring Soon",
  "Expired",
  "Not Eligible",
];

const blankForm = (defaultDept = "IT") => ({
  employee_name: "",
  employee_code: "",
  department: defaultDept,
  phone_category: "Android Standard (₹25k)",
  budget_amount: 25000,
  eligible_date: todayISO(),
  received_date: "",
  expiry_date: "",
  device_details: "",
  serial_imei: "",
  status: "Eligible",
  remarks: "",
});

export default function PhonesPage() {
  const { profile } = useAuth();
  const { dept, isDeptAdmin, departments } = useDept();
  const canEdit = isDeptAdmin;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState(dept || "All");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [form, setForm] = useState(blankForm(dept === "All" ? "IT" : dept));
  const [saving, setSaving] = useState(false);

  // Employee Master Lookup State
  const [masterEmployees, setMasterEmployees] = useState([]);
  const [empSearchQuery, setEmpSearchQuery] = useState("");
  const [empDropdownOpen, setEmpDropdownOpen] = useState(false);

  const loadMasterEmployees = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("it_employees")
        .select("id, full_name, email, department, job_title")
        .eq("is_active", true)
        .order("full_name");
      setMasterEmployees(data || []);
    } catch (err) {
      console.error("Failed to load employee master:", err);
    }
  }, []);

  useEffect(() => {
    loadMasterEmployees();
  }, [loadMasterEmployees]);

  const filteredMasterEmployees = useMemo(() => {
    if (!empSearchQuery.trim()) return masterEmployees.slice(0, 30);
    const sq = empSearchQuery.toLowerCase();
    return masterEmployees
      .filter(
        (e) =>
          (e.full_name || "").toLowerCase().includes(sq) ||
          (e.email || "").toLowerCase().includes(sq) ||
          (e.department || "").toLowerCase().includes(sq) ||
          (e.job_title || "").toLowerCase().includes(sq)
      )
      .slice(0, 30);
  }, [masterEmployees, empSearchQuery]);

  // Combined list of all departments (budget depts + employee master depts + existing row depts)
  const allDepartmentsList = useMemo(() => {
    const set = new Set([
      ...departments,
      ...masterEmployees.map((e) => e.department).filter(Boolean),
      ...rows.map((r) => r.department).filter(Boolean),
    ]);
    return Array.from(set).sort();
  }, [departments, masterEmployees, rows]);

  // Grid Inline Employee Combobox State & Helpers
  const [gridEmpFocusId, setGridEmpFocusId] = useState(null);
  const [gridEmpQuery, setGridEmpQuery] = useState("");

  const getGridFilteredEmps = useCallback(
    (queryStr) => {
      const sq = (queryStr || "").trim().toLowerCase();
      if (!sq) return masterEmployees.slice(0, 20);
      return masterEmployees
        .filter(
          (e) =>
            (e.full_name || "").toLowerCase().includes(sq) ||
            (e.email || "").toLowerCase().includes(sq) ||
            (e.department || "").toLowerCase().includes(sq)
        )
        .slice(0, 20);
    },
    [masterEmployees]
  );

  function handleSelectEmpForGridRow(rowKey, emp) {
    setGridRows((prev) =>
      prev.map((r) => {
        const match = r.id === rowKey || r.tempId === rowKey;
        if (!match) return r;
        return {
          ...r,
          employee_name: emp.full_name,
          employee_code: emp.email || r.employee_code,
          department: emp.department || r.department,
        };
      })
    );
  }

  useEffect(() => {
    setDeptFilter(dept);
  }, [dept]);

  const loadData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);

    try {
      let query = supabase.from("it_phone_allocations").select("*").order("created_at", { ascending: false });

      const activeDept = deptFilter || dept;
      if (activeDept && activeDept !== "All") {
        query = query.or(`department.eq.${activeDept},budget_department.eq.${activeDept}`);
      }

      const { data, error } = await query;
      if (error) throw error;

      setRows(data || []);
    } catch (err) {
      console.error("Failed to load phone allocations:", err);
    } finally {
      setLoading(false);
    }
  }, [profile, deptFilter, dept]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute calculated values and filter rows
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tierFilter !== "all" && r.phone_category !== tierFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "Expired") {
          const isExp = r.status === "Expired" || (r.expiry_date && new Date(r.expiry_date) < new Date());
          if (!isExp) return false;
        } else if (r.status !== statusFilter) {
          return false;
        }
      }
      if (!q.trim()) return true;
      const search = q.toLowerCase();
      return [
        r.employee_name,
        r.employee_code,
        r.department,
        r.phone_category,
        r.device_details,
        r.serial_imei,
        r.remarks,
        r.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [rows, tierFilter, statusFilter, q]);

  // KPI Metrics
  const kpis = useMemo(() => {
    const totalCount = rows.length;
    let activeCount = 0;
    let eligibleCount = 0;
    let expiredCount = 0;
    let totalBudgetCommitment = 0;

    rows.forEach((r) => {
      const b = Number(r.budget_amount || 0);
      totalBudgetCommitment += b;

      const isExp = r.status === "Expired" || (r.expiry_date && new Date(r.expiry_date) < new Date());
      if (isExp) {
        expiredCount++;
      } else if (r.status === "Active") {
        activeCount++;
      } else if (r.status === "Eligible" || r.status === "Applied") {
        eligibleCount++;
      }
    });

    return { totalCount, activeCount, eligibleCount, expiredCount, totalBudgetCommitment };
  }, [rows]);

  function handleOpenAdd() {
    setEditingRow(null);
    const targetDept = dept === "All" ? (profile?.department || "IT") : dept;
    setForm(blankForm(targetDept));
    setEmpSearchQuery("");
    setEmpDropdownOpen(false);
    setModalOpen(true);
  }

  function handleOpenEdit(r) {
    setEditingRow(r);
    setForm({
      employee_name: r.employee_name || "",
      employee_code: r.employee_code || "",
      department: r.department || (dept === "All" ? "IT" : dept),
      phone_category: r.phone_category || "Android Standard (₹25k)",
      budget_amount: r.budget_amount || 25000,
      eligible_date: r.eligible_date || "",
      received_date: r.received_date || "",
      expiry_date: r.expiry_date || "",
      device_details: r.device_details || "",
      serial_imei: r.serial_imei || "",
      status: r.status || "Eligible",
      remarks: r.remarks || "",
    });
    setEmpSearchQuery(r.employee_name || "");
    setEmpDropdownOpen(false);
    setModalOpen(true);
  }

  function handleCategoryChange(catId) {
    const selectedTier = PHONE_TIERS.find((t) => t.id === catId);
    const budgetVal = selectedTier ? selectedTier.budget : 25000;
    setForm((prev) => ({
      ...prev,
      phone_category: catId,
      budget_amount: budgetVal,
    }));
  }

  // Helper for 3 years policy expiry calculation (Issue Date + 3 Years)
  function calcExpiryDate(receivedDateStr) {
    if (!receivedDateStr) return "";
    const parts = receivedDateStr.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10) + 3;
      const month = parts[1];
      const day = parts[2];
      return `${year}-${month}-${day}`;
    }
    const d = new Date(receivedDateStr);
    d.setFullYear(d.getFullYear() + 3);
    return d.toISOString().split("T")[0];
  }

  function handleReceivedDateChange(recDate) {
    const autoExp = recDate ? calcExpiryDate(recDate) : form.expiry_date;
    setForm((prev) => ({
      ...prev,
      received_date: recDate,
      expiry_date: autoExp,
      status: recDate ? (prev.status === "Eligible" ? "Active" : prev.status) : prev.status,
    }));
  }

  // Inline Grid Edit State & Handler Functions
  const [gridMode, setGridMode] = useState(false);
  const [gridRows, setGridRows] = useState([]);
  const [savingGrid, setSavingGrid] = useState(false);

  function enableGridMode() {
    setGridRows(filtered.map((r) => ({ ...r })));
    setGridMode(true);
  }

  function cancelGridMode() {
    setGridMode(false);
    setGridRows([]);
  }

  function addGridRow() {
    const targetDept = dept === "All" ? (profile?.department || "IT") : dept;
    const newRow = {
      tempId: "new_" + Date.now(),
      employee_name: "",
      employee_code: "",
      department: targetDept,
      phone_category: "Android Standard (₹25k)",
      budget_amount: 25000,
      eligible_date: todayISO(),
      received_date: "",
      expiry_date: "",
      device_details: "",
      serial_imei: "",
      status: "Eligible",
      remarks: "",
      budget_department: targetDept,
      isNew: true,
    };
    setGridRows((prev) => [newRow, ...prev]);
  }

  function handleGridChange(id, field, value) {
    setGridRows((prev) =>
      prev.map((r) => {
        const match = r.id === id || r.tempId === id;
        if (!match) return r;
        const updated = { ...r, [field]: value };
        if (field === "phone_category") {
          const tier = PHONE_TIERS.find((t) => t.id === value);
          if (tier) updated.budget_amount = tier.budget;
        }
        return updated;
      })
    );
  }

  function handleGridReceivedDateChange(id, recDate) {
    const autoExp = recDate ? calcExpiryDate(recDate) : "";
    setGridRows((prev) =>
      prev.map((r) => {
        const match = r.id === id || r.tempId === id;
        if (!match) return r;
        return {
          ...r,
          received_date: recDate,
          expiry_date: recDate ? autoExp : r.expiry_date,
          status: recDate && r.status === "Eligible" ? "Active" : r.status,
        };
      })
    );
  }

  function removeGridRow(id) {
    setGridRows((prev) => prev.filter((r) => r.id !== id && r.tempId !== id));
  }

  async function saveGridChanges() {
    setSavingGrid(true);
    try {
      let updatedCount = 0;
      let insertedCount = 0;

      for (const r of gridRows) {
        if (!r.employee_name || !r.employee_name.trim()) continue;

        const payload = {
          employee_name: r.employee_name.trim(),
          employee_code: (r.employee_code || "").trim() || null,
          department: r.department || (dept === "All" ? "IT" : dept),
          phone_category: r.phone_category || "Android Standard (₹25k)",
          budget_amount: Number(r.budget_amount || 25000),
          eligible_date: r.eligible_date || null,
          received_date: r.received_date || null,
          expiry_date: r.expiry_date || null,
          device_details: (r.device_details || "").trim() || null,
          serial_imei: (r.serial_imei || "").trim() || null,
          status: r.status || "Eligible",
          remarks: (r.remarks || "").trim() || null,
          budget_department: r.department || (dept === "All" ? "IT" : dept),
          updated_at: new Date().toISOString(),
        };

        if (r.isNew || !r.id) {
          const { error } = await supabase.from("it_phone_allocations").insert(payload);
          if (error) throw error;
          insertedCount++;
        } else {
          const orig = rows.find((o) => o.id === r.id);
          if (
            !orig ||
            r.employee_name !== orig.employee_name ||
            r.employee_code !== orig.employee_code ||
            r.department !== orig.department ||
            r.phone_category !== orig.phone_category ||
            Number(r.budget_amount) !== Number(orig.budget_amount) ||
            r.eligible_date !== orig.eligible_date ||
            r.received_date !== orig.received_date ||
            r.expiry_date !== orig.expiry_date ||
            r.device_details !== orig.device_details ||
            r.serial_imei !== orig.serial_imei ||
            r.status !== orig.status ||
            r.remarks !== orig.remarks
          ) {
            const { error } = await supabase.from("it_phone_allocations").update(payload).eq("id", r.id);
            if (error) throw error;
            updatedCount++;
          }
        }
      }

      setGridMode(false);
      await loadData();
      alert(`Grid changes saved successfully! (${updatedCount} updated, ${insertedCount} created)`);
    } catch (err) {
      console.error("Save grid error:", err);
      alert("Failed to save grid changes: " + (err.message || String(err)));
    } finally {
      setSavingGrid(false);
    }
  }

  async function handleSave(e) {
    if (e) e.preventDefault();
    if (!form.employee_name.trim()) {
      alert("Please enter Employee Name.");
      return;
    }

    setSaving(true);

    const payload = {
      employee_name: form.employee_name.trim(),
      employee_code: form.employee_code.trim() || null,
      department: form.department || (dept === "All" ? "IT" : dept),
      phone_category: form.phone_category,
      budget_amount: Number(form.budget_amount || 25000),
      eligible_date: form.eligible_date || null,
      received_date: form.received_date || null,
      expiry_date: form.expiry_date || null,
      device_details: form.device_details.trim() || null,
      serial_imei: form.serial_imei.trim() || null,
      status: form.status,
      remarks: form.remarks.trim() || null,
      budget_department: form.department || (dept === "All" ? "IT" : dept),
      updated_at: new Date().toISOString(),
    };

    try {
      if (editingRow?.id) {
        const { error } = await supabase.from("it_phone_allocations").update(payload).eq("id", editingRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("it_phone_allocations").insert(payload);
        if (error) throw error;
      }

      setModalOpen(false);
      await loadData();
    } catch (err) {
      console.error("Save phone allocation error:", err);
      alert("Failed to save allocation: " + (err.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r) {
    if (!confirm(`Are you sure you want to delete phone allocation record for ${r.employee_name}?`)) return;
    try {
      const { error } = await supabase.from("it_phone_allocations").delete().eq("id", r.id);
      if (error) throw error;
      await loadData();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  }

  function handleExportCsv() {
    csvDownload(
      `mobile-phone-allocation-register-${dept || "all"}.csv`,
      filtered.map((r) => ({
        "Employee Name": r.employee_name,
        "Employee Code": r.employee_code || "—",
        Department: r.department,
        "Phone Category Tier": r.phone_category,
        "Policy Budget (INR)": r.budget_amount,
        "Eligible Date": r.eligible_date ? dateStr(r.eligible_date) : "—",
        "Received Date": r.received_date ? dateStr(r.received_date) : "—",
        "Policy Expiry Date": r.expiry_date ? dateStr(r.expiry_date) : "—",
        Status: r.status,
        "Device Details": r.device_details || "—",
        "Serial / IMEI": r.serial_imei || "—",
        Remarks: r.remarks || "—",
      }))
    );
  }

  const isAuthorized = isPhoneModuleAuthorized(profile);

  if (profile && !isAuthorized) {
    return (
      <Shell title="📱 Mobile Phone Allocation" subtitle="Device Eligibility & Policy Management">
        <Card style={{ textAlign: "center", padding: "50px 20px", marginTop: 24, maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🔒</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--fg)", marginBottom: 10 }}>Access Restricted</h2>
          <p style={{ color: "var(--muted)", lineHeight: 1.6, marginBottom: 24, fontSize: 14 }}>
            The <strong>Mobile Phone Allocation</strong> module is strictly restricted to <strong>Global Reader</strong>, <strong>Global Admin</strong>, <strong>HR Admin</strong>, <strong>IT Admin</strong>, and <strong>Finance Admin</strong> roles only.
          </p>
          <div style={{ fontSize: 13, color: "var(--amber)", padding: "10px 16px", background: "rgba(255,204,0,0.08)", borderRadius: 8, marginBottom: 24, display: "inline-block" }}>
            Current Role: <strong>{profile?.role || "User"}</strong> ({profile?.department || "General"})
          </div>
          <div>
            <button className="btn primary" onClick={() => window.location.href = "/assets"}>
              ← Return to Asset Register
            </button>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell
      title="📱 Mobile Phone Allocation Module"
      subtitle={`${dept === "All" ? "All Departments" : dept} employee phone eligibility matrix, device tiers (iPhone ₹55k, Android ₹55k, Android ₹25k) & policy renewal tracking`}
      actions={
        gridMode ? (
          <>
            <button className="btn sm" onClick={addGridRow} style={{ background: "#2563eb", color: "#fff" }}>
              ➕ Add Quick Row
            </button>
            <button className="btn sm primary" onClick={saveGridChanges} disabled={savingGrid}>
              {savingGrid ? "Saving..." : "💾 Save All Changes"}
            </button>
            <button className="btn ghost sm" onClick={cancelGridMode}>
              ✕ Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn ghost sm" onClick={handleExportCsv}>
              Export CSV
            </button>
            {canEdit && (
              <>
                <button
                  className="btn ghost sm"
                  onClick={enableGridMode}
                  style={{ borderColor: "var(--gold)", color: "var(--gold)", fontWeight: 600 }}
                >
                  ✏️ Inline Grid Edit
                </button>
                <button className="btn sm" onClick={handleOpenAdd}>
                  + New Allocation
                </button>
              </>
            )}
          </>
        )
      }
    >
      {!canEdit && (
        <div style={{ padding: "10px 16px", background: "rgba(255,204,0,0.1)", border: "1px solid var(--gold)", borderRadius: 8, color: "var(--gold)", marginBottom: 16, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <span>ℹ️</span> View-Only Mode: You have read-only access for Phone Allocation records.
        </div>
      )}

      {gridMode && (
        <div style={{ padding: "12px 16px", background: "rgba(255,204,0,0.12)", border: "1px solid var(--gold)", borderRadius: 8, color: "var(--gold)", marginBottom: 16, fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <strong>✏️ Inline Grid Edit Mode Active:</strong> Edit employee records directly in table cells. Setting/updating a <em>Received Date (Issue Date)</em> automatically calculates <strong>Policy Expiry Date (3 Years)</strong>.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn sm" onClick={addGridRow} style={{ background: "#2563eb", color: "#fff" }}>
              ➕ Add Row
            </button>
            <button className="btn sm primary" onClick={saveGridChanges} disabled={savingGrid}>
              {savingGrid ? "Saving..." : "💾 Save All Changes"}
            </button>
            <button className="btn ghost sm" onClick={cancelGridMode}>Cancel</button>
          </div>
        </div>
      )}

      {/* KPI Header Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Total Monitored Employees
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "var(--fg)" }}>{kpis.totalCount}</div>
        </Card>

        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Active Issued Devices
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "#10b981" }}>{kpis.activeCount}</div>
        </Card>

        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Eligible / Pending
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "#8b5cf6" }}>{kpis.eligibleCount}</div>
        </Card>

        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Expired / Upgrade Due
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "#ef4444" }}>{kpis.expiredCount}</div>
        </Card>

        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Policy Budget Commitment
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "var(--gold)" }}>
            {money(kpis.totalBudgetCommitment)}
          </div>
        </Card>
      </div>

      {/* Model Tier Quick Filters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 20 }}>
        {PHONE_TIERS.map((tier) => {
          const isActiveFilter = tierFilter === tier.id;
          const count = rows.filter((r) => r.phone_category === tier.id).length;
          return (
            <Card
              key={tier.id}
              onClick={() => setTierFilter(isActiveFilter ? "all" : tier.id)}
              style={{
                padding: 14,
                cursor: "pointer",
                border: isActiveFilter ? "2px solid var(--gold)" : "1px solid var(--border)",
                background: isActiveFilter ? "rgba(255,204,0,0.06)" : "var(--bg-card)",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 20 }}>{tier.icon}</span>
                <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 12, background: "rgba(255,255,255,0.08)", fontWeight: 600 }}>
                  {count} Assigned
                </span>
              </div>
              <div style={{ fontWeight: 700, marginTop: 8, fontSize: 14, color: "var(--fg)" }}>{tier.id}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{tier.desc}</div>
            </Card>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <Card style={{ padding: 14, marginBottom: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <div style={{ flex: "1 1 240px" }}>
            <input
              type="text"
              placeholder="🔍 Search employee name, code, serial/IMEI, specs..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
            />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
            >
              <option value="All">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
            >
              <option value="all">All Phone Tiers</option>
              {PHONE_TIERS.map((t) => (
                <option key={t.id} value={t.id}>{t.id}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
            >
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Main Allocations Table or Inline Grid Mode */}
      {gridMode ? (
        <div style={{ overflowX: "auto", border: "1px solid var(--gold)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "rgba(255,204,0,0.15)", borderBottom: "1px solid var(--gold)", textAlign: "left" }}>
                <th style={{ padding: "8px 10px", minWidth: 160 }}>Employee Name *</th>
                <th style={{ padding: "8px 10px", minWidth: 140 }}>Code / Email</th>
                <th style={{ padding: "8px 10px", minWidth: 120 }}>Department</th>
                <th style={{ padding: "8px 10px", minWidth: 160 }}>Phone Category Tier</th>
                <th style={{ padding: "8px 10px", minWidth: 100 }}>Budget (₹)</th>
                <th style={{ padding: "8px 10px", minWidth: 130 }}>Eligible Date</th>
                <th style={{ padding: "8px 10px", minWidth: 135 }}>Received Date (Issue)</th>
                <th style={{ padding: "8px 10px", minWidth: 135 }}>Expiry Date (3Y)</th>
                <th style={{ padding: "8px 10px", minWidth: 120 }}>Status</th>
                <th style={{ padding: "8px 10px", minWidth: 150 }}>Device Details</th>
                <th style={{ padding: "8px 10px", minWidth: 140 }}>Serial / IMEI</th>
                <th style={{ padding: "8px 10px", minWidth: 140 }}>Remarks</th>
                <th style={{ padding: "8px 10px", textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {gridRows.map((r) => {
                const rowKey = r.id || r.tempId;
                return (
                  <tr key={rowKey} style={{ borderBottom: "1px solid var(--border)", background: r.isNew ? "rgba(37,99,235,0.06)" : "var(--bg)" }}>
                    <td style={{ padding: "6px 8px", position: "relative", minWidth: 180 }}>
                      <input
                        type="text"
                        required
                        placeholder="🔍 Search employee from master…"
                        value={r.employee_name || ""}
                        onFocus={() => setGridEmpFocusId(rowKey)}
                        onChange={(e) => {
                          handleGridChange(rowKey, "employee_name", e.target.value);
                          setGridEmpQuery(e.target.value);
                          setGridEmpFocusId(rowKey);
                        }}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--gold)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                      {gridEmpFocusId === rowKey && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            zIndex: 9999,
                            width: 250,
                            maxHeight: 200,
                            overflowY: "auto",
                            background: "#18181b",
                            border: "1px solid var(--gold)",
                            borderRadius: 6,
                            boxShadow: "0 10px 25px rgba(0,0,0,0.9)",
                            padding: 4,
                            marginTop: 2,
                          }}
                        >
                          <div style={{ padding: "4px 6px", fontSize: 10, color: "var(--gold)", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between" }}>
                            <span>👥 Select Employee ({getGridFilteredEmps(r.employee_name || gridEmpQuery).length})</span>
                            <span style={{ cursor: "pointer", fontWeight: "bold" }} onClick={() => setGridEmpFocusId(null)}>✕</span>
                          </div>
                          {getGridFilteredEmps(r.employee_name || gridEmpQuery).length === 0 ? (
                            <div style={{ padding: 8, fontSize: 11, color: "var(--muted)", textAlign: "center" }}>No match in master</div>
                          ) : (
                            getGridFilteredEmps(r.employee_name || gridEmpQuery).map((emp) => (
                              <div
                                key={emp.id}
                                onClick={() => {
                                  handleSelectEmpForGridRow(rowKey, emp);
                                  setGridEmpFocusId(null);
                                }}
                                style={{
                                  padding: "6px 8px",
                                  cursor: "pointer",
                                  borderRadius: 4,
                                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                                  background: r.employee_name === emp.full_name ? "rgba(255,204,0,0.2)" : "transparent",
                                }}
                              >
                                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--fg)" }}>{emp.full_name}</div>
                                <div style={{ fontSize: 10, color: "var(--muted)", display: "flex", gap: 6, marginTop: 1 }}>
                                  <span>🏢 {emp.department || "No Dept"}</span>
                                  {emp.email && <span style={{ color: "var(--gold)" }}>• {emp.email}</span>}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="text"
                        placeholder="Code or Email"
                        value={r.employee_code || ""}
                        onChange={(e) => handleGridChange(rowKey, "employee_code", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <select
                        value={r.department || "IT"}
                        onChange={(e) => handleGridChange(rowKey, "department", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      >
                        {allDepartmentsList.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <select
                        value={r.phone_category || "Android Standard (₹25k)"}
                        onChange={(e) => handleGridChange(rowKey, "phone_category", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      >
                        {PHONE_TIERS.map((t) => (
                          <option key={t.id} value={t.id}>{t.id}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="number"
                        value={r.budget_amount || 0}
                        onChange={(e) => handleGridChange(rowKey, "budget_amount", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="date"
                        value={r.eligible_date || ""}
                        onChange={(e) => handleGridChange(rowKey, "eligible_date", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="date"
                        value={r.received_date || ""}
                        onChange={(e) => handleGridReceivedDateChange(rowKey, e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 11, borderRadius: 4, border: "1px solid var(--gold)", background: "rgba(255,204,0,0.1)", color: "var(--fg)", fontWeight: 600 }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="date"
                        value={r.expiry_date || ""}
                        onChange={(e) => handleGridChange(rowKey, "expiry_date", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <select
                        value={r.status || "Eligible"}
                        onChange={(e) => handleGridChange(rowKey, "status", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="text"
                        placeholder="e.g. iPhone 15"
                        value={r.device_details || ""}
                        onChange={(e) => handleGridChange(rowKey, "device_details", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="text"
                        placeholder="IMEI code"
                        value={r.serial_imei || ""}
                        onChange={(e) => handleGridChange(rowKey, "serial_imei", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input
                        type="text"
                        placeholder="Remarks"
                        value={r.remarks || ""}
                        onChange={(e) => handleGridChange(rowKey, "remarks", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center" }}>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => removeGridRow(rowKey)}
                        style={{ color: "var(--red)", padding: "2px 6px" }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : loading ? (
        <Card style={{ padding: 40, textAlign: "center" }}>
          <div style={{ color: "var(--muted)" }}>Loading Mobile Phone Allocations...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Empty message="No phone allocation records found." action={canEdit && <button className="btn sm" onClick={handleOpenAdd}>Add New Record</button>} />
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "10px 14px" }}>Employee</th>
                <th style={{ padding: "10px 14px" }}>Department</th>
                <th style={{ padding: "10px 14px" }}>Phone Category Tier</th>
                <th style={{ padding: "10px 14px" }}>Policy Budget</th>
                <th style={{ padding: "10px 14px" }}>Eligible Date</th>
                <th style={{ padding: "10px 14px" }}>Received Date</th>
                <th style={{ padding: "10px 14px" }}>Policy Expiry Date</th>
                <th style={{ padding: "10px 14px" }}>Status</th>
                <th style={{ padding: "10px 14px" }}>Device Details / IMEI</th>
                <th style={{ padding: "10px 14px" }}>Remarks</th>
                {canEdit && <th style={{ padding: "10px 14px", textAlign: "right" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const daysExp = r.expiry_date ? daysUntil(r.expiry_date) : null;
                const isExp = r.status === "Expired" || (r.expiry_date && new Date(r.expiry_date) < new Date());

                let statusPillClass = "gray";
                if (isExp) statusPillClass = "red";
                else if (r.status === "Active") statusPillClass = "green";
                else if (r.status === "Expiring Soon") statusPillClass = "amber";
                else if (r.status === "Eligible") statusPillClass = "blue";
                else if (r.status === "Applied") statusPillClass = "violet";

                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 600, color: "var(--fg)" }}>{r.employee_name}</div>
                      {r.employee_code && <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{r.employee_code}</div>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span className="pill gray">{r.department}</span>
                    </td>
                    <td style={{ padding: "10px 14px", fontWeight: 500 }}>{r.phone_category}</td>
                    <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--gold)" }} className="mono">
                      {money(r.budget_amount)}
                    </td>
                    <td style={{ padding: "10px 14px" }} className="mono">
                      {r.eligible_date ? dateStr(r.eligible_date) : "—"}
                    </td>
                    <td style={{ padding: "10px 14px" }} className="mono">
                      {r.received_date ? dateStr(r.received_date) : <span style={{ color: "var(--faint)", fontStyle: "italic" }}>Not Received</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }} className="mono">
                      {r.expiry_date ? (
                        <div>
                          <span>{dateStr(r.expiry_date)}</span>
                          {daysExp !== null && (
                            <div style={{ fontSize: 10, color: daysExp < 0 ? "var(--red)" : daysExp <= 60 ? "var(--amber)" : "var(--faint)" }}>
                              {daysExp < 0 ? `Expired ${Math.abs(daysExp)}d ago` : `${daysExp}d remaining`}
                            </div>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span className={`pill ${statusPillClass}`}>{isExp ? "Expired" : r.status}</span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {r.device_details ? (
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.device_details}</div>
                          {r.serial_imei && <div className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>IMEI: {r.serial_imei}</div>}
                        </div>
                      ) : (
                        <span style={{ color: "var(--faint)", fontStyle: "italic" }}>No Device Assigned</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{r.remarks || "—"}</td>
                    {canEdit && (
                      <td style={{ padding: "10px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn ghost sm" onClick={() => handleOpenEdit(r)} style={{ marginRight: 6 }}>
                          ✏️ Edit
                        </button>
                        <button className="btn ghost sm" onClick={() => handleDelete(r)} style={{ color: "var(--red)" }}>
                          🗑️
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal for Adding / Editing Phone Allocation */}
      {modalOpen && (
        <Modal
          title={editingRow ? `✏️ Edit Phone Allocation — ${editingRow.employee_name}` : "📱 Add New Mobile Phone Allocation"}
          onClose={() => setModalOpen(false)}
        >
          <form onSubmit={handleSave} className="stack" style={{ gap: 14 }}>
            {/* Searchable Employee Master Selection Dropdown */}
            <div style={{ position: "relative" }}>
              <label className="field-label" style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
                👤 Select Employee from Employee Master *
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type="text"
                  required
                  placeholder="🔍 Search employee name or email from master…"
                  value={form.employee_name}
                  onFocus={() => setEmpDropdownOpen(true)}
                  onChange={(e) => {
                    setForm({ ...form, employee_name: e.target.value });
                    setEmpSearchQuery(e.target.value);
                    setEmpDropdownOpen(true);
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg-input)",
                    color: "var(--fg)",
                  }}
                />
                {empDropdownOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      zIndex: 999,
                      maxHeight: 220,
                      overflowY: "auto",
                      background: "#18181b",
                      border: "1px solid var(--gold)",
                      borderRadius: 8,
                      boxShadow: "0 10px 25px rgba(0,0,0,0.8)",
                      padding: 4,
                      marginTop: 4,
                    }}
                  >
                    <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--gold)", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between" }}>
                      <span>👥 Master Active Employees ({filteredMasterEmployees.length})</span>
                      <span style={{ cursor: "pointer", fontWeight: "bold" }} onClick={() => setEmpDropdownOpen(false)}>✕ Close</span>
                    </div>
                    {filteredMasterEmployees.length === 0 ? (
                      <div style={{ padding: 10, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                        No employee matching search. You can continue typing custom name above.
                      </div>
                    ) : (
                      filteredMasterEmployees.map((emp) => (
                        <div
                          key={emp.id}
                          onClick={() => {
                            setForm((prev) => ({
                              ...prev,
                              employee_name: emp.full_name,
                              employee_code: emp.email || prev.employee_code,
                              department: emp.department || prev.department,
                            }));
                            setEmpSearchQuery(emp.full_name);
                            setEmpDropdownOpen(false);
                          }}
                          style={{
                            padding: "8px 10px",
                            cursor: "pointer",
                            borderRadius: 6,
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                            background: form.employee_name === emp.full_name ? "rgba(255,204,0,0.15)" : "transparent",
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--fg)" }}>{emp.full_name}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, display: "flex", gap: 8 }}>
                            <span>🏢 {emp.department || "No Dept"}</span>
                            {emp.job_title && <span>• {emp.job_title}</span>}
                            {emp.email && <span style={{ color: "var(--gold)" }}>• {emp.email}</span>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Employee Code / Email">
                <input
                  type="text"
                  placeholder="e.g. employee.email@hydraspecma.com"
                  value={form.employee_code}
                  onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
                />
              </Field>

              <Field label="Department">
                <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                  {allDepartmentsList.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </Field>

              <Field label="Phone Model Tier & Budget *">
                <select value={form.phone_category} onChange={(e) => handleCategoryChange(e.target.value)}>
                  {PHONE_TIERS.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Eligible Date">
                <input
                  type="date"
                  value={form.eligible_date}
                  onChange={(e) => setForm({ ...form, eligible_date: e.target.value })}
                />
              </Field>

              <Field label="Received Date (Issued)">
                <input
                  type="date"
                  value={form.received_date}
                  onChange={(e) => handleReceivedDateChange(e.target.value)}
                />
              </Field>

              <Field label="Policy Expiry Date">
                <input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                />
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Current Status">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>

              <Field label="Policy Budget Amount (₹)">
                <input
                  type="number"
                  value={form.budget_amount}
                  onChange={(e) => setForm({ ...form, budget_amount: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Device Details (Brand, Model, Specs)">
              <input
                type="text"
                placeholder="e.g. iPhone 15 Black 128GB or Samsung S23"
                value={form.device_details}
                onChange={(e) => setForm({ ...form, device_details: e.target.value })}
              />
            </Field>

            <Field label="Serial No / IMEI Code">
              <input
                type="text"
                placeholder="e.g. IMEI-3589201948201"
                value={form.serial_imei}
                onChange={(e) => setForm({ ...form, serial_imei: e.target.value })}
              />
            </Field>

            <Field label="Remarks & Approval Notes">
              <textarea
                rows={2}
                placeholder="e.g. Approved by Dept Admin, policy replacement due in 2 years"
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </Field>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <button type="button" className="btn ghost" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? "Saving..." : editingRow ? "Save Changes" : "Create Allocation"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Shell>
  );
}
