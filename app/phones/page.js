"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
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

  function handleReceivedDateChange(recDate) {
    let autoExp = form.expiry_date;
    if (recDate && !form.expiry_date) {
      // Default policy expiry is 2 years (24 months) from received date
      const d = new Date(recDate);
      d.setFullYear(d.getFullYear() + 2);
      autoExp = d.toISOString().split("T")[0];
    }
    setForm((prev) => ({
      ...prev,
      received_date: recDate,
      expiry_date: autoExp,
      status: recDate ? (prev.status === "Eligible" ? "Active" : prev.status) : prev.status,
    }));
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

  return (
    <Shell
      title="📱 Mobile Phone Allocation Module"
      subtitle={`${dept === "All" ? "All Departments" : dept} employee phone eligibility matrix, device tiers (iPhone ₹55k, Android ₹55k, Android ₹25k) & policy renewal tracking`}
      actions={
        <>
          <button className="btn ghost sm" onClick={handleExportCsv}>
            Export CSV
          </button>
          {canEdit && (
            <button className="btn sm" onClick={handleOpenAdd}>
              + New Allocation
            </button>
          )}
        </>
      }
    >
      {!canEdit && (
        <div className="alert info">
          You have View-Only access for {dept}. Phone allocations and eligibility records can only be updated by a Department Administrator.
        </div>
      )}

      {/* KPI Cards Header */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 16 }}>
        <div style={{ padding: 14, background: "rgba(255,255,255,0.03)", border: "1px solid var(--line-soft)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Total Monitored</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }} className="mono">{kpis.totalCount}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>Allocated & eligible staff</div>
        </div>

        <div style={{ padding: 14, background: "rgba(63,191,143,0.08)", border: "1px solid rgba(63,191,143,0.3)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green)", textTransform: "uppercase" }}>Active Issued Devices</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--green)", marginTop: 2 }} className="mono">{kpis.activeCount}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>Phones currently in use</div>
        </div>

        <div style={{ padding: 14, background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.3)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase" }}>Eligible / Pending</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--blue)", marginTop: 2 }} className="mono">{kpis.eligibleCount}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>Ready for issuance</div>
        </div>

        <div style={{ padding: 14, background: "rgba(226,96,79,0.08)", border: "1px solid rgba(226,96,79,0.3)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", textTransform: "uppercase" }}>Expired / Upgrade Due</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--red)", marginTop: 2 }} className="mono">{kpis.expiredCount}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>Needs policy replacement</div>
        </div>

        <div style={{ padding: 14, background: "rgba(255,204,0,0.08)", border: "1px solid rgba(255,204,0,0.3)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gold)", textTransform: "uppercase" }}>Policy Commitment</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--gold)", marginTop: 2 }} className="mono">{money(kpis.totalBudgetCommitment)}</div>
          <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>Total device budget value</div>
        </div>
      </div>

      {/* Visual Model Tiers Summary Banner */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        {PHONE_TIERS.map((tier) => {
          const count = rows.filter((r) => r.phone_category === tier.id).length;
          return (
            <div
              key={tier.id}
              onClick={() => setTierFilter(tierFilter === tier.id ? "all" : tier.id)}
              style={{
                padding: "12px 14px",
                background: tierFilter === tier.id ? "rgba(255,204,0,0.12)" : "rgba(255,255,255,0.02)",
                border: tierFilter === tier.id ? "1px solid var(--gold)" : "1px solid var(--line-soft)",
                borderRadius: 8,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 16 }}>{tier.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700 }} className="mono">{money(tier.budget)}</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4, color: "var(--text)" }}>{tier.id}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                <span>{tier.desc}</span>
                <span style={{ fontWeight: 700, color: "var(--gold)" }}>{count} Allocations</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter & Search Bar */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="🔍 Search employee name, code, IMEI, model..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1, minWidth: 220, padding: "7px 10px", fontSize: 12 }}
          />

          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={{ padding: "7px 10px", fontSize: 12 }}>
            <option value="all">All Category Tiers</option>
            {PHONE_TIERS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "7px 10px", fontSize: 12 }}>
            <option value="all">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {(q || tierFilter !== "all" || statusFilter !== "all") && (
            <button
              className="btn ghost sm"
              onClick={() => {
                setQ("");
                setTierFilter("all");
                setStatusFilter("all");
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </Card>

      {/* Allocation Register Table */}
      {loading ? (
        <div className="loading">Loading phone allocation register...</div>
      ) : filtered.length === 0 ? (
        <Empty>No phone allocation records found. Click '+ New Allocation' to add employee device records.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee Name & Code</th>
                <th>Department</th>
                <th>Phone Model Tier</th>
                <th>Policy Budget</th>
                <th>Eligible Date</th>
                <th>Received Date</th>
                <th>Policy Expiry Date</th>
                <th>Status</th>
                <th>Device & IMEI / Serial</th>
                <th>Remarks</th>
                {canEdit && <th style={{ textAlign: "right" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const daysExp = r.expiry_date ? daysUntil(r.expiry_date) : null;
                const isExp = r.status === "Expired" || (daysExp !== null && daysExp < 0);

                let statusPillClass = "grey";
                if (isExp) statusPillClass = "red";
                else if (r.status === "Active") statusPillClass = "green";
                else if (r.status === "Eligible") statusPillClass = "blue";
                else if (r.status === "Applied") statusPillClass = "violet";
                else if (r.status === "Expiring Soon" || (daysExp !== null && daysExp <= 60)) statusPillClass = "amber";

                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.employee_name}</div>
                      <div style={{ fontSize: 11, color: "var(--faint)" }}>{r.employee_code || "—"}</div>
                    </td>
                    <td><span className="pill grey">{r.department}</span></td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>
                        {r.phone_category.includes("iPhone") ? "🍏 " : r.phone_category.includes("Android High") ? "🤖 " : "📱 "}
                        {r.phone_category}
                      </div>
                    </td>
                    <td className="num mono" style={{ fontWeight: 600 }}>{money(r.budget_amount)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{dateStr(r.eligible_date)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.received_date ? dateStr(r.received_date) : <span style={{ color: "var(--faint)", fontStyle: "italic" }}>Not Received</span>}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
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
                    <td>
                      <span className={`pill ${statusPillClass}`}>{isExp ? "Expired" : r.status}</span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {r.device_details ? (
                        <div>
                          <div style={{ fontWeight: 600 }}>{r.device_details}</div>
                          {r.serial_imei && <div className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>IMEI: {r.serial_imei}</div>}
                        </div>
                      ) : (
                        <span style={{ color: "var(--faint)", fontStyle: "italic" }}>No Device Assigned</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.remarks || "—"}</td>
                    {canEdit && (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Employee Name *">
                <input
                  type="text"
                  required
                  placeholder="e.g. Manigandan P"
                  value={form.employee_name}
                  onChange={(e) => setForm({ ...form, employee_name: e.target.value })}
                />
              </Field>

              <Field label="Employee Code / ID">
                <input
                  type="text"
                  placeholder="e.g. EMP-1001"
                  value={form.employee_code}
                  onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
                />
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Department">
                <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                  {departments.map((d) => (
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
