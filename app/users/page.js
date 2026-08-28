"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Field, Modal } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { dateStr } from "@/lib/format";
import { useDept } from "@/lib/department";

export default function UsersPage() {
  const { profile } = useAuth();
  const { departments: activeDepts } = useDept();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [creating, setCreating] = useState(null);
  const [editingPerms, setEditingPerms] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [savingPerms, setSavingPerms] = useState(false);

  // Bulk Grid Edit Mode State
  const [gridMode, setGridMode] = useState(false);
  const [gridRows, setGridRows] = useState([]);
  const [savingGrid, setSavingGrid] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("it_users").select("*").order("created_at");
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function enableGridMode() {
    setGridRows(rows.map((r) => ({ ...r })));
    setGridMode(true);
  }

  function handleGridChange(id, field, value) {
    setGridRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  async function saveGridChanges() {
    setSavingGrid(true);
    setMsg(null);
    let errCount = 0;
    for (const r of gridRows) {
      const orig = rows.find((o) => o.id === r.id);
      if (!orig) continue;
      if (
        r.full_name !== orig.full_name ||
        r.email !== orig.email ||
        r.department !== orig.department ||
        r.role !== orig.role ||
        r.is_active !== orig.is_active ||
        r.must_change_password !== orig.must_change_password
      ) {
        const { error } = await supabase
          .from("it_users")
          .update({
            full_name: r.full_name.trim(),
            email: r.email.trim().toLowerCase(),
            department: r.department,
            role: r.role,
            is_active: r.is_active,
            must_change_password: r.must_change_password,
          })
          .eq("id", r.id);
        if (error) errCount++;
      }
    }
    setSavingGrid(false);
    if (errCount > 0) {
      setMsg({ t: "err", m: `Bulk save finished with ${errCount} errors.` });
    } else {
      setMsg({ t: "ok", m: "All user changes saved successfully!" });
      setGridMode(false);
      load();
    }
  }

  async function create() {
    setMsg(null);
    const { email, full_name, role, department, dept_permissions, pwd } = creating;
    if (!email.trim() || !full_name.trim()) return setMsg({ t: "err", m: "Name and email are required." });
    if (pwd.length < 8) return setMsg({ t: "err", m: "Temporary password must be at least 8 characters." });

    const { error } = await supabase.rpc("it_admin_create_user", {
      p_email: email.trim(), p_full_name: full_name.trim(), p_role: role, p_temp_password: pwd,
    });
    if (error) return setMsg({ t: "err", m: error.message });

    // Update department and multi-department permissions
    const allowedDepts = Object.keys(dept_permissions || {}).filter((k) => dept_permissions[k] && dept_permissions[k] !== "none");
    await supabase.from("it_users").update({
      department: department || "IT",
      dept_permissions: dept_permissions || {},
      allowed_departments: allowedDepts,
    }).eq("email", email.trim());

    setCreating(null);
    setMsg({ t: "ok", m: `${email} created successfully. Share temporary password with user.` });
    load();
  }

  async function resetPw() {
    setMsg(null);
    if (resetting.pwd.length < 8) return setMsg({ t: "err", m: "Temporary password must be at least 8 characters." });
    const { error } = await supabase.rpc("it_admin_reset_password", {
      p_user_id: resetting.id, p_temp_password: resetting.pwd,
    });
    if (error) return setMsg({ t: "err", m: error.message });
    setResetting(null);
    setMsg({ t: "ok", m: "Password reset successfully." });
    load();
  }

  async function update(u, patch) {
    const { error } = await supabase.from("it_users").update(patch).eq("id", u.id);
    if (error) setMsg({ t: "err", m: error.message });
    load();
  }

  function openPermsModal(u) {
    setEditingPerms({
      ...u,
      role: u.role || "dept_admin",
      department: u.department || "IT",
      dept_permissions: u.dept_permissions || {},
    });
  }

  async function savePermsModal() {
    if (!editingPerms) return;
    setSavingPerms(true);
    setMsg(null);

    const perms = editingPerms.dept_permissions || {};
    const allowedDepts = Object.keys(perms).filter((k) => perms[k] && perms[k] !== "none");

    const { error } = await supabase.from("it_users").update({
      role: editingPerms.role,
      department: editingPerms.department,
      dept_permissions: perms,
      allowed_departments: allowedDepts,
    }).eq("id", editingPerms.id);

    setSavingPerms(false);

    if (error) {
      setMsg({ t: "err", m: "Failed to save permissions: " + error.message });
    } else {
      setEditingPerms(null);
      setMsg({ t: "ok", m: `Permissions updated for ${editingPerms.email}` });
      load();
    }
  }

  const isGlobalAdmin = profile?.role === "admin" && (profile?.department === "All" || !profile?.department || profile?.department === "IT");

  if (!isGlobalAdmin) {
    return (
      <Shell title="Access Denied" subtitle="User Management is restricted to Global Administrators only">
        <Card title="🔒 Restricted Access">
          <div style={{ padding: "20px 10px", color: "var(--muted)" }}>
            Access Denied. Only Global Administrators can view or manage user accounts and department permissions.
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell
      title="Users & Department Access"
      subtitle="Configure primary department roles and granular cross-department permissions"
      actions={
        <div className="btn-row">
          {gridMode ? (
            <>
              <button className="btn ghost sm" onClick={() => setGridMode(false)}>
                ✕ Cancel Grid Edit
              </button>
              <button className="btn sm" onClick={saveGridChanges} disabled={savingGrid}>
                {savingGrid ? "💾 Saving All…" : "💾 Save All Changes"}
              </button>
            </>
          ) : (
            <>
              <button className="btn ghost sm" onClick={enableGridMode} title="Edit multiple users at once in Excel-like grid">
                ✏️ Bulk Edit Grid
              </button>
              <button
                className="btn sm"
                onClick={() => setCreating({
                  email: "",
                  full_name: "",
                  role: "dept_admin",
                  department: "IT",
                  pwd: "",
                  dept_permissions: {},
                })}
              >
                + New user
              </button>
            </>
          )}
        </div>
      }
    >
      {msg && <div className={`alert ${msg.t}`}>{msg.m}</div>}

      <Card
        title={gridMode ? "✏️ Bulk Edit Grid Mode (Editing all users)" : `${rows.length} account${rows.length === 1 ? "" : "s"}`}
        hint={gridMode ? "Edit user fields in grid cells and click 'Save All Changes' when finished" : "Click 'Bulk Edit Grid' to edit multiple users simultaneously"}
      >
        {loading ? <div className="loading">Loading…</div> : gridMode ? (
          /* Bulk Edit Grid View */
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Primary Department</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Password Reset</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {gridRows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="text"
                        value={r.full_name}
                        onChange={(e) => handleGridChange(r.id, "full_name", e.target.value)}
                        style={{ padding: "4px 8px", fontSize: 12, width: 160 }}
                      />
                    </td>
                    <td>
                      <input
                        type="email"
                        value={r.email}
                        onChange={(e) => handleGridChange(r.id, "email", e.target.value)}
                        style={{ padding: "4px 8px", fontSize: 12, width: 190 }}
                      />
                    </td>
                    <td>
                      <select
                        value={r.department || "IT"}
                        onChange={(e) => handleGridChange(r.id, "department", e.target.value)}
                        style={{ padding: "4px 8px", fontSize: 12, width: 140 }}
                      >
                        <option value="All">🌐 All Departments</option>
                        {activeDepts.map((d) => (
                          <option key={d} value={d}>{d} Dept</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={r.role}
                        onChange={(e) => handleGridChange(r.id, "role", e.target.value)}
                        style={{ padding: "4px 8px", fontSize: 12, width: 170 }}
                      >
                        <option value="admin">Global Admin (Full Access)</option>
                        <option value="dept_admin">Dept Admin (Full Access)</option>
                        <option value="global_reader">Global Reader (View All)</option>
                        <option value="viewer">Dept Reader (View Only)</option>
                        <option value="employee">Employee (My Assets Only)</option>
                      </select>
                    </td>
                    <td>
                      <select
                        value={r.is_active ? "true" : "false"}
                        onChange={(e) => handleGridChange(r.id, "is_active", e.target.value === "true")}
                        style={{ padding: "4px 8px", fontSize: 12, width: 100 }}
                      >
                        <option value="true">✓ Active</option>
                        <option value="false">✕ Disabled</option>
                      </select>
                    </td>
                    <td>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!r.must_change_password}
                          onChange={(e) => handleGridChange(r.id, "must_change_password", e.target.checked)}
                        />
                        <span>Require Change</span>
                      </label>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn ghost sm" onClick={() => openPermsModal(r)} title="Configure Cross-Department Access">
                        🔑 Perms
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Normal View */
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name & Email</th>
                  <th>Primary Role</th>
                  <th>Primary Dept</th>
                  <th>Cross-Department Access</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const perms = u.dept_permissions || {};
                  const permKeys = Object.keys(perms).filter((k) => perms[k] && perms[k] !== "none");

                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.full_name}{u.id === profile?.id && <span className="pill grey" style={{ marginLeft: 8 }}>you</span>}</div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{u.email}</div>
                      </td>
                      <td>
                        <span className={`pill ${u.role === "admin" ? "gold" : u.role === "global_reader" ? "amber" : "blue"}`}>
                          {u.role === "admin" ? "Global Admin" : u.role === "dept_admin" ? "Dept Admin" : u.role === "global_reader" ? "Global Reader" : u.role === "viewer" ? "Dept Reader" : "Employee"}
                        </span>
                      </td>
                      <td>
                        <span className="pill gold mono" style={{ fontSize: 11 }}>
                          {u.department || "IT"}
                        </span>
                      </td>
                      <td>
                        {u.role === "admin" || u.role === "global_reader" ? (
                          <span className="pill gold" style={{ fontSize: 11 }}>🌐 Full Global Access</span>
                        ) : permKeys.length === 0 ? (
                          <span style={{ color: "var(--faint)", fontSize: 12 }}>Primary Dept Only</span>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {permKeys.map((deptName) => {
                              const level = perms[deptName];
                              return (
                                <span
                                  key={deptName}
                                  className={`pill ${level === "admin" ? "gold" : "blue"}`}
                                  style={{ fontSize: 10 }}
                                  title={`${deptName}: ${level === "admin" ? "Full Access (Dept Admin)" : "View Only (Reader)"}`}
                                >
                                  {deptName}: {level === "admin" ? "✏️ Admin" : "👁️ View"}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`pill ${u.is_active ? "green" : "red"}`}>
                          {u.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                          <button className="btn ghost sm" onClick={() => openPermsModal(u)} title="Configure Cross-Department Access & Roles">
                            🔑 Permissions
                          </button>
                          <button className="btn ghost sm" onClick={() => setResetting({ id: u.id, email: u.email, pwd: "" })}>
                            Reset PW
                          </button>
                          {u.id !== profile?.id && (
                            <button className="btn ghost sm" onClick={() => update(u, { is_active: !u.is_active })}>
                              {u.is_active ? "Disable" : "Enable"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal for Managing User Permissions & Cross-Department Access */}
      {editingPerms && (
        <Modal title={`🔑 Permissions & Access — ${editingPerms.email}`} onClose={() => setEditingPerms(null)}>
          <div className="stack">
            <Field label="Primary Role">
              <select
                value={editingPerms.role}
                onChange={(e) => setEditingPerms({ ...editingPerms, role: e.target.value })}
              >
                <option value="admin">Global Admin — Full Access across all departments</option>
                <option value="global_reader">Global Reader — View Only across all departments</option>
                <option value="dept_admin">Department Admin — Full Access to Primary & assigned departments</option>
                <option value="viewer">Department Reader — View Only access</option>
                <option value="employee">Employee — Assigned assets only</option>
              </select>
            </Field>

            <Field label="Primary / Own Department">
              <select
                value={editingPerms.department || "IT"}
                onChange={(e) => setEditingPerms({ ...editingPerms, department: e.target.value })}
              >
                <option value="All">🌐 All Departments (Global)</option>
                {activeDepts.map((d) => (
                  <option key={d} value={d}>{d} Department</option>
                ))}
              </select>
            </Field>

            {editingPerms.role !== "admin" && editingPerms.role !== "global_reader" && (
              <div style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: 14, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: "var(--gold)" }}>
                  🌐 Cross-Department Access Matrix
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                  Set specific permissions for other departments (e.g. Production = Full Admin, Operations = View Only)
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {activeDepts.map((dName) => {
                    const currentLevel = editingPerms.dept_permissions?.[dName] || "none";
                    return (
                      <div
                        key={dName}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 10px",
                          background: "rgba(255,255,255,0.03)",
                          borderRadius: 6,
                          border: "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{dName} Department</span>
                        <select
                          value={currentLevel}
                          onChange={(e) => {
                            const updated = { ...(editingPerms.dept_permissions || {}) };
                            if (e.target.value === "none") {
                              delete updated[dName];
                            } else {
                              updated[dName] = e.target.value;
                            }
                            setEditingPerms({ ...editingPerms, dept_permissions: updated });
                          }}
                          style={{ padding: "3px 8px", fontSize: 12, width: 180 }}
                        >
                          <option value="none">⛔ No Access</option>
                          <option value="viewer">👁️ View Only (Reader)</option>
                          <option value="admin">✏️ Full Access (Dept Admin)</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="btn-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn ghost" onClick={() => setEditingPerms(null)}>Cancel</button>
              <button className="btn" onClick={savePermsModal} disabled={savingPerms}>
                {savingPerms ? "Saving…" : "💾 Save Access Permissions"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal for Creating New User */}
      {creating && (
        <Modal title="Create new user account" onClose={() => setCreating(null)}>
          <div className="stack">
            <Field label="Full name *">
              <input value={creating.full_name} onChange={(e) => setCreating({ ...creating, full_name: e.target.value })} placeholder="e.g. John Doe" />
            </Field>
            <Field label="Email *">
              <input type="email" value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} placeholder="e.g. john@hydraspecma.com" />
            </Field>
            <Field label="Primary Role">
              <select value={creating.role} onChange={(e) => setCreating({ ...creating, role: e.target.value })}>
                <option value="dept_admin">Department Admin — Manage invoices, assets & budget for assigned departments</option>
                <option value="admin">Global Admin — Full Access across all departments</option>
                <option value="global_reader">Global Reader — View Only across all departments</option>
                <option value="viewer">Department Reader — View Only access</option>
                <option value="employee">Employee — Assigned assets only</option>
              </select>
            </Field>

            <Field label="Primary Department">
              <select value={creating.department || "IT"} onChange={(e) => setCreating({ ...creating, department: e.target.value })}>
                <option value="All">🌐 All Departments (Global)</option>
                {activeDepts.map((d) => (
                  <option key={d} value={d}>{d} Department</option>
                ))}
              </select>
            </Field>

            {creating.role !== "admin" && creating.role !== "global_reader" && (
              <div style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: "var(--gold)", marginBottom: 8 }}>
                  🌐 Cross-Department Access Matrix (Optional)
                </div>
                <div style={{ display: "grid", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                  {activeDepts.map((dName) => {
                    const currentLevel = creating.dept_permissions?.[dName] || "none";
                    return (
                      <div key={dName} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
                        <span>{dName} Dept</span>
                        <select
                          value={currentLevel}
                          onChange={(e) => {
                            const updated = { ...(creating.dept_permissions || {}) };
                            if (e.target.value === "none") {
                              delete updated[dName];
                            } else {
                              updated[dName] = e.target.value;
                            }
                            setCreating({ ...creating, dept_permissions: updated });
                          }}
                          style={{ padding: "2px 6px", fontSize: 11, width: 160 }}
                        >
                          <option value="none">⛔ No Access</option>
                          <option value="viewer">👁️ View Only</option>
                          <option value="admin">✏️ Full Access</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <Field label="Temporary password *">
              <input value={creating.pwd} onChange={(e) => setCreating({ ...creating, pwd: e.target.value })} placeholder="At least 8 characters" />
            </Field>
            <div className="btn-row" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setCreating(null)}>Cancel</button>
              <button className="btn" onClick={create}>Create user</button>
            </div>
          </div>
        </Modal>
      )}

      {resetting && (
        <Modal title={`Reset password — ${resetting.email}`} onClose={() => setResetting(null)}>
          <div className="stack">
            <Field label="New temporary password *">
              <input value={resetting.pwd} onChange={(e) => setResetting({ ...resetting, pwd: e.target.value })} placeholder="At least 8 characters" />
            </Field>
            <div className="alert info">They will be asked to choose a new password at their next sign-in.</div>
            <div className="btn-row" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setResetting(null)}>Cancel</button>
              <button className="btn" onClick={resetPw}>Reset password</button>
            </div>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
