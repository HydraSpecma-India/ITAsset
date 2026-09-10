"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell, { isPhoneModuleAuthorized, canManagePhoneAllocations } from "@/components/Shell";
import { Card, Field, Modal, Empty } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { money, dateStr, todayISO, daysUntil, csvDownload, exportProposalToPdf } from "@/lib/format";
import { useAuth } from "@/lib/session";
import { useDept } from "@/lib/department";

const DEFAULT_PHONE_TIERS = [
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
  
  // Explicit Management Access Rule: IT Admin and Global Admin ONLY!
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

  // Dynamic Phone Categories State
  const [categories, setCategories] = useState([]);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [catForm, setCatForm] = useState({ name: "", budget: 25000, icon: "📱", description: "" });
  const [savingCat, setSavingCat] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("it_phone_categories")
        .select("*")
        .eq("is_active", true)
        .order("budget", { ascending: false });
      if (data && data.length > 0) {
        setCategories(data);
      }
    } catch (err) {
      console.error("Failed to load phone categories:", err);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const PHONE_TIERS = useMemo(() => {
    if (categories.length > 0) {
      return categories.map((c) => ({
        id: c.name,
        label: `${c.name} (Budget ₹${Number(c.budget).toLocaleString()})`,
        budget: Number(c.budget),
        icon: c.icon || "📱",
        desc: c.description || `Budget: ₹${Number(c.budget).toLocaleString()}`,
        raw: c,
      }));
    }
    return DEFAULT_PHONE_TIERS;
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
    const activeNonExpiringSet = new Set();
    rows.forEach((r) => {
      if (!isEligibleForProposal(r) && r.employee_name) {
        activeNonExpiringSet.add(r.employee_name.toLowerCase().trim());
      }
    });

    const sq = (empSearchQuery || "").toLowerCase().trim();

    let list = masterEmployees;
    if (sq) {
      list = list.filter(
        (e) =>
          (e.full_name || "").toLowerCase().includes(sq) ||
          (e.email || "").toLowerCase().includes(sq) ||
          (e.department || "").toLowerCase().includes(sq) ||
          (e.job_title || "").toLowerCase().includes(sq)
      );
    }

    return list
      .map((e) => ({
        ...e,
        isAlreadyActive: activeNonExpiringSet.has((e.full_name || "").toLowerCase().trim()),
      }))
      .slice(0, 30);
  }, [masterEmployees, empSearchQuery, rows]);

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

  // Multi-Person Mobile Category Proposal Form State & Handlers
  const [proposalModalOpen, setProposalModalOpen] = useState(false);
  const [proposalTitle, setProposalTitle] = useState("Mobile Phone Allocation Proposal");
  const [proposalJustification, setProposalJustification] = useState("Requested as per company mobile eligibility policy and department operational requirements.");
  const [proposalDate, setProposalDate] = useState(todayISO());
  const [proposalItems, setProposalItems] = useState([]);
  const [proposalPrintData, setProposalPrintData] = useState(null);
  const [proposalHistoryOpen, setProposalHistoryOpen] = useState(false);
  const [savedProposals, setSavedProposals] = useState([]);
  const [savingProposal, setSavingProposal] = useState(false);
  const [retrievedVersion, setRetrievedVersion] = useState(null);

  const loadSavedProposals = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("it_proposals")
        .select("*")
        .eq("module_type", "phone")
        .order("created_at", { ascending: false });
      setSavedProposals(data || []);
    } catch (err) {
      console.error("Failed to load saved proposals:", err);
    }
  }, []);

  useEffect(() => {
    loadSavedProposals();
  }, [loadSavedProposals]);
  const [proposalFocusIndex, setProposalFocusIndex] = useState(null);

  function isEligibleForProposal(r) {
    if (!r) return true;
    if (!r.status || r.status !== "Active") return true; // Eligible, Applied, Expired, Expiring Soon, etc.
    if (!r.expiry_date) return true; // No expiry date set

    try {
      const exp = new Date(r.expiry_date);
      if (isNaN(exp.getTime())) return true;
      const nextYearLimit = new Date();
      nextYearLimit.setDate(nextYearLimit.getDate() + 365); // Next 1 year expiry limit
      return exp <= nextYearLimit; // True if expiring within next 365 days or already expired
    } catch (err) {
      return true;
    }
  }

  function handleOpenProposal(catName = "all") {
    setRetrievedVersion(null);
    let initialItems = [];
    if (catName !== "all") {
      const matchingRows = rows.filter((r) => {
        const cat = (r.phone_category || "").toLowerCase().trim();
        const tid = (catName || "").toLowerCase().trim();
        const isCatMatch = cat === tid || cat.includes(tid) || tid.includes(cat);
        return isCatMatch && isEligibleForProposal(r);
      });

      if (matchingRows.length > 0) {
        initialItems = matchingRows.map((r) => ({
          tempId: r.id || "p_" + Math.random(),
          employee_name: r.employee_name,
          employee_code: r.employee_code || "",
          department: r.department || "IT",
          phone_category: r.phone_category,
          budget_amount: Number(r.budget_amount || 25000),
          eligible_date: r.eligible_date || todayISO(),
          proposed_device: r.device_details || `${r.phone_category} Device`,
        }));
      }
    } else {
      const eligibleRows = rows.filter((r) => isEligibleForProposal(r));
      if (eligibleRows.length > 0) {
        initialItems = eligibleRows.map((r) => ({
          tempId: r.id || "p_" + Math.random(),
          employee_name: r.employee_name,
          employee_code: r.employee_code || "",
          department: r.department || "IT",
          phone_category: r.phone_category || "iPhone (₹55k)",
          budget_amount: Number(r.budget_amount || 25000),
          eligible_date: r.eligible_date || todayISO(),
          proposed_device: r.device_details || `${r.phone_category || "Item"} Device`,
        }));
      }
    }

    if (initialItems.length === 0) {
      const selectedCatObj = PHONE_TIERS.find((t) => t.id === catName) || PHONE_TIERS[0];
      initialItems = [
        {
          tempId: "p_1",
          employee_name: "",
          employee_code: "",
          department: dept === "All" ? "IT" : dept,
          phone_category: selectedCatObj ? selectedCatObj.id : "iPhone (₹55k)",
          budget_amount: selectedCatObj ? selectedCatObj.budget : 55000,
          eligible_date: todayISO(),
          proposed_device: selectedCatObj ? `${selectedCatObj.id} Entitlement Device` : "Mobile Device",
        },
      ];
    }

    setProposalTitle(catName !== "all" ? `${catName} Allocation Proposal` : "Mobile Phone Allocation Proposal");
    setProposalJustification("Requested as per company mobile eligibility policy and department operational requirements.");
    setProposalDate(todayISO());
    setProposalItems(initialItems);
    setProposalFocusIndex(null);
    setProposalModalOpen(true);
  }

  function addProposalItem() {
    const selectedCatObj = PHONE_TIERS[0];
    setProposalItems((prev) => [
      ...prev,
      {
        tempId: "p_" + Date.now() + "_" + Math.random(),
        employee_name: "",
        employee_code: "",
        department: dept === "All" ? "IT" : dept,
        phone_category: selectedCatObj ? selectedCatObj.id : "iPhone (₹55k)",
        budget_amount: selectedCatObj ? selectedCatObj.budget : 55000,
        eligible_date: todayISO(),
        proposed_device: selectedCatObj ? `${selectedCatObj.id} Entitlement Device` : "Mobile Device",
      },
    ]);
  }

  function updateProposalItem(index, field, val) {
    setProposalItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const updated = { ...item, [field]: val };
        if (field === "phone_category" || field === "employee_name") {
          if (field === "employee_name") {
            const match = masterEmployees.find(
              (e) => (e.full_name || "").toLowerCase().trim() === (val || "").toLowerCase().trim()
            );
            if (match) {
              updated.employee_code = match.email || updated.employee_code;
              updated.department = match.department || updated.department;
            }
          }
        }
        if (field === "phone_category") {
          const catObj = PHONE_TIERS.find((t) => t.id === val);
          if (catObj) {
            updated.budget_amount = catObj.budget;
            if (!updated.proposed_device || updated.proposed_device.includes("Entitlement")) {
              updated.proposed_device = `${catObj.id} Entitlement Device`;
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
    const eligibleFiltered = filtered.filter((r) => isEligibleForProposal(r));
    if (eligibleFiltered.length === 0) {
      alert("No eligible employees (unassigned or expiring within next year) found in current filter.");
      return;
    }
    setProposalItems(
      eligibleFiltered.map((r) => ({
        tempId: r.id || "p_" + Math.random(),
        employee_name: r.employee_name,
        employee_code: r.employee_code || "",
        department: r.department || "IT",
        phone_category: r.phone_category || "iPhone (₹55k)",
        budget_amount: Number(r.budget_amount || 25000),
        eligible_date: r.eligible_date || todayISO(),
        proposed_device: r.device_details || `${r.phone_category || "Item"} Device`,
      }))
    );
  }

  function handleQuickDraftPrint(e) {
    if (e) e.preventDefault();
    const validItems = proposalItems.filter((i) => (i.employee_name || "").trim());
    if (validItems.length === 0) {
      alert("Please add at least one employee to the Proposal.");
      return;
    }
    const totalBudget = validItems.reduce((acc, curr) => acc + Number(curr.budget_amount || 0), 0);
    const year = new Date().getFullYear();

    setProposalPrintData({
      title: proposalTitle,
      justification: proposalJustification,
      proposal_date: proposalDate,
      items: validItems,
      totalBudget,
      isOfficial: false,
      versionLabel: "Draft Preview",
      proposalNo: `HS/IT/MOB-PROP/${year}/DRAFT`,
    });
    setProposalModalOpen(false);
  }

  async function handleSaveOfficialProposal(e) {
    if (e) e.preventDefault();
    const validItems = proposalItems.filter((i) => (i.employee_name || "").trim());
    if (validItems.length === 0) {
      alert("Please add at least one employee to the Official Proposal.");
      return;
    }

    setSavingProposal(true);
    try {
      const { data: existing } = await supabase
        .from("it_proposals")
        .select("version, proposal_no")
        .eq("module_type", "phone")
        .order("version", { ascending: false });

      let nextVersion = 1;
      let propSeq = (existing ? existing.length : 0) + 1;

      if (existing && existing.length > 0) {
        nextVersion = (existing[0].version || existing.length) + 1;
      }

      const year = new Date().getFullYear();
      const propNo = `HS/IT/MOB-PROP/${year}/${String(propSeq).padStart(3, "0")}`;
      const vLabel = `v${nextVersion}.0`;
      const totalBudget = validItems.reduce((acc, curr) => acc + Number(curr.budget_amount || 0), 0);

      const payload = {
        proposal_no: propNo,
        module_type: "phone",
        title: proposalTitle,
        version: nextVersion,
        version_label: vLabel,
        proposal_date: proposalDate,
        items: validItems,
        total_budget: totalBudget,
        justification: proposalJustification,
        status: "Submitted",
        created_at: new Date().toISOString(),
      };

      const { data, error } = await supabase.from("it_proposals").insert(payload).select().single();
      if (error) throw error;

      await loadSavedProposals();

      setProposalPrintData({
        title: proposalTitle,
        justification: proposalJustification,
        proposal_date: proposalDate,
        items: validItems,
        totalBudget,
        isOfficial: true,
        versionLabel: vLabel,
        proposalNo: propNo,
      });
      setRetrievedVersion(null);
      setProposalModalOpen(false);
      alert(`Official Proposal ${vLabel} (${propNo}) saved and stored in database successfully!`);
    } catch (err) {
      console.error("Save official proposal error:", err);
      alert("Failed to save official proposal: " + (err.message || String(err)));
    } finally {
      setSavingProposal(false);
    }
  }

  function handleRetrieveProposal(propRecord) {
    setProposalTitle(propRecord.title || "Mobile Phone Allocation Proposal");
    setProposalJustification(propRecord.justification || "");
    setProposalDate(todayISO());
    const versionStr = propRecord.version_label || `v${propRecord.version}.0`;
    setRetrievedVersion(`${versionStr} (${propRecord.proposal_no})`);

    const items = (propRecord.items || []).map((item, idx) => ({
      ...item,
      tempId: item.tempId || "p_ret_" + idx + "_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      eligible_date: item.eligible_date || todayISO(),
    }));
    setProposalItems(items);
    setProposalHistoryOpen(false);
    setProposalModalOpen(true);
  }

  function handleRePrintSavedProposal(propRecord) {
    setProposalPrintData({
      title: propRecord.title,
      justification: propRecord.justification,
      proposal_date: propRecord.proposal_date,
      items: propRecord.items || [],
      totalBudget: Number(propRecord.total_budget || 0),
      isOfficial: true,
      versionLabel: propRecord.version_label || `v${propRecord.version}.0`,
      proposalNo: propRecord.proposal_no,
    });
    setProposalHistoryOpen(false);
  }

  async function handleDeleteSavedProposal(id) {
    if (!confirm("Are you sure you want to delete this saved proposal version record?")) return;
    try {
      const { error } = await supabase.from("it_proposals").delete().eq("id", id);
      if (error) throw error;
      await loadSavedProposals();
    } catch (err) {
      alert("Failed to delete proposal version: " + err.message);
    }
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
      if (tierFilter !== "all") {
        const catName = (r.phone_category || "").toLowerCase().trim();
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

  function handleOpenAddCat() {
    setEditingCat(null);
    setCatForm({ name: "", budget: 25000, icon: "📱", description: "" });
  }

  function handleOpenEditCat(c) {
    setEditingCat(c);
    setCatForm({
      name: c.name || "",
      budget: c.budget || 25000,
      icon: c.icon || "📱",
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
      icon: catForm.icon.trim() || "📱",
      description: catForm.description.trim() || null,
      is_active: true,
    };

    try {
      if (editingCat?.id) {
        const { error } = await supabase.from("it_phone_categories").update(payload).eq("id", editingCat.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("it_phone_categories").insert(payload);
        if (error) throw error;
      }
      await loadCategories();
      setEditingCat(null);
      setCatForm({ name: "", budget: 25000, icon: "📱", description: "" });
    } catch (err) {
      alert("Failed to save category: " + (err.message || String(err)));
    } finally {
      setSavingCat(false);
    }
  }

  async function handleDeleteCat(c) {
    if (!confirm(`Are you sure you want to delete phone category "${c.name}"?`)) return;
    try {
      const { error } = await supabase.from("it_phone_categories").delete().eq("id", c.id);
      if (error) throw error;
      await loadCategories();
    } catch (err) {
      alert("Failed to delete category: " + err.message);
    }
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

  // Print Mobile Issue Form State & Helpers
  const [printRow, setPrintRow] = useState(null);

  function formatDateDDMMMYYYY(dateStrStr) {
    if (!dateStrStr) return "—";
    const d = new Date(dateStrStr);
    if (isNaN(d.getTime())) return dateStrStr;
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }

  function getDeviceMake(deviceDetails) {
    if (!deviceDetails) return "Android / Standard";
    const str = deviceDetails.toLowerCase();
    if (str.includes("iphone") || str.includes("apple") || str.includes("ipad")) return "Apple";
    if (str.includes("samsung") || str.includes("galaxy")) return "Samsung";
    if (str.includes("pixel") || str.includes("google")) return "Google";
    if (str.includes("oneplus")) return "OnePlus";
    if (str.includes("xiaomi") || str.includes("redmi")) return "Xiaomi";
    if (str.includes("vivo") || str.includes("oppo")) return "Oppo/Vivo";
    return "Android / Standard";
  }

  function handleOpenPrintForm(r) {
    setPrintRow(r);
  }

  function handlePrintAction() {
    window.print();
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
        const empName = (r.employee_name || "").trim();
        if (!empName) continue;

        const empDept = r.department || (dept === "All" ? "IT" : dept);

        const payload = {
          employee_name: empName,
          employee_code: (r.employee_code || "").trim() || null,
          department: empDept,
          phone_category: r.phone_category || "Android Standard (₹25k)",
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
      setDeptFilter("All");
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
      phone_category: form.phone_category || "Android Standard (₹25k)",
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
        const { error } = await supabase.from("it_phone_allocations").update(payload).eq("id", editingRow.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("it_phone_allocations").insert(payload);
        if (error) throw error;
      }

      setModalOpen(false);

      if (deptFilter !== "All" && deptFilter !== empDept) {
        setDeptFilter("All");
      }

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
            <button
              className="btn ghost sm"
              onClick={() => handleOpenProposal("iPhone (₹55k)")}
              style={{ borderColor: "var(--gold)", color: "var(--gold)", fontWeight: 600 }}
            >
              📄 Mobile Proposal Form
            </button>
            <button
              className="btn ghost sm"
              onClick={() => setProposalHistoryOpen(true)}
              style={{ borderColor: "var(--border)", color: "var(--fg)" }}
            >
              📜 Proposal History ({savedProposals.length})
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
        {/* All Tiers Option Card */}
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
            All Phone Categories
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Click to view all employee allocations</div>
        </Card>

        {PHONE_TIERS.map((tier) => {
          const isActiveFilter = tierFilter === tier.id;
          const count = rows.filter((r) => {
            const cat = (r.phone_category || "").toLowerCase().trim();
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
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="text"
                        placeholder="Code or Email"
                        value={r.employee_code || ""}
                        onChange={(e) => handleGridChange(rowKey, "employee_code", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
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
                    <td style={{ padding: "4px 6px" }}>
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
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="number"
                        value={r.budget_amount || 0}
                        onChange={(e) => handleGridChange(rowKey, "budget_amount", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="date"
                        value={r.eligible_date || ""}
                        onChange={(e) => handleGridChange(rowKey, "eligible_date", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="date"
                        value={r.received_date || ""}
                        onChange={(e) => handleGridReceivedDateChange(rowKey, e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 11, borderRadius: 4, border: "1px solid var(--gold)", background: "rgba(255,204,0,0.1)", color: "var(--fg)", fontWeight: 600 }}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="date"
                        value={r.expiry_date || ""}
                        onChange={(e) => handleGridChange(rowKey, "expiry_date", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
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
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="text"
                        placeholder="e.g. iPhone 15"
                        value={r.device_details || ""}
                        onChange={(e) => handleGridChange(rowKey, "device_details", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="text"
                        placeholder="IMEI code"
                        value={r.serial_imei || ""}
                        onChange={(e) => handleGridChange(rowKey, "serial_imei", e.target.value)}
                        style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
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

      {/* Modal for Managing Phone Categories & Tiers */}
      {catModalOpen && (
        <Modal
          title="⚙️ Manage Mobile Phone Categories & Budget Tiers"
          onClose={() => setCatModalOpen(false)}
        >
          <div className="stack" style={{ gap: 16 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
              Manage active phone model tiers, icon badges, default policy budget amounts, and tier descriptions.
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
                        <span style={{ fontSize: 16, marginRight: 6 }}>{c.icon || "📱"}</span> {c.name}
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
                {editingCat ? `✏️ Edit Category — ${editingCat.name}` : "➕ Add New Phone Category Tier"}
              </div>
              <form onSubmit={handleSaveCat} className="stack" style={{ gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Category Name *">
                    <input
                      type="text"
                      required
                      placeholder="e.g. iPhone Executive (₹65k)"
                      value={catForm.name}
                      onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                    />
                  </Field>

                  <Field label="Policy Budget (₹) *">
                    <input
                      type="number"
                      required
                      placeholder="e.g. 65000"
                      value={catForm.budget}
                      onChange={(e) => setCatForm({ ...catForm, budget: e.target.value })}
                    />
                  </Field>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10 }}>
                  <Field label="Icon Emoji">
                    <input
                      type="text"
                      placeholder="🍏 or 🤖"
                      value={catForm.icon}
                      onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })}
                    />
                  </Field>

                  <Field label="Tier Description">
                    <input
                      type="text"
                      placeholder="e.g. Senior Leadership & Executive Tier"
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

      {/* Official HydraSpecma Mobile Issue Form Printable Modal */}
      {printRow && (
        <Modal
          title={`📄 Official Mobile Issue Form — ${printRow.employee_name}`}
          onClose={() => setPrintRow(null)}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, gap: 10 }}>
            <button className="btn sm primary" onClick={handlePrintAction}>
              🖨️ Print Document
            </button>
            <button className="btn ghost sm" onClick={() => setPrintRow(null)}>
              Close
            </button>
          </div>

          {/* Printable Sheet formatted to match Image 3 */}
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
              {/* Header Section */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  {/* Logo Branding */}
                  <img
                    src="/hydraspecma-logo.png"
                    alt="HydraSpecma Logo"
                    style={{ height: 60, width: "auto", objectFit: "contain" }}
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

              <hr style={{ border: "none", borderTop: "1px dashed #666666", margin: "16px 0 24px" }} />

              {/* Document Title */}
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <h2 style={{ fontSize: 22, fontWeight: 800, textDecoration: "underline", textUnderlineOffset: 6, margin: 0, color: "#000000" }}>
                  Mobile Issue Form
                </h2>
              </div>

              {/* Employee Details List */}
              <div style={{ marginBottom: 28, fontSize: 13, lineHeight: 2 }}>
                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Name of Employee</span>
                  <span>:</span>
                  <span style={{ fontWeight: 700 }}>
                    {printRow.employee_name}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Emp. ID</span>
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
                  <span style={{ fontWeight: 700 }}>
                    Oragadam
                  </span>
                </div>
              </div>

              {/* Device Details Section */}
              <div style={{ marginBottom: 28, fontSize: 13, lineHeight: 2 }}>
                <div style={{ marginBottom: 8, fontStyle: "italic" }}>I have received the following device:</div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Model No.</span>
                  <span>:</span>
                  <span style={{ fontWeight: 700 }}>
                    {printRow.device_details || printRow.phone_category}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Make</span>
                  <span>:</span>
                  <span style={{ fontWeight: 600 }}>{getDeviceMake(printRow.device_details || printRow.phone_category)}</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 20px 1fr", alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Serial No.</span>
                  <span>:</span>
                  <span style={{ fontWeight: 800, color: "#002060" }}>{printRow.serial_imei || "—"}</span>
                </div>
              </div>

              {/* Declaration by Employee */}
              <div style={{ marginBottom: 45, fontSize: 12, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 800, textDecoration: "underline", marginBottom: 6 }}>
                  Declaration by Employee:
                </div>
                <p style={{ margin: 0, textIndent: 36 }}>
                  I understand that I am responsible for the device issued to me and that I will care for the device in such a manner as to prevent loss or damage.
                </p>
              </div>

            </div>

            {/* Bottom Container: Signatures & Footer Pinned to Bottom */}
            <div style={{ marginTop: "auto" }}>
              {/* Signature Section */}
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

              {/* Footer Branding */}
              <div style={{ textAlign: "center", fontSize: 10, color: "#666666", borderTop: "1px solid #e5e7eb", paddingTop: 12, lineHeight: 1.5 }}>
                <div>A Company in the HydraSpecma Group</div>
                <div>Corporate Identity Number: U29219TN2007PTCO63264</div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal for Creating / Editing Multi-Person Mobile Phone Allocation Proposal */}
      {proposalModalOpen && (
        <Modal
          title={retrievedVersion ? `🔄 Edit Proposal & Submit New Version (Loaded from ${retrievedVersion}) — ${proposalItems.length} Employee(s)` : `📄 Create Mobile Phone Allocation Proposal — ${proposalItems.length} Employee(s)`}
          onClose={() => setProposalModalOpen(false)}
          wide
        >
          <form onSubmit={handleSaveOfficialProposal} className="stack" style={{ gap: 14 }}>
            {retrievedVersion && (
              <div style={{ padding: "8px 12px", background: "rgba(37, 99, 235, 0.12)", border: "1px solid #2563eb", borderRadius: 6, fontSize: 12, color: "#2563eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>🔄 <strong>Retrieved Proposal Version ({retrievedVersion}) Loaded:</strong> Modify items/fields below and click <strong>Option 2</strong> to submit as a <strong>NEW version</strong>.</span>
                <button type="button" style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontWeight: "bold", fontSize: 14 }} onClick={() => setRetrievedVersion(null)}>✕</button>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12 }}>
              <Field label="Proposal Title / Subject *">
                <input
                  type="text"
                  required
                  value={proposalTitle}
                  onChange={(e) => setProposalTitle(e.target.value)}
                  placeholder="e.g. Executive Mobile Phone Allocation Proposal"
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
                <datalist id="proposal-emp-datalist">
                  {masterEmployees.map((emp) => (
                    <option key={emp.id} value={emp.full_name}>
                      {emp.department ? `${emp.department} • ${emp.email || ''}` : emp.email}
                    </option>
                  ))}
                </datalist>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn ghost sm" onClick={populateFilteredToProposal} style={{ fontSize: 11, borderColor: "var(--gold)", color: "var(--gold)" }}>
                    👥 Load Eligible ({filtered.filter((r) => isEligibleForProposal(r)).length})
                  </button>
                  <button type="button" className="btn sm" onClick={addProposalItem} style={{ fontSize: 11, background: "#2563eb", color: "#fff" }}>
                    ➕ Add Employee
                  </button>
                </div>
              </div>

              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6, minHeight: 220, maxHeight: 360, overflowY: "auto", paddingBottom: proposalFocusIndex !== null ? 140 : 0 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                      <th style={{ padding: "8px", width: 30 }}>#</th>
                      <th style={{ padding: "8px", minWidth: 160 }}>Employee Name *</th>
                      <th style={{ padding: "8px", minWidth: 110 }}>Emp ID / Email</th>
                      <th style={{ padding: "8px", minWidth: 110 }}>Department</th>
                      <th style={{ padding: "8px", minWidth: 140 }}>Category Tier</th>
                      <th style={{ padding: "8px", minWidth: 115 }}>Eligible From</th>
                      <th style={{ padding: "8px", minWidth: 90 }}>Budget (₹)</th>
                      <th style={{ padding: "8px", minWidth: 140 }}>Proposed Device Specs</th>
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
                            list="proposal-emp-datalist"
                            placeholder="🔍 Search employee master..."
                            value={item.employee_name}
                            onFocus={() => {
                              setProposalFocusIndex(idx);
                              setEmpSearchQuery(item.employee_name || "");
                            }}
                            onChange={(e) => {
                              updateProposalItem(idx, "employee_name", e.target.value);
                              setEmpSearchQuery(e.target.value);
                              setProposalFocusIndex(idx);
                            }}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--gold)", background: "var(--bg-input)", color: "var(--fg)" }}
                          />
                          {proposalFocusIndex === idx && (
                            <div
                              onMouseDown={(e) => e.preventDefault()}
                              style={{
                                position: "absolute",
                                top: "100%",
                                left: 0,
                                zIndex: 99999,
                                width: 260,
                                maxHeight: 200,
                                overflowY: "auto",
                                background: "#18181b",
                                border: "1px solid var(--gold)",
                                borderRadius: 6,
                                boxShadow: "0 10px 30px rgba(0,0,0,0.95)",
                                padding: 4,
                                marginTop: 2,
                              }}
                            >
                              <div style={{ padding: "4px 6px", fontSize: 10, color: "var(--gold)", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span>👥 Select Employee ({filteredMasterEmployees.length})</span>
                                <span style={{ cursor: "pointer", fontWeight: "bold", padding: "0 4px" }} onClick={() => setProposalFocusIndex(null)}>✕</span>
                              </div>
                              {filteredMasterEmployees.length === 0 ? (
                                <div style={{ padding: "8px", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
                                  No matching employees found
                                </div>
                              ) : (
                                filteredMasterEmployees.map((emp) => (
                                  <div
                                    key={emp.id}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      updateProposalItem(idx, "employee_name", emp.full_name);
                                      updateProposalItem(idx, "employee_code", emp.email || item.employee_code);
                                      updateProposalItem(idx, "department", emp.department || item.department);
                                      setProposalFocusIndex(null);
                                    }}
                                    style={{ padding: "6px 8px", cursor: "pointer", borderRadius: 4, borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                                  >
                                    <div style={{ fontWeight: 600, fontSize: 11, color: "var(--fg)" }}>{emp.full_name}</div>
                                    <div style={{ fontSize: 10, color: "var(--muted)" }}>🏢 {emp.department || "General"} {emp.email ? `• ${emp.email}` : ''} {emp.isAlreadyActive ? <span style={{ color: "#ef4444", fontWeight: "bold", marginLeft: 4 }}>• ⚠️ Active Issued</span> : <span style={{ color: "#10b981", marginLeft: 4 }}>• ✅ Eligible</span>}</div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "4px 6px" }}>
                          <input
                            type="text"
                            placeholder="Emp ID"
                            value={item.employee_code}
                            onChange={(e) => updateProposalItem(idx, "employee_code", e.target.value)}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                          />
                        </td>
                        <td style={{ padding: "4px 6px" }}>
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
                        <td style={{ padding: "4px 6px" }}>
                          <select
                            value={item.phone_category}
                            onChange={(e) => updateProposalItem(idx, "phone_category", e.target.value)}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                          >
                            {PHONE_TIERS.map((t) => (
                              <option key={t.id} value={t.id}>{t.id}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "4px 6px" }}>
                          <input
                            type="date"
                            value={item.eligible_date || todayISO()}
                            onChange={(e) => updateProposalItem(idx, "eligible_date", e.target.value)}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 11, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)" }}
                          />
                        </td>
                        <td style={{ padding: "4px 6px" }}>
                          <input
                            type="number"
                            value={item.budget_amount}
                            onChange={(e) => updateProposalItem(idx, "budget_amount", Number(e.target.value))}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--fg)", fontWeight: 700 }}
                          />
                        </td>
                        <td style={{ padding: "4px 6px" }}>
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
                      <td colSpan={5} style={{ padding: "5px 6px", textAlign: "right" }}>
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
                placeholder="Required for company mobile entitlement policy, operational team mobility and executive communication..."
                value={proposalJustification}
                onChange={(e) => setProposalJustification(e.target.value)}
              />
            </Field>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <button type="button" className="btn ghost" onClick={() => setProposalModalOpen(false)}>
                Cancel
              </button>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="btn ghost" onClick={handleQuickDraftPrint} style={{ borderColor: "var(--gold)", color: "var(--gold)", fontWeight: 600 }}>
                  📄 Option 1: Quick Draft Print (Devices & Prices)
                </button>
                <button type="submit" className="btn primary" disabled={savingProposal}>
                  {savingProposal ? "Saving to Database..." : "💾 Option 2: Save & Issue Official Proposal (With Versioning)"}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Printable Official HydraSpecma Multi-Person Mobile Proposal Form */}
      {proposalPrintData && (
        <Modal
          title={`📄 ${proposalPrintData.title} (${proposalPrintData.items.length} Employees)`}
          onClose={() => setProposalPrintData(null)}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, gap: 10 }}>
            <button
              className="btn sm primary"
              onClick={() => {
                const fname = `${(proposalPrintData.title || "Proposal").replace(/[^a-zA-Z0-9]/g, "_")}_${proposalPrintData.versionLabel || "Draft"}.pdf`;
                exportProposalToPdf("printable-proposal-form", fname);
              }}
              style={{ background: "#2563eb", color: "#ffffff", fontWeight: 700 }}
            >
              📥 Download PDF
            </button>
            <button className="btn ghost sm" onClick={() => window.print()}>
              🖨️ Browser Print
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
              padding: "24px 32px 16px 32px",
              borderRadius: 8,
              fontFamily: "'Segoe UI', Arial, sans-serif",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              maxWidth: 740,
              margin: "0 auto",
              border: "1px solid #e5e7eb",
              boxSizing: "border-box",
            }}
          >
            {/* Header Section */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <img
                  src="/hydraspecma-logo.png"
                  alt="HydraSpecma Logo"
                  style={{ height: 60, width: "auto", objectFit: "contain" }}
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

            <hr style={{ border: "none", borderTop: "1px dashed #666666", margin: "10px 0 14px" }} />

            {/* Document Title */}
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, textDecoration: "underline", textUnderlineOffset: 4, margin: 0, color: "#000000", textTransform: "uppercase" }}>
                {proposalPrintData.title}
              </h2>
              <div style={{ fontSize: 10, color: "#555555", marginTop: 4, fontWeight: 600 }}>
                Ref: {proposalPrintData.proposalNo || 'HS/IT/PROP/2026'} &nbsp;|&nbsp; Date: {formatDateDDMMMYYYY(proposalPrintData.proposal_date)} &nbsp;|&nbsp; Location: Oragadam &nbsp;|&nbsp; <span style={{ padding: "2px 8px", background: proposalPrintData.isOfficial ? "#dcfce7" : "#fef3c7", color: proposalPrintData.isOfficial ? "#15803d" : "#b45309", borderRadius: 4, fontWeight: 800 }}>{proposalPrintData.isOfficial ? `OFFICIAL RECORD ${proposalPrintData.versionLabel || ''}` : 'DRAFT PREVIEW'}</span>
              </div>
            </div>

            {/* Multi-Employee Allocation Proposal Table */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 11, color: "#000000", marginBottom: 6 }}>
                📋 Proposed Employees & Device Allocations List:
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6", borderBottom: "2px solid #374151", textAlign: "left" }}>
                    <th style={{ padding: "4px 6px", width: 20 }}>#</th>
                    <th style={{ padding: "4px 6px" }}>Employee Name & ID</th>
                    <th style={{ padding: "4px 6px" }}>Dept</th>
                    <th style={{ padding: "4px 6px" }}>Category Tier</th>
                    <th style={{ padding: "4px 6px" }}>Eligible From</th>
                    <th style={{ padding: "4px 6px" }}>Proposed Specs</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>Budget (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {(proposalPrintData.items || []).map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "4px 6px", fontWeight: 700 }}>{idx + 1}</td>
                      <td style={{ padding: "4px 6px" }}>
                        <div style={{ fontWeight: 700 }}>{item.employee_name}</div>
                        {item.employee_code && <div style={{ fontSize: 9, color: "#4b5563", lineHeight: 1.1 }}>{item.employee_code}</div>}
                      </td>
                      <td style={{ padding: "4px 6px" }}>{item.department}</td>
                      <td style={{ padding: "4px 6px", fontWeight: 600, color: "#2563eb" }}>{item.phone_category || item.laptop_category || item.asset_category}</td>
                      <td style={{ padding: "4px 6px" }}>{item.eligible_date ? dateStr(item.eligible_date) : "—"}</td>
                      <td style={{ padding: "4px 6px" }}>{item.proposed_device || "—"}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700 }}>
                        ₹{Number(item.budget_amount).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#f9fafb", borderTop: "2px solid #1f2937", fontWeight: 800 }}>
                    <td colSpan={6} style={{ padding: "5px 6px", textAlign: "right" }}>
                      TOTAL PROPOSED BUDGET ({(proposalPrintData.items || []).length} EMPLOYEES):
                    </td>
                    <td style={{ padding: "5px 6px", textAlign: "right", color: "#059669", fontSize: 11 }}>
                      ₹{proposalPrintData.totalBudget.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Business Justification */}
            <div style={{ marginBottom: 16, fontSize: 11, lineHeight: 1.4 }}>
              <div style={{ fontWeight: 800, textDecoration: "underline", marginBottom: 4 }}>
                Business Justification & Department Entitlement:
              </div>
              <p style={{ margin: 0, padding: "6px 10px", borderLeft: "3px solid #2563eb", background: "#f8fafc", fontSize: "10.5px" }}>
                {proposalPrintData.justification || "Proposed as per company policy entitlement and department operational requirements."}
              </p>
            </div>

            {/* 2 Signatures Block: Proposed By (IT) & Approved By (Country Manager) */}
            <div className="print-avoid-break" style={{ marginTop: 24, paddingTop: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginBottom: 20, fontSize: 11, fontWeight: 700, textAlign: "center" }}>
                <div>
                  <div style={{ borderBottom: "1px solid #000000", height: 36, marginBottom: 6 }}></div>
                  <span>Proposed By (IT)</span>
                </div>

                <div>
                  <div style={{ borderBottom: "1px solid #000000", height: 36, marginBottom: 6 }}></div>
                  <span>Approved By (Country Manager)</span>
                </div>
              </div>

              {/* Footer Branding */}
              <div style={{ textAlign: "center", fontSize: 9, color: "#666666", borderTop: "1px solid #e5e7eb", paddingTop: 8, lineHeight: 1.4 }}>
                <div>A Company in the HydraSpecma Group</div>
                <div>Corporate Identity Number: U29219TN2007PTCO63264</div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal for Saved Proposal History & Database Versions */}
      {proposalHistoryOpen && (
        <Modal
          title="📜 Saved Official Proposal Versions & History Archive"
          onClose={() => setProposalHistoryOpen(false)}
          wide
        >
          <div className="stack" style={{ gap: 14 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              History of all stored official proposals and version records saved in the database. You can re-print any version at any time.
            </div>

            {savedProposals.length === 0 ? (
              <Card style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>
                No saved proposal version records found in database. Create a proposal and click <strong>Option 2: Save & Issue Official Proposal</strong> to store versions here.
              </Card>
            ) : (
              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                      <th style={{ padding: "8px 10px" }}>Version</th>
                      <th style={{ padding: "8px 10px" }}>Proposal Ref No</th>
                      <th style={{ padding: "8px 10px" }}>Title / Subject</th>
                      <th style={{ padding: "8px 10px" }}>Date</th>
                      <th style={{ padding: "8px 10px" }}>Employees</th>
                      <th style={{ padding: "8px 10px", textAlign: "right" }}>Total Budget (₹)</th>
                      <th style={{ padding: "8px 10px", textAlign: "center" }}>Status</th>
                      <th style={{ padding: "8px 10px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedProposals.map((p) => (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 10px", fontWeight: 700, color: "var(--gold)" }}>
                          <span className="pill violet">{p.version_label || `v${p.version}.0`}</span>
                        </td>
                        <td style={{ padding: "8px 10px", fontWeight: 700 }} className="mono">
                          {p.proposal_no}
                        </td>
                        <td style={{ padding: "8px 10px", fontWeight: 600 }}>{p.title}</td>
                        <td style={{ padding: "8px 10px" }}>{dateStr(p.proposal_date)}</td>
                        <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                          {Array.isArray(p.items) ? p.items.length : 0} Employee(s)
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: "var(--gold)" }} className="mono">
                          ₹{Number(p.total_budget || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "center" }}>
                          <span className="pill green">{p.status || "Submitted"}</span>
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <button
                            className="btn ghost sm"
                            onClick={() => handleRetrieveProposal(p)}
                            style={{ marginRight: 6, borderColor: "#2563eb", color: "#2563eb", fontWeight: 600 }}
                            title="Load this proposal into the editor to modify and save as a new version"
                          >
                            ✏️ Retrieve & Edit
                          </button>
                          <button
                            className="btn ghost sm"
                            onClick={() => handleRePrintSavedProposal(p)}
                            style={{ marginRight: 6, borderColor: "var(--gold)", color: "var(--gold)" }}
                          >
                            🖨️ Re-Print Version
                          </button>
                          <button
                            className="btn ghost sm"
                            onClick={() => handleDeleteSavedProposal(p.id)}
                            style={{ color: "var(--red)" }}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={() => setProposalHistoryOpen(false)}>
                Close History
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Embedded CSS for Print Mode */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page {
                size: A4 portrait;
                margin: 8mm 10mm 8mm 10mm;
              }
              html, body {
                background: #ffffff !important;
                color: #000000 !important;
                margin: 0 !important;
                padding: 0 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              /* Strip Modal fixed backdrops during browser print */
              div[role="dialog"],
              div[style*="position: fixed"] {
                position: static !important;
                background: transparent !important;
                box-shadow: none !important;
                border: none !important;
                overflow: visible !important;
                height: auto !important;
                width: auto !important;
                max-height: none !important;
                transform: none !important;
              }
              body * {
                visibility: hidden !important;
              }
              #printable-issue-form, #printable-issue-form *,
              #printable-proposal-form, #printable-proposal-form * {
                visibility: visible !important;
              }
              #printable-issue-form {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                height: 100% !important;
                min-height: 265mm !important;
                margin: 0 !important;
                padding: 0 !important;
                box-shadow: none !important;
                background: #ffffff !important;
                color: #000000 !important;
                border: none !important;
                display: flex !important;
                flex-direction: column !important;
                justify-content: space-between !important;
                box-sizing: border-box !important;
              }
              #printable-proposal-form {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                box-shadow: none !important;
                background: #ffffff !important;
                color: #000000 !important;
                border: none !important;
                display: block !important;
                box-sizing: border-box !important;
              }
              tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
              .print-avoid-break {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
            }
          `,
        }}
      />
    </Shell>
  );
}
