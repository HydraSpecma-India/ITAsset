"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell, { isPhoneModuleAuthorized, canManagePhoneAllocations } from "@/components/Shell";
import { Card, Field, Modal, Empty } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, dateStr, todayISO, daysUntil, csvDownload } from "@/lib/format";
import { useAuth } from "@/lib/session";
import { useDept } from "@/lib/department";

const DEFAULT_GENERAL_TIERS = [
  { id: "Dual Monitor & Docking Station (₹25k)", label: "Dual Monitor & Docking Station (Budget ₹25,000)", budget: 25000, icon: "🖥️", desc: "Dual Display & Professional Docking Station Tier (Budget: ₹25,000)" },
  { id: "Peripherals & Accessories Tier (₹10k)", label: "Peripherals & Accessories Tier (Budget ₹10,000)", budget: 10000, icon: "⌨️", desc: "Ergonomic Keyboard, Mouse & Headset Tier (Budget: ₹10,000)" },
  { id: "Specialized IT Gear Tier (₹35k)", label: "Specialized IT Gear Tier (Budget ₹35,000)", budget: 35000, icon: "⚙️", desc: "Specialized Testing & Network Hardware Tier (Budget: ₹35,000)" },
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
  asset_category: "Dual Monitor & Docking Station (₹25k)",
  budget_amount: 25000,
  eligible_date: todayISO(),
  received_date: "",
  expiry_date: "",
  device_details: "",
  serial_imei: "",
  status: "Eligible",
  remarks: "",
});

function formatDateDDMMMYYYY(dStr) {
  if (!dStr) return "—";
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = String(d.getDate()).padStart(2, "0");
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch (err) {
    return dStr;
  }
}

function getDeviceMake(details = "") {
  const str = String(details).toLowerCase();
  if (str.includes("dell")) return "Dell";
  if (str.includes("logitech")) return "Logitech";
  if (str.includes("hp")) return "HP";
  if (str.includes("lenovo")) return "Lenovo";
  if (str.includes("samsung") || str.includes("lg")) return "LG / Samsung";
  return "HydraSpecma IT Hardware";
}

