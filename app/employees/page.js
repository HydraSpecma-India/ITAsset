"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Field, Modal, Empty, Kpi } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";

export default function EmployeesPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [tab, setTab] = useState("employees"); // "employees" | "departments"
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");

  const [empModalOpen, setEmpModalOpen] = useState(false);
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [editingDept, setEditingDept] = useState(null);

  const [empForm, setEmpForm] = useState({
    full_name: "", email: "", department: "", job_title: "", company_name: "HydraSpecma India Pvt. Ltd.", location: "Chennai", is_active: true
  });
  const [deptForm, setDeptForm] = useState({ name: "", is_active: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [eRes, dRes] = await Promise.all([
      supabase.from("it_employees").select("*").order("full_name"),
      supabase.from("it_departments").select("*").order("name"),
    ]);
    setEmployees(eRes.data || []);
    setDepartments(dRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredEmployees = useMemo(() => {
    const s = q.trim().toLowerCase();
    return employees.filter((e) => {
      if (deptFilter !== "all" && (e.department || "").toLowerCase() !== deptFilter.toLowerCase()) return false;
      if (!s) return true;
      return [e.full_name, e.email, e.department, e.job_title, e.company_name]
        .filter(Boolean).join(" ").toLowerCase().includes(s);
    });
  }, [employees, q, deptFilter]);

  function openNewEmp() {
    setEditingEmp(null);
    setEmpForm({
      full_name: "", email: "", department: departments[0]?.name || "Operations", job_title: "", company_name: "HydraSpecma India Pvt. Ltd.", location: "Chennai", is_active: true
    });
    setEmpModalOpen(true);
  }

  function openEditEmp(e) {
    setEditingEmp(e);
    setEmpForm({
      full_name: e.full_name || "",
      email: e.email || "",
      department: e.department || "",
      job_title: e.job_title || "",
      company_name: e.company_name || "HydraSpecma India Pvt. Ltd.",
      location: e.location || "Chennai",
      is_active: e.is_active !== false,
    });
    setEmpModalOpen(true);
  }

  async function saveEmp() {
    if (!empForm.full_name.trim()) return alert("Employee full name is required.");
    setBusy(true);
    setErr("");
    try {
      if (editingEmp) {
        const { error } = await supabase.from("it_employees").update(empForm).eq("id", editingEmp.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("it_employees").insert([empForm]);
        if (error) throw error;
      }
      setEmpModalOpen(false);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEmp(e) {
    if (!confirm(`Delete employee ${e.full_name}?`)) return;
    await supabase.from("it_employees").delete().eq("id", e.id);
    load();
  }

  function openNewDept() {
    setEditingDept(null);
    setDeptForm({ name: "", is_active: true });
    setDeptModalOpen(true);
  }

  async function saveDept() {
    if (!deptForm.name.trim()) return alert("Department name is required.");
    setBusy(true);
    setErr("");
    try {
      if (editingDept) {
        const { error } = await supabase.from("it_departments").update(deptForm).eq("id", editingDept.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("it_departments").insert([deptForm]);
        if (error) throw error;
      }
      setDeptModalOpen(false);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Employees & Departments"
      subtitle="Manage organization staff members and department choices for asset assignment"
      actions={
        <div style={{ display: "flex", gap: 10 }}>
          {isAdmin && (
            <>
              <button className="btn ghost sm" onClick={openNewDept}>+ New Department</button>
              <button className="btn sm" onClick={openNewEmp}>+ New Employee</button>
            </>
          )}
        </div>
      }
    >
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi label="Total Employees" value={employees.length} foot={`${employees.filter((e) => e.is_active).length} active`} tone="gold" />
        <Kpi label="Departments" value={departments.length} foot={`${departments.filter((d) => d.is_active).length} active`} />
        <Kpi label="Assigned Depts" value={new Set(employees.map((e) => e.department).filter(Boolean)).size} foot="Active staff departments" />
        <Kpi label="Company" value="HydraSpecma" foot="India Operations" />
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, borderBottom: "1px solid var(--hs-charcoal)", paddingBottom: 10 }}>
        <button
          className={`btn ${tab === "employees" ? "gold" : "ghost"}`}
          onClick={() => setTab("employees")}
          style={{ fontSize: 13.5 }}
        >
          👥 Employees ({employees.length})
        </button>
        <button
          className={`btn ${tab === "departments" ? "gold" : "ghost"}`}
          onClick={() => setTab("departments")}
          style={{ fontSize: 13.5 }}
        >
          🏢 Departments ({departments.length})
        </button>
      </div>

      {tab === "employees" && (
        <>
          <div className="toolbar">
            <div className="field" style={{ minWidth: 260, flex: 1 }}>
              <span className="field-label">Search Staff</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, title, department…" />
            </div>
            <div className="field">
              <span className="field-label">Department</span>
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>

          <Card title={`${filteredEmployees.length} Employee${filteredEmployees.length === 1 ? "" : "s"}`}>
            {loading ? <div className="loading">Loading…</div> : filteredEmployees.length === 0 ? (
              <Empty>No employees found.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Full Name</th>
                      <th>Department</th>
                      <th>Job Title</th>
                      <th>Email</th>
                      <th>Location</th>
                      <th>Status</th>
                      {isAdmin && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((e) => (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{e.full_name}</td>
                        <td><span className="pill gold">{e.department || "—"}</span></td>
                        <td style={{ color: "var(--muted)" }}>{e.job_title || "—"}</td>
                        <td className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{e.email || "—"}</td>
                        <td style={{ color: "var(--muted)" }}>{e.location || "—"}</td>
                        <td>
                          <span className={`pill ${e.is_active ? "green" : "red"}`}>
                            {e.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        {isAdmin && (
                          <td>
                            <div className="btn-row">
                              <button className="btn ghost sm" onClick={() => openEditEmp(e)}>Edit</button>
                              <button className="btn danger sm" onClick={() => deleteEmp(e)}>Del</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === "departments" && (
        <Card title={`${departments.length} Department${departments.length === 1 ? "" : "s"}`}>
          {loading ? <div className="loading">Loading…</div> : departments.length === 0 ? (
            <Empty>No departments configured.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Department Name</th>
                    <th>Employee Count</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) => {
                    const empCount = employees.filter((e) => (e.department || "").toLowerCase() === d.name.toLowerCase()).length;
                    return (
                      <tr key={d.id}>
                        <td style={{ fontWeight: 600 }}>{d.name}</td>
                        <td className="mono">{empCount} staff</td>
                        <td>
                          <span className={`pill ${d.is_active ? "green" : "red"}`}>
                            {d.is_active ? "Active" : "Inactive"}
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
      )}

      {empModalOpen && (
        <Modal title={editingEmp ? "Edit Employee" : "New Employee"} onClose={() => setEmpModalOpen(false)}>
          {err && <div className="alert err">{err}</div>}
          <div className="grid g2" style={{ gap: 12 }}>
            <Field label="Full Name *">
              <input value={empForm.full_name} onChange={(e) => setEmpForm({ ...empForm, full_name: e.target.value })} placeholder="John Doe" />
            </Field>
            <Field label="Email">
              <input value={empForm.email} onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })} placeholder="john.doe@hydraspecma.com" />
            </Field>
            <Field label="Department *">
              <select value={empForm.department} onChange={(e) => setEmpForm({ ...empForm, department: e.target.value })}>
                {departments.map((d) => (
                  <option key={d.id} value={d.name}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Job Title">
              <input value={empForm.job_title} onChange={(e) => setEmpForm({ ...empForm, job_title: e.target.value })} placeholder="Engineer / Specialist" />
            </Field>
            <Field label="Company Name">
              <input value={empForm.company_name} onChange={(e) => setEmpForm({ ...empForm, company_name: e.target.value })} />
            </Field>
            <Field label="Location">
              <input value={empForm.location} onChange={(e) => setEmpForm({ ...empForm, location: e.target.value })} />
            </Field>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
            <button className="btn ghost" onClick={() => setEmpModalOpen(false)}>Cancel</button>
            <button className="btn" onClick={saveEmp} disabled={busy}>{busy ? "Saving…" : "Save Employee"}</button>
          </div>
        </Modal>
      )}

      {deptModalOpen && (
        <Modal title="New Department" onClose={() => setDeptModalOpen(false)}>
          {err && <div className="alert err">{err}</div>}
          <Field label="Department Name *">
            <input value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} placeholder="e.g. Research & Development" />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
            <button className="btn ghost" onClick={() => setDeptModalOpen(false)}>Cancel</button>
            <button className="btn" onClick={saveDept} disabled={busy}>{busy ? "Saving…" : "Save Department"}</button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
