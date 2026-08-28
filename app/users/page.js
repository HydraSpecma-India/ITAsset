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
  const [resetting, setResetting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("it_users").select("*").order("created_at");
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setMsg(null);
    const { email, full_name, role, department, pwd } = creating;
    if (!email.trim() || !full_name.trim()) return setMsg({ t: "err", m: "Name and email are required." });
    if (pwd.length < 8) return setMsg({ t: "err", m: "Temporary password must be at least 8 characters." });
    const { error } = await supabase.rpc("it_admin_create_user", {
      p_email: email.trim(), p_full_name: full_name.trim(), p_role: role, p_temp_password: pwd,
    });
    if (error) return setMsg({ t: "err", m: error.message });

    // Update department if specified
    if (department) {
      await supabase.from("it_users").update({ department }).eq("email", email.trim());
    }

    setCreating(null);
    setMsg({ t: "ok", m: `${email} created. Share the temporary password — they must change it at first sign-in.` });
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
    setMsg({ t: "ok", m: "Password reset. The user must set a new one at next sign-in." });
    load();
  }

  async function update(u, patch) {
    const { error } = await supabase.from("it_users").update(patch).eq("id", u.id);
    if (error) setMsg({ t: "err", m: error.message });
    load();
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
      subtitle="Assign global or department-level admin and reader permissions"
      actions={
        <button className="btn sm" onClick={() => setCreating({ email: "", full_name: "", role: "dept_admin", department: "HR", pwd: "" })}>
          + New user
        </button>
      }
    >
      {msg && <div className={`alert ${msg.t}`}>{msg.m}</div>}

      <Card title={`${rows.length} account${rows.length === 1 ? "" : "s"}`}>
        {loading ? <div className="loading">Loading…</div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Department Access</th>
                  <th>Role</th>
                  <th>Password</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.full_name}{u.id === profile?.id && <span className="pill grey" style={{ marginLeft: 8 }}>you</span>}</td>
                    <td style={{ color: "var(--muted)" }}>{u.email}</td>
                    <td>
                      <select
                        value={u.department || "IT"}
                        disabled={u.id === profile?.id}
                        onChange={(e) => update(u, { department: e.target.value })}
                        style={{ width: 140, padding: "5px 8px", fontSize: 12 }}
                      >
                        <option value="All">🌐 All Departments</option>
                        {activeDepts.map((d) => (
                          <option key={d} value={d}>{d} Dept</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={u.id === profile?.id}
                        onChange={(e) => update(u, { role: e.target.value })}
                        style={{ width: 170, padding: "5px 8px", fontSize: 12 }}
                      >
                        <option value="admin">Global Admin (Full Access)</option>
                        <option value="dept_admin">Dept Admin (Full Dept Access)</option>
                        <option value="global_reader">Global Reader (View All)</option>
                        <option value="viewer">Department Reader (View Dept Only)</option>
                        <option value="employee">Employee (My Assets Only)</option>
                      </select>
                    </td>
                    <td>
                      <span className={`pill ${u.must_change_password ? "amber" : "green"}`}>
                        {u.must_change_password ? "Change pending" : "Set"}
                      </span>
                    </td>
                    <td><span className={`pill ${u.is_active ? "green" : "red"}`}>{u.is_active ? "Active" : "Disabled"}</span></td>
                    <td className="mono" style={{ fontSize: 12 }}>{dateStr(u.created_at?.slice(0, 10))}</td>
                    <td>
                      <div className="btn-row">
                        <button className="btn ghost sm" onClick={() => setResetting({ id: u.id, email: u.email, pwd: "" })}>Reset password</button>
                        {u.id !== profile?.id && (
                          <button className="btn ghost sm" onClick={() => update(u, { is_active: !u.is_active })}>
                            {u.is_active ? "Disable" : "Enable"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <Modal title="Create new user account" onClose={() => setCreating(null)}>
          <div className="stack">
            <Field label="Full name *">
              <input value={creating.full_name} onChange={(e) => setCreating({ ...creating, full_name: e.target.value })} placeholder="e.g. John Doe" />
            </Field>
            <Field label="Email *">
              <input type="email" value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} placeholder="e.g. john@hydraspecma.com" />
            </Field>
            <Field label="Department Access">
              <select value={creating.department || "IT"} onChange={(e) => setCreating({ ...creating, department: e.target.value })}>
                <option value="All">🌐 All Departments (Global)</option>
                {activeDepts.map((d) => (
                  <option key={d} value={d}>{d} Department</option>
                ))}
              </select>
            </Field>
            <Field label="Role">
              <select value={creating.role} onChange={(e) => setCreating({ ...creating, role: e.target.value })}>
                <option value="dept_admin">Department Admin — Manage invoices, categories, vendors & budget for department</option>
                <option value="admin">Global Admin — Manage all departments</option>
                <option value="global_reader">Global Reader — Read-only access to all departments</option>
                <option value="viewer">Department Reader — Read-only access to assigned department</option>
                <option value="employee">Employee — Restricted to assigned assets</option>
              </select>
            </Field>
            <Field label="Temporary password *">
              <input value={creating.pwd} onChange={(e) => setCreating({ ...creating, pwd: e.target.value })} placeholder="At least 8 characters" />
            </Field>
            <div className="alert info">The user will be forced to set their own password the first time they sign in.</div>
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