export default function GeneralAssetsPage() {
  const { profile } = useAuth();
  const { dept, isDeptAdmin, departments } = useDept();
  
  const canEdit = canManagePhoneAllocations(profile);

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

  // Categories State
  const [categories, setCategories] = useState([]);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [catForm, setCatForm] = useState({ name: "", budget: 15000, icon: "⌨️", description: "" });
  const [savingCat, setSavingCat] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("it_general_categories")
        .select("*")
        .eq("is_active", true)
        .order("budget", { ascending: false });
      if (data && data.length > 0) {
        setCategories(data);
      }
    } catch (err) {
      console.error("Failed to load general asset categories:", err);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const GENERAL_TIERS = useMemo(() => {
    if (categories.length > 0) {
      return categories.map((c) => ({
        id: c.name,
        label: `${c.name} (Budget ₹${Number(c.budget).toLocaleString()})`,
        budget: Number(c.budget),
        icon: c.icon || "⌨️",
        desc: c.description || `Budget: ₹${Number(c.budget).toLocaleString()}`,
        raw: c,
      }));
    }
    return DEFAULT_GENERAL_TIERS;
  }, [categories]);

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

  const allDepartmentsList = useMemo(() => {
    const set = new Set([
      ...departments,
      ...masterEmployees.map((e) => e.department).filter(Boolean),
      ...rows.map((r) => r.department).filter(Boolean),
    ]);
    return Array.from(set).sort();
  }, [departments, masterEmployees, rows]);

  // Grid Inline Mode State
  const [gridMode, setGridMode] = useState(false);
  const [gridRows, setGridRows] = useState([]);
  const [savingGrid, setSavingGrid] = useState(false);

  // Printable Modal States
  const [printRow, setPrintRow] = useState(null);

  // Multi-Person General Asset Proposal Form State & Handlers
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [proposalTitle, setProposalTitle] = useState("General IT Asset Allocation & Purchase Proposal");
  const [proposalJustification, setProposalJustification] = useState("Requested as per company IT asset eligibility policy and department hardware requirements.");
  const [proposalDate, setProposalDate] = useState(todayISO());
  const [proposalItems, setProposalItems] = useState([]);
  const [proposalPrintData, setProposalPrintData] = useState(null);
  const [proposalFocusIndex, setProposalFocusIndex] = useState(null);

  function handleOpenProposal(catName = "all") {
    let initialItems = [];
    if (catName !== "all") {
      const matchingRows = rows.filter((r) => {
        const cat = (r.asset_category || "").toLowerCase().trim();
        const tid = (catName || "").toLowerCase().trim();
        return cat === tid || cat.includes(tid) || tid.includes(cat);
      });

      if (matchingRows.length > 0) {
        initialItems = matchingRows.map((r) => ({
          tempId: r.id || "p_" + Math.random(),
          employee_name: r.employee_name,
          employee_code: r.employee_code || "",
          department: r.department || "IT",
          asset_category: r.asset_category,
          budget_amount: Number(r.budget_amount || 25000),
          proposed_device: r.device_details || `${r.asset_category} Hardware`,
        }));
      }
    }

    if (initialItems.length === 0) {
      const selectedCatObj = GENERAL_TIERS.find((t) => t.id === catName) || GENERAL_TIERS[0];
      initialItems = [
        {
          tempId: "p_1",
          employee_name: "",
          employee_code: "",
          department: dept === "All" ? "IT" : dept,
          asset_category: selectedCatObj ? selectedCatObj.id : "Dual Monitor & Docking Station (₹25k)",
          budget_amount: selectedCatObj ? selectedCatObj.budget : 25000,
          proposed_device: selectedCatObj ? `${selectedCatObj.id} Gear` : "IT Hardware Asset",
        },
      ];
    }

    setProposalTitle(catName !== "all" ? `${catName} Allocation Proposal` : "General IT Asset Allocation & Purchase Proposal");
    setProposalJustification("Requested as per company IT asset eligibility policy and department hardware requirements.");
    setProposalDate(todayISO());
    setProposalItems(initialItems);
    setProposalFocusIndex(null);
    setProposalModalOpen(true);
  }

  function addProposalItem() {
    const selectedCatObj = GENERAL_TIERS[0];
    setProposalItems((prev) => [
      ...prev,
      {
        tempId: "p_" + Date.now() + "_" + Math.random(),
        employee_name: "",
        employee_code: "",
        department: dept === "All" ? "IT" : dept,
        asset_category: selectedCatObj ? selectedCatObj.id : "Dual Monitor & Docking Station (₹25k)",
        budget_amount: selectedCatObj ? selectedCatObj.budget : 25000,
        proposed_device: selectedCatObj ? `${selectedCatObj.id} Gear` : "IT Hardware Asset",
      },
    ]);
  }

  function updateProposalItem(index, field, val) {
    setProposalItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const updated = { ...item, [field]: val };
        if (field === "asset_category") {
          const catObj = GENERAL_TIERS.find((t) => t.id === val);
          if (catObj) {
            updated.budget_amount = catObj.budget;
            if (!updated.proposed_device || updated.proposed_device.includes("Gear")) {
              updated.proposed_device = `${catObj.id} Gear`;
            }
          }
        }
        return updated;
      })
    );
  }

  function removeProposalItem(index) {
    setProposalItems((prev) => prev.filter((_, idx) => idx !== index));
  }

  function populateFilteredToProposal() {
    if (filtered.length === 0) {
      alert("No filtered employees found.");
      return;
    }
    setProposalItems(
      filtered.map((r) => ({
        tempId: r.id || "p_" + Math.random(),
        employee_name: r.employee_name,
        employee_code: r.employee_code || "",
        department: r.department || "IT",
        asset_category: r.asset_category || "Dual Monitor & Docking Station (₹25k)",
        budget_amount: Number(r.budget_amount || 25000),
        proposed_device: r.device_details || `${r.asset_category} Hardware`,
      }))
    );
  }

  function handleGenerateProposalPrint(e) {
    if (e) e.preventDefault();
    const validItems = proposalItems.filter((i) => (i.employee_name || "").trim());
    if (validItems.length === 0) {
      alert("Please add at least one employee to the General Asset Proposal.");
      return;
    }

    const totalBudget = validItems.reduce((acc, curr) => acc + Number(curr.budget_amount || 0), 0);

    setProposalPrintData({
      title: proposalTitle,
      justification: proposalJustification,
      proposal_date: proposalDate,
      items: validItems,
      totalBudget,
    });
    setProposalModalOpen(false);
  }

  useEffect(() => {
    setDeptFilter(dept);
  }, [dept]);

  const loadData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);

    try {
      let query = supabase.from("it_general_allocations").select("*").order("created_at", { ascending: false });

      const activeDept = deptFilter || dept;
      if (activeDept && activeDept !== "All") {
        query = query.or(`department.eq.${activeDept},budget_department.eq.${activeDept}`);
      }

      const { data, error } = await query;
      if (error) throw error;

      setRows(data || []);
    } catch (err) {
      console.error("Failed to load general asset allocations:", err);
    } finally {
      setLoading(false);
    }
  }, [profile, deptFilter, dept]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter rows
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tierFilter !== "all") {
        const catName = (r.asset_category || "").toLowerCase().trim();
        const filterName = (tierFilter || "").toLowerCase().trim();
        if (catName !== filterName && !catName.includes(filterName) && !filterName.includes(catName)) {
          return false;
        }
      }
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
        r.asset_category,
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

  // KPIs
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
      asset_category: r.asset_category || "Dual Monitor & Docking Station (₹25k)",
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

  function handleOpenPrintForm(r) {
    setPrintRow(r);
  }

  function handleOpenAddCat() {
    setEditingCat(null);
    setCatForm({ name: "", budget: 25000, icon: "🖥️", description: "" });
  }

  function handleOpenEditCat(c) {
    setEditingCat(c);
    setCatForm({
      name: c.name || "",
      budget: c.budget || 25000,
      icon: c.icon || "🖥️",
      description: c.description || "",
    });
  }

  async function handleSaveCat(e) {
    if (e) e.preventDefault();
    if (!catForm.name.trim()) return alert("Category name is required.");
    setSavingCat(true);

    const payload = {
      name: catForm.name.trim(),
      budget: Number(catForm.budget || 0),
      icon: catForm.icon.trim() || "🖥️",
      description: catForm.description.trim() || null,
      is_active: true,
    };

    try {
      if (editingCat?.id) {
        const { error } = await supabase.from("it_general_categories").update(payload).eq("id", editingCat.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("it_general_categories").insert(payload);
        if (error) throw error;
      }
      await loadCategories();
      setEditingCat(null);
      setCatForm({ name: "", budget: 25000, icon: "🖥️", description: "" });
    } catch (err) {
      alert("Failed to save category: " + (err.message || String(err)));
    } finally {
      setSavingCat(false);
    }
  }

  async function handleDeleteCat(c) {
    if (!confirm(`Are you sure you want to delete general asset category "${c.name}"?`)) return;
    try {
      const { error } = await supabase.from("it_general_categories").delete().eq("id", c.id);
      if (error) throw error;
      await loadCategories();
    } catch (err) {
      alert("Failed to delete category: " + err.message);
    }
  }

  // Calculate 3 years expiry from issue date for general assets
  function handleReceivedDateChange(dateValue) {
    let expDate = "";
    if (dateValue) {
      try {
        const d = new Date(dateValue);
        d.setFullYear(d.getFullYear() + 3);
        expDate = d.toISOString().split("T")[0];
      } catch (err) {
        expDate = "";
      }
    }
    setForm((prev) => ({
      ...prev,
      received_date: dateValue,
      expiry_date: expDate || prev.expiry_date,
      status: dateValue ? "Active" : prev.status,
    }));
  }

  function enableGridMode() {
    setGridRows(
      rows.map((r) => ({
        ...r,
        tempId: r.id,
      }))
    );
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
      isNew: true,
      employee_name: "",
      employee_code: "",
      department: targetDept,
      asset_category: "Dual Monitor & Docking Station (₹25k)",
      budget_amount: 25000,
      eligible_date: todayISO(),
      received_date: "",
      expiry_date: "",
      device_details: "",
      serial_imei: "",
      status: "Eligible",
      remarks: "",
    };
    setGridRows((prev) => [newRow, ...prev]);
  }

  async function saveGridChanges() {
    setSavingGrid(true);
    try {
      let updatedCount = 0;
      let insertedCount = 0;

      for (const r of gridRows) {
        const empName = (r.employee_name || "").trim();
        if (!empName) continue;

        const empDept = r.department || (dept === "All" ? "IT" : dept);

        const payload = {
          employee_name: empName,
          employee_code: (r.employee_code || "").trim() || null,
          department: empDept,
          asset_category: r.asset_category || "Dual Monitor & Docking Station (₹25k)",
          budget_amount: Number(r.budget_amount || 25000),
          eligible_date: r.eligible_date || null,
          received_date: r.received_date || null,
          expiry_date: r.expiry_date || null,
          device_details: (r.device_details || "").trim() || null,
          serial_imei: (r.serial_imei || "").trim() || null,
          status: r.status || "Eligible",
          remarks: (r.remarks || "").trim() || null,
          budget_department: empDept,
          updated_at: new Date().toISOString(),
        };

        if (r.isNew || !r.id) {
          const { error } = await supabase.from("it_general_allocations").insert(payload);
          if (error) throw error;
          insertedCount++;
        } else {
          const { error } = await supabase.from("it_general_allocations").update(payload).eq("id", r.id);
          if (error) throw error;
          updatedCount++;
        }
      }

      setGridMode(false);
      setDeptFilter("All");
      await loadData();
      alert(`General IT Asset grid changes saved successfully! (${updatedCount} updated, ${insertedCount} created)`);
    } catch (err) {
      console.error("Save grid error:", err);
      alert("Failed to save grid changes: " + (err.message || String(err)));
    } finally {
      setSavingGrid(false);
    }
  }

  async function handleSave(e) {
    if (e) e.preventDefault();
    const empName = (form.employee_name || "").trim();
    if (!empName) {
      alert("Please enter Employee Name.");
      return;
    }

    setSaving(true);
    const empDept = form.department || (dept === "All" ? "IT" : dept);

    const payload = {
      employee_name: empName,
      employee_code: (form.employee_code || "").trim() || null,
      department: empDept,
      asset_category: form.asset_category || "Dual Monitor & Docking Station (₹25k)",
      budget_amount: Number(form.budget_amount || 25000),
      eligible_date: form.eligible_date || null,
      received_date: form.received_date || null,
      expiry_date: form.expiry_date || null,
      device_details: (form.device_details || "").trim() || null,
      serial_imei: (form.serial_imei || "").trim() || null,
      status: form.status || "Eligible",
      remarks: (form.remarks || "").trim() || null,
      budget_department: empDept,
      updated_at: new Date().toISOString(),
    };

    try {
      if (editingRow?.id) {
        const { error } = await supabase.from("it_general_allocations").update(payload).eq("id", editingRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("it_general_allocations").insert(payload);
        if (error) throw error;
      }

      setModalOpen(false);
      if (deptFilter !== "All" && deptFilter !== empDept) {
        setDeptFilter("All");
      }
      await loadData();
    } catch (err) {
      console.error("Save general asset allocation error:", err);
      alert("Failed to save allocation: " + (err.message || String(err)));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r) {
    if (!confirm(`Are you sure you want to delete general IT asset record for ${r.employee_name}?`)) return;
    try {
      const { error } = await supabase.from("it_general_allocations").delete().eq("id", r.id);
      if (error) throw error;
      await loadData();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  }

  function handleExportCsv() {
    csvDownload(
      `general-it-asset-register-${dept || "all"}.csv`,
      filtered.map((r) => ({
        "Employee Name": r.employee_name,
        "Employee Code": r.employee_code || "—",
        Department: r.department,
        "Asset Category Tier": r.asset_category,
        "Policy Budget (INR)": r.budget_amount,
        "Eligible Date": r.eligible_date ? dateStr(r.eligible_date) : "—",
        "Received Date": r.received_date ? dateStr(r.received_date) : "—",
        "Policy Expiry Date (3Y)": r.expiry_date ? dateStr(r.expiry_date) : "—",
        Status: r.status,
        "Asset Details": r.device_details || "—",
        "Serial / Asset Tag": r.serial_imei || "—",
        Remarks: r.remarks || "—",
      }))
    );
  }

  const isAuthorized = isPhoneModuleAuthorized(profile);

  if (profile && !isAuthorized) {
    return (
      <Shell title="⌨️ General IT Assets" subtitle="Hardware & Peripherals Policy Management">
        <Card style={{ textAlign: "center", padding: "50px 20px", marginTop: 24, maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>🔒</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--fg)", marginBottom: 10 }}>Access Restricted</h2>
          <p style={{ color: "var(--muted)", lineHeight: 1.6, marginBottom: 24, fontSize: 14 }}>
            The <strong>General IT Assets</strong> module is restricted to authorized roles.
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell
      title="⌨️ General IT Asset Allocation Module"
      subtitle={`${dept === "All" ? "All Departments" : dept} employee hardware eligibility matrix, displays, peripherals & specialized gear entitlement tracking`}
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
            <button
              className="btn ghost sm"
              onClick={() => handleOpenProposal("all")}
              style={{ borderColor: "var(--gold)", color: "var(--gold)", fontWeight: 600 }}
            >
              📄 General Asset Proposal Form
            </button>
            <button className="btn ghost sm" onClick={handleExportCsv}>
              Export CSV
            </button>
            {canEdit && (
              <>
                <button
                  className="btn ghost sm"
                  onClick={() => setCatModalOpen(true)}
                  style={{ borderColor: "var(--border)" }}
                >
                  ⚙️ Manage Categories
                </button>
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
          <span>ℹ️</span> View-Only Mode: You have read-only access for General IT Asset records.
        </div>
      )}

      {/* KPI Header Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Total General Asset Allocations
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: "var(--fg)" }}>{kpis.totalCount}</div>
        </Card>

        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            Active Issued Assets
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
            Expired / Replacement Due (3Y)
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

      {/* General Asset Category Quick Filters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 20 }}>
        <Card
          onClick={() => setTierFilter("all")}
          style={{
            padding: 14,
            cursor: "pointer",
            border: tierFilter === "all" ? "2px solid var(--gold)" : "1px solid var(--border)",
            background: tierFilter === "all" ? "rgba(255,204,0,0.1)" : "var(--bg-card)",
            boxShadow: tierFilter === "all" ? "0 0 10px rgba(255,204,0,0.2)" : "none",
            transition: "all 0.15s ease",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 20 }}>🌐</span>
            <span
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 12,
                background: tierFilter === "all" ? "var(--gold)" : "rgba(255,255,255,0.08)",
                color: tierFilter === "all" ? "#000000" : "var(--fg)",
                fontWeight: 700,
              }}
            >
              {tierFilter === "all" ? "✓ All Selected" : `${rows.length} Total`}
            </span>
          </div>
          <div style={{ fontWeight: 700, marginTop: 8, fontSize: 14, color: tierFilter === "all" ? "var(--gold)" : "var(--fg)" }}>
            All General Asset Categories
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Click to view all IT hardware records</div>
        </Card>

        {GENERAL_TIERS.map((tier) => {
          const isActiveFilter = tierFilter === tier.id;
          const count = rows.filter((r) => {
            const cat = (r.asset_category || "").toLowerCase().trim();
            const tid = (tier.id || "").toLowerCase().trim();
            return cat === tid || cat.includes(tid) || tid.includes(cat);
          }).length;

          return (
            <Card
              key={tier.id}
              onClick={() => setTierFilter(isActiveFilter ? "all" : tier.id)}
              style={{
                padding: 14,
                cursor: "pointer",
                border: isActiveFilter ? "2px solid var(--gold)" : "1px solid var(--border)",
                background: isActiveFilter ? "rgba(255,204,0,0.12)" : "var(--bg-card)",
                boxShadow: isActiveFilter ? "0 0 12px rgba(255,204,0,0.25)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 20 }}>{tier.icon}</span>
                <span
                  style={{
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: isActiveFilter ? "var(--gold)" : "rgba(255,255,255,0.08)",
                    color: isActiveFilter ? "#000000" : "var(--fg)",
                    fontWeight: 700,
                  }}
                >
                  {isActiveFilter ? `✓ ${count} Filtered` : `${count} Assigned`}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: isActiveFilter ? "var(--gold)" : "var(--fg)" }}>
                  {tier.id}
                </div>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenProposal(tier.id);
                  }}
                  style={{ fontSize: 10, padding: "2px 6px", borderColor: "var(--gold)", color: "var(--gold)", whiteSpace: "nowrap" }}
                >
                  📄 Proposal
                </button>
              </div>
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
              placeholder="🔍 Search employee name, code, serial/tag, specs..."
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
              <option value="all">All Asset Tiers</option>
              {GENERAL_TIERS.map((t) => (
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

      {/* Main Table View */}
      {loading ? (
        <Card style={{ padding: 40, textAlign: "center" }}>
          <div style={{ color: "var(--muted)" }}>Loading General Asset Allocations...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Empty message="No general IT asset allocation records found." action={canEdit && <button className="btn sm" onClick={handleOpenAdd}>Add New Record</button>} />
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "10px 14px" }}>Employee</th>
                <th style={{ padding: "10px 14px" }}>Department</th>
                <th style={{ padding: "10px 14px" }}>Asset Category Tier</th>
                <th style={{ padding: "10px 14px" }}>Policy Budget</th>
                <th style={{ padding: "10px 14px" }}>Eligible Date</th>
                <th style={{ padding: "10px 14px" }}>Received Date</th>
                <th style={{ padding: "10px 14px" }}>Policy Expiry (3Y)</th>
                <th style={{ padding: "10px 14px" }}>Status</th>
                <th style={{ padding: "10px 14px" }}>Hardware Details / Serial</th>
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
                    <td style={{ padding: "10px 14px", fontWeight: 500 }}>{r.asset_category}</td>
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
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                        <span className={`pill ${statusPillClass}`}>{isExp ? "Expired" : r.status}</span>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => handleOpenPrintForm(r)}
                          style={{ fontSize: 11, padding: "2px 8px", borderColor: "var(--gold)", color: "var(--gold)", whiteSpace: "nowrap" }}
                        >
                          📄 Issue Form
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      {r.device_details ? (
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.device_details}</div>
                          {r.serial_imei && <div className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>Serial: {r.serial_imei}</div>}
                        </div>
                      ) : (
                        <span style={{ color: "var(--faint)", fontStyle: "italic" }}>No Hardware Assigned</span>
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

      {/* Modal for Managing General IT Asset Categories & Tiers */}
      {catModalOpen && (
        <Modal
          title="⚙️ Manage General IT Asset Categories & Budget Tiers"
          onClose={() => setCatModalOpen(false)}
        >
          <div className="stack" style={{ gap: 16 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              Manage active general IT hardware categories, icon badges, default policy budget amounts, and tier descriptions.
            </div>

            {/* Category List */}
            <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "8px 10px" }}>Tier Icon & Name</th>
                    <th style={{ padding: "8px 10px" }}>Budget Amount (₹)</th>
                    <th style={{ padding: "8px 10px" }}>Description</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                        <span style={{ fontSize: 16, marginRight: 6 }}>{c.icon || "🖥️"}</span> {c.name}
                      </td>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: "var(--gold)" }} className="mono">
                        {money(c.budget)}
                      </td>
                      <td style={{ padding: "8px 10px", color: "var(--muted)" }}>{c.description || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn ghost sm" onClick={() => handleOpenEditCat(c)} style={{ marginRight: 4 }}>✏️</button>
                        <button className="btn ghost sm" onClick={() => handleDeleteCat(c)} style={{ color: "var(--red)" }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add / Edit Category Form */}
            <Card style={{ padding: 14, background: "rgba(255,204,0,0.04)", border: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "var(--fg)" }}>
                {editingCat ? `✏️ Edit Category — ${editingCat.name}` : "➕ Add New Asset Category Tier"}
              </div>
              <form onSubmit={handleSaveCat} className="stack" style={{ gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Category Name *">
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ergonomic Standing Desk & Dock (₹30k)"
                      value={catForm.name}
                      onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                    />
                  </Field>

                  <Field label="Policy Budget (₹) *">
                    <input
                      type="number"
                      required
                      placeholder="e.g. 30000"
                      value={catForm.budget}
                      onChange={(e) => setCatForm({ ...catForm, budget: e.target.value })}
                    />
                  </Field>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10 }}>
                  <Field label="Icon Emoji">
                    <input
                      type="text"
                      placeholder="🖥️ or ⌨️"
                      value={catForm.icon}
                      onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })}
                    />
                  </Field>

                  <Field label="Tier Description">
                    <input
                      type="text"
                      placeholder="e.g. Workstation Peripherals & Docking Station Tier"
                      value={catForm.description}
                      onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
                    />
                  </Field>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                  {editingCat && (
                    <button type="button" className="btn ghost sm" onClick={() => handleOpenAddCat()}>
                      Cancel Edit
                    </button>
                  )}
                  <button type="submit" className="btn sm primary" disabled={savingCat}>
                    {savingCat ? "Saving..." : editingCat ? "Update Category" : "Add Category"}
                  </button>
                </div>
              </form>
            </Card>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={() => setCatModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal for Adding/Editing General Asset Allocation */}
      {modalOpen && (
        <Modal
          title={editingRow ? `✏️ Edit General IT Asset Allocation — ${editingRow.employee_name}` : "⌨️ Add New IT Asset Allocation"}
          onClose={() => setModalOpen(false)}
        >
          <form onSubmit={handleSave} className="stack" style={{ gap: 14 }}>
            <div style={{ position: "relative" }}>
              <label className="field-label" style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
                👤 Select Employee from Master *
              </label>
              <input
                type="text"
                required
                placeholder="🔍 Search employee from master..."
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
                    maxHeight: 200,
                    overflowY: "auto",
                    background: "#18181b",
                    border: "1px solid var(--gold)",
                    borderRadius: 8,
                    padding: 4,
                    marginTop: 4,
                  }}
                >
                  {filteredMasterEmployees.map((emp) => (
                    <div
                      key={emp.id}
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          employee_name: emp.full_name,
                          employee_code: emp.email || prev.employee_code,
                          department: emp.department || prev.department,
                        }));
                        setEmpDropdownOpen(false);
                      }}
                      style={{ padding: "6px 10px", cursor: "pointer", borderRadius: 4 }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 12, color: "var(--fg)" }}>{emp.full_name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>🏢 {emp.department}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Department *">
                <select
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                >
                  {allDepartmentsList.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </Field>

              <Field label="Asset Category Tier *">
                <select
                  value={form.asset_category}
                  onChange={(e) => {
                    const obj = GENERAL_TIERS.find((t) => t.id === e.target.value);
                    setForm({
                      ...form,
                      asset_category: e.target.value,
                      budget_amount: obj ? obj.budget : form.budget_amount,
                    });
                  }}
                >
                  {GENERAL_TIERS.map((t) => (
                    <option key={t.id} value={t.id}>{t.label || t.id}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Policy Budget (₹)">
                <input
                  type="number"
                  value={form.budget_amount}
                  onChange={(e) => setForm({ ...form, budget_amount: e.target.value })}
                />
              </Field>

              <Field label="Status">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Eligible Date">
                <input type="date" value={form.eligible_date} onChange={(e) => setForm({ ...form, eligible_date: e.target.value })} />
              </Field>

              <Field label="Received Date (Issue Date)">
                <input type="date" value={form.received_date} onChange={(e) => handleReceivedDateChange(e.target.value)} />
              </Field>

              <Field label="Policy Expiry Date (3Y)">
                <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
              </Field>
            </div>

            <Field label="Hardware Details & Model">
              <input
                type="text"
                placeholder="e.g. Dell UltraSharp 27 4K Monitor + Universal Dock"
                value={form.device_details}
                onChange={(e) => setForm({ ...form, device_details: e.target.value })}
              />
            </Field>

            <Field label="Serial No / Asset Tag">
              <input
                type="text"
                placeholder="e.g. HS-DISP-2026-041"
                value={form.serial_imei}
                onChange={(e) => setForm({ ...form, serial_imei: e.target.value })}
              />
            </Field>

            <Field label="Remarks">
              <textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <button type="button" className="btn ghost" onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="submit" className="btn" disabled={saving}>
                {saving ? "Saving..." : editingRow ? "Save Changes" : "Create Allocation"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Printable Issue Form Modal */}
      {printRow && (
        <Modal
          title={`📄 Official General IT Asset Issue Form — ${printRow.employee_name}`}
          onClose={() => setPrintRow(null)}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, gap: 10 }}>
            <button className="btn sm primary" onClick={() => window.print()}>
              🖨️ Print Document
            </button>
            <button className="btn ghost sm" onClick={() => setPrintRow(null)}>Close</button>
          </div>

          <div
            id="printable-issue-form"
            style={{
              background: "#ffffff",
              color: "#000000",
              padding: "36px 44px 24px 44px",
              borderRadius: 8,
              fontFamily: "'Segoe UI', Arial, sans-serif",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              maxWidth: 740,
              minHeight: 820,
              margin: "0 auto",
              border: "1px solid #e5e7eb",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              boxSizing: "border-box",
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <img src="/hydraspecma-logo.png" alt="HydraSpecma Logo" style={{ height: 76, width: "auto", objectFit: "contain" }} />
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: "#333333", lineHeight: 1.4, maxWidth: 380 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#000000", textTransform: "uppercase", marginBottom: 2 }}>
                    HYDRASPECMA INDIA PRIVATE LIMITED
                  </div>
                  <div>Plot No.130A, Greenbase Industrial and Logistics Park,</div>
                  <div>Hiranandani Parks, Vadakkupattu Village,</div>
                  <div>Kundrathur Taluk, Kancheepuram, Tamil Nadu - 603 204.</div>
                  <div>E-mail : hsil.india@hydraspecma.com</div>
                  <div>www.hydraspecma.com</div>
                  <div>GSTIN: 33AABCH9436R1Z0</div>
                </div>
              </div>

              <hr style={{ border: "none", borderTop: "1px dashed #666666", margin: "16px 0 24px" }} />

              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <h2 style={{ fontSize: 22, fontWeight: 800, textDecoration: "underline", textUnderlineOffset: 6, margin: 0, color: "#000000" }}>
                  General IT Asset Issue Form
                </h2>
              </div>

              <div style={{ marginBottom: 28, fontSize: 13, lineHeight: 2 }}>
                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Name of Employee</span>
                  <span>:</span>
                  <span style={{ fontWeight: 700 }}>{printRow.employee_name}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Emp. ID / Email</span>
                  <span>:</span>
                  <span style={{ fontWeight: 700 }}>{printRow.employee_code || "—"}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Department</span>
                  <span>:</span>
                  <span style={{ fontWeight: 700 }}>{printRow.department}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Date of Issuance</span>
                  <span>:</span>
                  <span style={{ fontWeight: 700 }}>{formatDateDDMMMYYYY(printRow.received_date)}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Location</span>
                  <span>:</span>
                  <span style={{ fontWeight: 700 }}>Oragadam</span>
                </div>
              </div>

              <div style={{ marginBottom: 28, fontSize: 13, lineHeight: 2 }}>
                <div style={{ marginBottom: 8, fontStyle: "italic" }}>I have received the following IT hardware asset:</div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Asset Description</span>
                  <span>:</span>
                  <span style={{ fontWeight: 700 }}>{printRow.device_details || printRow.asset_category}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Make / Manufacturer</span>
                  <span>:</span>
                  <span style={{ fontWeight: 600 }}>{getDeviceMake(printRow.device_details || printRow.asset_category)}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Serial No / Asset Tag</span>
                  <span>:</span>
                  <span style={{ fontWeight: 800, color: "#002060" }}>{printRow.serial_imei || "—"}</span>
                </div>
              </div>

              <div style={{ marginBottom: 45, fontSize: 12, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 800, textDecoration: "underline", marginBottom: 6 }}>
                  Declaration by Employee:
                </div>
                <p style={{ margin: 0, textIndent: 36 }}>
                  I understand that I am responsible for the IT hardware assets issued to me and that I will care for the equipment in such a manner as to prevent damage or loss.
                </p>
              </div>
            </div>

            <div style={{ marginTop: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28, fontSize: 13, fontWeight: 700 }}>
                <div>
                  <span>Employee Signature</span>
                  <span style={{ display: "inline-block", width: 140, borderBottom: "2px double #2563eb", marginLeft: 16 }}></span>
                </div>
                <div>
                  <span>IT Signature</span>
                  <span style={{ display: "inline-block", width: 140, borderBottom: "1px solid #000000", marginLeft: 16 }}></span>
                </div>
              </div>

              <div style={{ textAlign: "center", fontSize: 10, color: "#666666", borderTop: "1px solid #e5e7eb", paddingTop: 12, lineHeight: 1.5 }}>
                <div>A Company in the HydraSpecma Group</div>
                <div>Corporate Identity Number: U29219TN2007PTCO63264</div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal for Creating Multi-Person General IT Asset Allocation Proposal */}
      {proposalModalOpen && (
        <Modal
          title={`📄 Create General IT Asset Proposal — ${proposalItems.length} Employee(s)`}
          onClose={() => setProposalModalOpen(false)}
          wide
        >
          <form onSubmit={handleGenerateProposalPrint} className="stack" style={{ gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12 }}>
              <Field label="Proposal Title / Subject *">
                <input
                  type="text"
                  required
                  value={proposalTitle}
                  onChange={(e) => setProposalTitle(e.target.value)}
                  placeholder="e.g. General IT Asset Allocation Proposal"
                />
              </Field>

              <Field label="Proposal Date">
                <input
                  type="date"
                  value={proposalDate}
                  onChange={(e) => setProposalDate(e.target.value)}
                />
              </Field>
            </div>

            {/* Table of Proposed Employees */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <label className="field-label" style={{ fontWeight: 700, fontSize: 13 }}>
                  👥 Proposed Employees Table ({proposalItems.length})
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn ghost sm" onClick={populateFilteredToProposal} style={{ fontSize: 11, borderColor: "var(--gold)", color: "var(--gold)" }}>
                    👥 Load Filtered ({filtered.length})
                  </button>
                  <button type="button" className="btn sm" onClick={addProposalItem} style={{ fontSize: 11, background: "#2563eb", color: "#fff" }}>
                    ➕ Add Employee
                  </button>
                </div>
              </div>

              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6, maxHeight: 320, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                      <th style={{ padding: "8px", width: 30 }}>#</th>
                      <th style={{ padding: "8px", minWidth: 160 }}>Employee Name *</th>
                      <th style={{ padding: "8px", minWidth: 110 }}>Emp ID / Email</th>
                      <th style={{ padding: "8px", minWidth: 110 }}>Department</th>
                      <th style={{ padding: "8px", minWidth: 150 }}>Category Tier</th>
                      <th style={{ padding: "8px", minWidth: 90 }}>Budget (₹)</th>
                      <th style={{ padding: "8px", minWidth: 140 }}>Proposed Hardware Specs</th>
                      <th style={{ padding: "8px", width: 40, textAlign: "center" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposalItems.map((item, idx) => (
                      <tr key={item.tempId || idx} style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 700, color: "var(--muted)" }}>{idx + 1}</td>
                        <td style={{ padding: "6px 8px", position: "relative" }}>
                          <input
                            type="text"
                            required
                            placeholder="🔍 Search employee master..."
                            value={item.employee_name}
                            onFocus={() => setProposalFocusIndex(idx)}
                            onChange={(e) => {
                              updateProposalItem(idx, "employee_name", e.target.value);
                              setEmpSearchQuery(e.target.value);
                              setProposalFocusIndex(idx);
                            }}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--gold)", background: "var(--bg-input)", color: "var(--fg)" }}
                          />
                          {proposalFocusIndex === idx && (
                            <div
                              style={{
                                position: "absolute",
                                top: "100%",
                                left: 0,
                                zIndex: 9999,
                                width: 240,
                                maxHeight: 180,
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
                                <span>👥 Select Employee</span>
                                <span style={{ cursor: "pointer", fontWeight: "bold" }} onClick={() => setProposalFocusIndex(null)}>✕</span>
                              </div>
                              {filteredMasterEmployees.map((emp) => (
                                <div
                                  key={emp.id}
                                  onClick={() => {
                                    updateProposalItem(idx, "employee_name", emp.full_name);
                                    updateProposalItem(idx, "employee_code", emp.email || item.employee_code);
                                    updateProposalItem(idx, "department", emp.department || item.department);
                                    setProposalFocusIndex(null);
                                  }}
                                  style={{ padding: "4px 8px", cursor: "pointer", borderRadius: 4, borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                                >
                                  <div style={{ fontWeight: 600, fontSize: 11, color: "var(--fg)" }}>{emp.full_name}</div>
                                  <div style={{ fontSize: 10, color: "var(--muted)" }}>🏢 {emp.department}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="text"
                            placeholder="Emp ID"
                            value={item.employee_code}
                            onChange={(e) => updateProposalItem(idx, "employee_code", e.target.value)}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <select
                            value={item.department}
                            onChange={(e) => updateProposalItem(idx, "department", e.target.value)}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                          >
                            {allDepartmentsList.map((d) => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <select
                            value={item.asset_category}
                            onChange={(e) => updateProposalItem(idx, "asset_category", e.target.value)}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                          >
                            {GENERAL_TIERS.map((t) => (
                              <option key={t.id} value={t.id}>{t.id}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="number"
                            value={item.budget_amount}
                            onChange={(e) => updateProposalItem(idx, "budget_amount", Number(e.target.value))}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)", fontWeight: 700 }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="text"
                            placeholder="Proposed specs..."
                            value={item.proposed_device}
                            onChange={(e) => updateProposalItem(idx, "proposed_device", e.target.value)}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "center" }}>
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => removeProposalItem(idx)}
                            style={{ color: "var(--red)", padding: "2px 4px" }}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "rgba(255,204,0,0.1)", borderTop: "2px solid var(--gold)", fontWeight: 700 }}>
                      <td colSpan={5} style={{ padding: "8px", textAlign: "right" }}>
                        Total Proposed Budget ({proposalItems.length} Employee{proposalItems.length !== 1 ? "s" : ""}):
                      </td>
                      <td style={{ padding: "8px", color: "var(--gold)", fontSize: 13 }} className="mono">
                        ₹{proposalItems.reduce((acc, curr) => acc + Number(curr.budget_amount || 0), 0).toLocaleString()}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <Field label="Business Justification & Department Purpose">
              <textarea
                rows={3}
                placeholder="Required for company general IT asset policy, dual monitor setup and docking station entitlement..."
                value={proposalJustification}
                onChange={(e) => setProposalJustification(e.target.value)}
              />
            </Field>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <button type="button" className="btn ghost" onClick={() => setProposalModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                📄 Generate & Print Multi-Employee Asset Proposal
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Printable Official HydraSpecma Multi-Person General Asset Proposal Form */}
      {proposalPrintData && (
        <Modal
          title={`📄 ${proposalPrintData.title} (${proposalPrintData.items.length} Employees)`}
          onClose={() => setProposalPrintData(null)}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, gap: 10 }}>
            <button className="btn sm primary" onClick={() => window.print()}>
              🖨️ Print Proposal Document
            </button>
            <button className="btn ghost sm" onClick={() => setProposalPrintData(null)}>
              Close
            </button>
          </div>

          <div
            id="printable-proposal-form"
            style={{
              background: "#ffffff",
              color: "#000000",
              padding: "36px 44px 24px 44px",
              borderRadius: 8,
              fontFamily: "'Segoe UI', Arial, sans-serif",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              maxWidth: 740,
              minHeight: 820,
              margin: "0 auto",
              border: "1px solid #e5e7eb",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              boxSizing: "border-box",
            }}
          >
            <div>
              {/* Header Section */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <img
                    src="/hydraspecma-logo.png"
                    alt="HydraSpecma Logo"
                    style={{ height: 76, width: "auto", objectFit: "contain" }}
                  />
                </div>

                <div style={{ textAlign: "right", fontSize: 11, color: "#333333", lineHeight: 1.4, maxWidth: 380 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#000000", textTransform: "uppercase", marginBottom: 2 }}>
                    HYDRASPECMA INDIA PRIVATE LIMITED
                  </div>
                  <div>Plot No.130A, Greenbase Industrial and Logistics Park,</div>
                  <div>Hiranandani Parks, Vadakkupattu Village,</div>
                  <div>Kundrathur Taluk, Kancheepuram, Tamil Nadu - 603 204.</div>
                  <div>E-mail : hsil.india@hydraspecma.com</div>
                  <div>www.hydraspecma.com</div>
                  <div>GSTIN: 33AABCH9436R1Z0</div>
                </div>
              </div>

              <hr style={{ border: "none", borderTop: "1px dashed #666666", margin: "16px 0 20px" }} />

              {/* Document Title */}
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{ fontSize: 19, fontWeight: 800, textDecoration: "underline", textUnderlineOffset: 5, margin: 0, color: "#000000", textTransform: "uppercase" }}>
                  {proposalPrintData.title}
                </h2>
                <div style={{ fontSize: 11, color: "#555555", marginTop: 4, fontWeight: 600 }}>
                  Ref: HS/IT/GEN-PROP/{new Date().getFullYear()} &nbsp;|&nbsp; Date: {formatDateDDMMMYYYY(proposalPrintData.proposal_date)} &nbsp;|&nbsp; Location: Oragadam
                </div>
              </div>

              {/* Multi-Employee Allocation Proposal Table */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 12, color: "#000000", marginBottom: 6 }}>
                  📋 Proposed Employees & General IT Hardware Allocations List:
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#f3f4f6", borderBottom: "2px solid #374151", textAlign: "left" }}>
                      <th style={{ padding: "6px 8px", width: 24 }}>#</th>
                      <th style={{ padding: "6px 8px" }}>Employee Name & ID</th>
                      <th style={{ padding: "6px 8px" }}>Dept</th>
                      <th style={{ padding: "6px 8px" }}>Category Tier</th>
                      <th style={{ padding: "6px 8px" }}>Proposed Specs</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Budget (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposalPrintData.items.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #e5e7eb" }}>
                        <td style={{ padding: "6px 8px", fontWeight: 700 }}>{idx + 1}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <div style={{ fontWeight: 700 }}>{item.employee_name}</div>
                          {item.employee_code && <div style={{ fontSize: 10, color: "#4b5563" }}>{item.employee_code}</div>}
                        </td>
                        <td style={{ padding: "6px 8px" }}>{item.department}</td>
                        <td style={{ padding: "6px 8px", fontWeight: 600, color: "#2563eb" }}>{item.asset_category}</td>
                        <td style={{ padding: "6px 8px" }}>{item.proposed_device || "—"}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>
                          ₹{Number(item.budget_amount).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f9fafb", borderTop: "2px solid #1f2937", fontWeight: 800 }}>
                      <td colSpan={5} style={{ padding: "8px", textAlign: "right" }}>
                        TOTAL PROPOSED BUDGET ({proposalPrintData.items.length} EMPLOYEES):
                      </td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#059669", fontSize: 12 }}>
                        ₹{proposalPrintData.totalBudget.toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Business Justification */}
              <div style={{ marginBottom: 28, fontSize: 12, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 800, textDecoration: "underline", marginBottom: 4 }}>
                  Business Justification & Department Entitlement:
                </div>
                <p style={{ margin: 0, padding: "8px 12px", borderLeft: "3px solid #2563eb", background: "#f8fafc" }}>
                  {proposalPrintData.justification || "Proposed as per company IT asset eligibility policy and department hardware requirements."}
                </p>
              </div>
            </div>

            {/* Bottom Container: 3-Tier Signatures & Footer Pinned to Bottom */}
            <div style={{ marginTop: "auto" }}>
              {/* 3-Tier Authorization Signature Section */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 28, fontSize: 11, fontWeight: 700, textAlign: "center" }}>
                <div>
                  <div style={{ borderBottom: "1px solid #000000", height: 40, marginBottom: 6 }}></div>
                  <span>Proposed By (IT / HR)</span>
                </div>

                <div>
                  <div style={{ borderBottom: "1px solid #000000", height: 40, marginBottom: 6 }}></div>
                  <span>Department Head Approval</span>
                </div>

                <div>
                  <div style={{ borderBottom: "1px solid #000000", height: 40, marginBottom: 6 }}></div>
                  <span>Finance / Management Authorization</span>
                </div>
              </div>

              {/* Footer Branding */}
              <div style={{ textAlign: "center", fontSize: 10, color: "#666666", borderTop: "1px solid #e5e7eb", paddingTop: 12, lineHeight: 1.5 }}>
                <div>A Company in the HydraSpecma Group</div>
                <div>Corporate Identity Number: U29219TN2007PTCO63264</div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Embedded CSS for Print Mode */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              body * { visibility: hidden !important; }
              #printable-issue-form, #printable-issue-form *,
              #printable-proposal-form, #printable-proposal-form * { visibility: visible !important; }
              #printable-issue-form, #printable-proposal-form {
                position: fixed !important;
                left: 0 !important; top: 0 !important;
                width: 100% !important; height: 100% !important;
                min-height: 275mm !important; margin: 0 !important;
                padding: 30px 45px 24px 45px !important;
                box-shadow: none !important; background: #ffffff !important;
                color: #000000 !important; border: none !important;
                display: flex !important; flex-direction: column !important;
                justify-content: space-between !important; box-sizing: border-box !important;
              }
            }
          `,
        }}
      />
    </Shell>
  );
}
