"use client";

import { useState, useEffect, useCallback } from "react";
import Shell from "@/components/Shell";
import { Card, Empty, Kpi } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { useDept } from "@/lib/department";

export default function DepartmentsPage() {
  const { profile } = useAuth();
  const { refreshDepartments } = useDept();
  
  const isGlobalAdmin =
    profile?.role === "admin" &&
    (!profile?.department || profile?.department === "All" || profile?.department === "IT");

  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editDept, setEditDept] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    description: "",
    sort_order: 10,
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const loadDepartments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("it_budget_departments")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        setMsg({ type: "danger", text: "Error loading budget departments: " + error.message });
      } else {
        setDepartments(data || []);
      }
    } catch (err) {
      setMsg({ type: "danger", text: "Error loading budget departments." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isGlobalAdmin) {
      loadDepartments();
    }
  }, [isGlobalAdmin, loadDepartments]);

  function openCreateModal() {
    setEditDept(null);
    setFormData({
      name: "",
      code: "",
      description: "",
      sort_order: (departments.length + 1) * 10,
      is_active: true,
    });
    setMsg(null);
    setModalOpen(true);
  }

  function openEditModal(d) {
    setEditDept(d);
    setFormData({
      name: d.name || "",
      code: d.code || "",
      description: d.description || "",
      sort_order: d.sort_order || 10,
      is_active: d.is_active !== false,
    });
    setMsg(null);
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!formData.name.trim()) {
      setMsg({ type: "danger", text: "Budget Department Name is required." });
      return;
    }

    setSaving(true);
    setMsg(null);

    const payload = {
      name: formData.name.trim(),
      code: formData.code.trim().toUpperCase() || formData.name.trim().slice(0, 5).toUpperCase(),
      description: formData.description.trim() || null,
      sort_order: Number(formData.sort_order || 10),
      is_active: !!formData.is_active,
    };

    let res;
    if (editDept?.id) {
      res = await supabase
        .from("it_budget_departments")
        .update(payload)
        .eq("id", editDept.id);
    } else {
      res = await supabase.from("it_budget_departments").insert(payload);
    }

    setSaving(false);

    if (res.error) {
      setMsg({ type: "danger", text: "Failed to save budget department: " + res.error.message });
    } else {
      setModalOpen(false);
      loadDepartments();
      if (refreshDepartments) refreshDepartments();
    }
  }

  async function toggleStatus(deptRow) {
    const nextStatus = !deptRow.is_active;
    const { error } = await supabase
      .from("it_budget_departments")
      .update({ is_active: nextStatus })
      .eq("id", deptRow.id);

    if (error) {
      alert("Failed to update status: " + error.message);
    } else {
      loadDepartments();
      if (refreshDepartments) refreshDepartments();
    }
  }

  async function handleDelete(deptRow) {
    if (!confirm(`Are you sure you want to delete the "${deptRow.name}" budget department?`)) return;

    const { error } = await supabase
      .from("it_budget_departments")
      .delete()
      .eq("id", deptRow.id);

    if (error) {
      alert("Cannot delete department linked to existing records: " + error.message);
    } else {
      loadDepartments();
      if (refreshDepartments) refreshDepartments();
    }
  }

  if (!isGlobalAdmin) {
    return (
      <Shell title="Departments Management" subtitle="Company Department Setup">
        <Card>
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⛔</div>
            <h3 style={{ margin: "0 0 8px 0" }}>Access Restricted</h3>
            <p style={{ color: "var(--muted)", maxWidth: 450, margin: "0 auto" }}>
              Department Management is reserved exclusively for Global Administrators. Please contact your Global Admin to modify company departments.
            </p>
          </div>
        </Card>
      </Shell>
    );
  }

  const activeCount = departments.filter((d) => d.is_active).length;
  const inactiveCount = departments.length - activeCount;

  return (
    <Shell
      title="Budget Departments Management"
      subtitle="Manage active budget departments used across invoices, assets, budgets, versions, and department switching"
      actions={
        <button className="btn sm" onClick={openCreateModal}>
          + New Budget Department
        </button>
      }
    >
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Kpi label="Total Budget Depts" value={departments.length} foot="Budget Departments" />
        <Kpi label="Active Departments" value={activeCount} tone="gold" foot="Available in Dept Switcher" />
        <Kpi label="Inactive / Archived" value={inactiveCount} foot="Disabled departments" />
      </div>

      <Card title="Budget Departments Master List" hint="Only Global Admins can manage budget departments">
        {loading ? (
          <div className="loading">Loading departments…</div>
        ) : departments.length === 0 ? (
          <Empty>No departments configured. Click '+ New Department' to create one.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Department Name</th>
                  <th>Code</th>
                  <th>Description</th>
                  <th className="num">Sort Order</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</div>
                    </td>
                    <td>
                      <span className="pill gold mono" style={{ fontSize: 11 }}>
                        {d.code || d.name.slice(0, 4).toUpperCase()}
                      </span>
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {d.description || "—"}
                    </td>
                    <td className="num mono">{d.sort_order || 10}</td>
                    <td>
                      <span
                        className={`pill ${d.is_active ? "gold" : "grey"}`}
                        onClick={() => toggleStatus(d)}
                        style={{ cursor: "pointer" }}
                        title="Click to toggle Active / Inactive"
                      >
                        {d.is_active ? "✓ Active" : "✕ Disabled"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn ghost sm" onClick={() => openEditModal(d)}>
                          ✏️ Edit
                        </button>
                        <button
                          className="btn ghost sm"
                          onClick={() => handleDelete(d)}
                          style={{ color: "var(--danger)", borderColor: "rgba(255,85,85,0.3)" }}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modalOpen && (
        <div className="modal-back" onClick={() => setModalOpen(false)}>
          <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
            <div className="card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>
                {editDept ? "✏️ Edit Budget Department" : "➕ Create New Budget Department"}
              </h3>
              <button className="btn ghost sm" onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <div className="card-body">
              {msg && (
                <div className={`alert ${msg.type}`} style={{ marginBottom: 12 }}>
                  {msg.text}
                </div>
              )}

              <form onSubmit={handleSave}>
                <div className="grid g2" style={{ marginBottom: 12 }}>
                  <div className="field">
                    <label className="field-label">Department Name *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Finance"
                      required
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">Code (Short) *</label>
                    <input
                      type="text"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      placeholder="e.g. FINN"
                      required
                    />
                  </div>
                </div>

                <div className="field" style={{ marginBottom: 12 }}>
                  <label className="field-label">Description</label>
                  <textarea
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="e.g. Finance & Accounting Budget"
                  />
                </div>

                <div className="grid g2" style={{ marginBottom: 16, alignItems: "center" }}>
                  <div className="field">
                    <label className="field-label">Sort Order</label>
                    <input
                      type="number"
                      value={formData.sort_order}
                      onChange={(e) => setFormData({ ...formData, sort_order: Number(e.target.value) })}
                    />
                  </div>
                  <div className="field" style={{ paddingTop: 18 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      />
                      <span style={{ fontWeight: 600, fontSize: 13 }}>Active Department</span>
                    </label>
                  </div>
                </div>

                <div className="modal-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
                  <button type="button" className="btn ghost sm" onClick={() => setModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn sm" disabled={saving}>
                    {saving ? "Saving…" : "💾 Save Department"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
