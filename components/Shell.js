"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/session";
import { useDept } from "@/lib/department";

const NAV = [
  { group: "Overview", items: [
    { href: "/dashboard", label: "Dashboard", ico: "◈", hideForEmployee: true },
    { href: "/budgets", label: "Budget vs Actual", ico: "▤", hideForEmployee: true },
    { href: "/expiry", label: "Expiry & Renewals", ico: "⏱", hideForEmployee: true },
    { href: "/planning", label: "Next Year Budget", ico: "◇", hideForEmployee: true },
  ]},
  { group: "Records", items: [
    { href: "/invoices", label: "Invoices", ico: "▦", hideForEmployee: true },
    { href: "/assets", label: "Asset Register", ico: "▧" },
    { href: "/employees", label: "Employees & Depts", ico: "👥", globalAdminOnly: true },
  ]},
  { group: "Setup", items: [
    { href: "/masters", label: "Categories & Vendors", ico: "⚙", hideForEmployee: true },
    { href: "/users", label: "Users", ico: "◉", globalAdminOnly: true },
  ]},
];

export default function Shell({ title, subtitle, actions, children }) {
  const { user, profile, loading, signOut } = useAuth();
  const { dept, setDept, availableDepts, refreshDepartments } = useDept();
  const router = useRouter();
  const pathname = usePathname();
  const [theme, setTheme] = useState("dark");
  const [mobileOpen, setMobileOpen] = useState(false);

  const [manageDeptsModalOpen, setManageDeptsModalOpen] = useState(false);
  const [deptListRows, setDeptListRows] = useState([]);
  const [deptLoading, setDeptLoading] = useState(false);
  const [newDeptForm, setNewDeptForm] = useState({ name: "", code: "", description: "" });
  const [editingDeptId, setEditingDeptId] = useState(null);
  const [editingDeptForm, setEditingDeptForm] = useState({});
  const [deptModalMsg, setDeptModalMsg] = useState(null);

  const loadDeptRows = useCallback(async () => {
    setDeptLoading(true);
    const { data } = await supabase
      .from("it_budget_departments")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setDeptListRows(data || []);
    setDeptLoading(false);
  }, []);

  useEffect(() => {
    if (manageDeptsModalOpen) {
      loadDeptRows();
    }
  }, [manageDeptsModalOpen, loadDeptRows]);

  async function handleAddDept(e) {
    e.preventDefault();
    if (!newDeptForm.name.trim()) return;
    setDeptModalMsg(null);

    const payload = {
      name: newDeptForm.name.trim(),
      code: newDeptForm.code.trim().toUpperCase() || newDeptForm.name.trim().slice(0, 5).toUpperCase(),
      description: newDeptForm.description.trim() || null,
      sort_order: (deptListRows.length + 1) * 10,
      is_active: true,
    };

    const { error } = await supabase.from("it_budget_departments").insert(payload);
    if (error) {
      setDeptModalMsg({ type: "danger", text: error.message });
    } else {
      setNewDeptForm({ name: "", code: "", description: "" });
      setDeptModalMsg({ type: "success", text: `Budget Department "${payload.name}" created!` });
      loadDeptRows();
      if (refreshDepartments) refreshDepartments();
    }
  }

  async function handleSaveEditedDept(d) {
    setDeptModalMsg(null);
    const { error } = await supabase
      .from("it_budget_departments")
      .update({
        name: editingDeptForm.name.trim(),
        code: editingDeptForm.code.trim().toUpperCase(),
        description: editingDeptForm.description ? editingDeptForm.description.trim() : null,
      })
      .eq("id", d.id);

    if (error) {
      setDeptModalMsg({ type: "danger", text: error.message });
    } else {
      setEditingDeptId(null);
      loadDeptRows();
      if (refreshDepartments) refreshDepartments();
    }
  }

  async function handleToggleDeptStatus(d) {
    setDeptModalMsg(null);
    const nextStatus = !d.is_active;
    const { error } = await supabase
      .from("it_budget_departments")
      .update({ is_active: nextStatus })
      .eq("id", d.id);

    if (error) {
      setDeptModalMsg({ type: "danger", text: error.message });
    } else {
      loadDeptRows();
      if (refreshDepartments) refreshDepartments();
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem("itbm_theme") || "dark";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("itbm_theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user && !profile) signOut();
    else if (profile && profile.must_change_password) router.replace("/change-password");
    else if (profile && profile.is_active === false) signOut();
    else if (profile && profile.role === "employee" && pathname !== "/assets") {
      router.replace("/assets");
    }
  }, [loading, user, profile, router, signOut, pathname]);

  if (loading || !user || !profile || profile.must_change_password) {
    return <div className="loading">Loading…</div>;
  }

  const isGlobalAdmin = profile.role === "admin" && (profile.department === "All" || !profile.department || profile.department === "IT");
  const isAdmin = profile.role === "admin" || profile.role === "dept_admin";
  const isGlobalReader = profile.role === "global_reader" || profile.role === "viewer";
  const isEmployee = profile.role === "employee";
  const initials = (profile.full_name || profile.email || "?")
    .split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const deptLabel = profile.department && profile.department !== "All" ? `${profile.department}` : "";
  const roleBadgeText = isAdmin
    ? (isGlobalAdmin ? "Global Admin" : `${deptLabel || "Dept"} Admin`)
    : isGlobalReader
    ? "Global Reader"
    : isEmployee
    ? "Employee"
    : (deptLabel ? `${deptLabel} Reader` : "Reader");

  return (
    <div className="shell">
      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">HS</div>
          <div>
            <div className="brand-name">BUDGET MONITOR</div>
            <div className="brand-sub">HydraSpecma</div>
          </div>
          <button className="btn ghost sm mobile-menu-toggle" onClick={() => setMobileOpen(false)} style={{ marginLeft: "auto" }}>
            ✕
          </button>
        </div>

        {NAV.map((g) => {
          const items = g.items.filter((i) => {
            if (i.globalAdminOnly && !isGlobalAdmin) return false;
            if (i.adminOnly && !isAdmin) return false;
            if (i.hideForEmployee && isEmployee) return false;
            return true;
          });
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <div className="nav-label">{g.group}</div>
              {items.map((i) => {
                const labelText = isEmployee && i.href === "/assets" ? "My Assets" : i.label;
                return (
                  <Link key={i.href} href={i.href} className={`nav-item ${pathname === i.href ? "active" : ""}`}>
                    <span className="nav-ico">{i.ico}</span>
                    {labelText}
                  </Link>
                );
              })}
            </div>
          );
        })}

        <div style={{ flex: 1 }} />
        <Link href="/change-password" className="nav-item" style={{ width: "100%", marginBottom: 4 }}>
          <span className="nav-ico">🔑</span> Change Password
        </Link>
        <button className="nav-item" onClick={signOut} style={{ width: "100%" }}>
          <span className="nav-ico">⏻</span> Sign out
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn ghost sm mobile-menu-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle Menu">
              {mobileOpen ? "✕" : "☰"}
            </button>
            <div>
              <h1>{title}</h1>
              {subtitle && <div className="sub">{subtitle}</div>}
            </div>
          </div>
          <div className="topbar-right">
            {actions}

            {/* Department Selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.03)", padding: "3px 8px", borderRadius: 8, border: "1px solid var(--line-soft)" }}>
              <span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 600 }}>🏢 Dept:</span>
              <select
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                style={{
                  padding: "3px 6px",
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 6,
                  background: "var(--gold-dim)",
                  color: "var(--gold)",
                  border: "1px solid var(--gold)",
                  cursor: "pointer",
                }}
              >
                {availableDepts.map((d) => (
                  <option key={d} value={d}>{d === "All" ? "🌐 All Departments" : `${d}`}</option>
                ))}
              </select>

              {isGlobalAdmin && (
                <button
                  className="btn ghost sm"
                  onClick={() => setManageDeptsModalOpen(true)}
                  style={{ padding: "2px 8px", fontSize: 11, color: "var(--gold)", borderColor: "var(--gold)", fontWeight: 700 }}
                  title="Manage Budget Departments Pop-up"
                >
                  ⚙️ Manage Depts
                </button>
              )}
            </div>

            <button className="btn ghost sm" onClick={toggleTheme} title="Toggle Dark/Light Mode" style={{ borderRadius: 20, padding: "4px 12px" }}>
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
            <Link href="/change-password" className="btn ghost sm" style={{ borderRadius: 20, padding: "4px 12px", fontSize: 12 }} title="Change My Password">
              🔑 Password
            </Link>
            <span className={`pill ${isAdmin ? "gold" : isGlobalReader ? "amber" : "blue"}`}>
              {roleBadgeText}
            </span>
            <div className="avatar" title={profile.email}>{initials}</div>
          </div>
        </header>
        <div className="page">{children}</div>
      </div>

      {/* Pop-up Modal for Managing Budget Departments */}
      {manageDeptsModalOpen && (
        <div className="modal-backdrop" onClick={() => setManageDeptsModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                <span>🏢 Manage Budget Departments</span>
              </h3>
              <button className="btn ghost sm" onClick={() => setManageDeptsModalOpen(false)}>✕</button>
            </div>

            {deptModalMsg && (
              <div className={`alert ${deptModalMsg.type === "success" ? "success" : "danger"}`} style={{ marginTop: 10, marginBottom: 10 }}>
                {deptModalMsg.text}
              </div>
            )}

            {/* Form to Add New Budget Department */}
            <form onSubmit={handleAddDept} style={{ background: "rgba(255,204,0,0.06)", border: "1px solid var(--gold-dim)", borderRadius: 8, padding: 12, marginTop: 12, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: "var(--gold)", marginBottom: 8 }}>
                ➕ Add New Budget Department
              </div>
              <div className="grid g3" style={{ gap: 8, marginBottom: 8 }}>
                <input
                  type="text"
                  placeholder="Department Name (e.g. R&D)"
                  value={newDeptForm.name}
                  onChange={(e) => setNewDeptForm({ ...newDeptForm, name: e.target.value })}
                  style={{ padding: "5px 8px", fontSize: 12 }}
                  required
                />
                <input
                  type="text"
                  placeholder="Code (e.g. RD)"
                  value={newDeptForm.code}
                  onChange={(e) => setNewDeptForm({ ...newDeptForm, code: e.target.value })}
                  style={{ padding: "5px 8px", fontSize: 12 }}
                />
                <input
                  type="text"
                  placeholder="Description (Optional)"
                  value={newDeptForm.description}
                  onChange={(e) => setNewDeptForm({ ...newDeptForm, description: e.target.value })}
                  style={{ padding: "5px 8px", fontSize: 12 }}
                />
              </div>
              <button type="submit" className="btn sm" style={{ width: "100%", padding: "6px" }}>
                + Create Budget Department
              </button>
            </form>

            {/* List of Active Budget Departments */}
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              Active Budget Departments ({deptListRows.filter((d) => d.is_active).length}):
            </div>

            {deptLoading ? (
              <div className="loading">Loading budget departments…</div>
            ) : (
              <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--line-soft)", borderRadius: 6 }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.04)", textAlign: "left" }}>
                      <th style={{ padding: "6px 10px" }}>Name</th>
                      <th style={{ padding: "6px 10px" }}>Code</th>
                      <th style={{ padding: "6px 10px" }}>Status</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deptListRows.map((d) => {
                      const isEditing = editingDeptId === d.id;
                      return (
                        <tr key={d.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          <td style={{ padding: "6px 10px", fontWeight: 600 }}>
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingDeptForm.name || ""}
                                onChange={(e) => setEditingDeptForm({ ...editingDeptForm, name: e.target.value })}
                                style={{ padding: "2px 6px", fontSize: 12, width: 120 }}
                              />
                            ) : (
                              d.name
                            )}
                          </td>
                          <td style={{ padding: "6px 10px" }}>
                            {isEditing ? (
                              <input
                                type="text"
                                value={editingDeptForm.code || ""}
                                onChange={(e) => setEditingDeptForm({ ...editingDeptForm, code: e.target.value })}
                                style={{ padding: "2px 6px", fontSize: 12, width: 70 }}
                              />
                            ) : (
                              <span className="pill gold mono" style={{ fontSize: 10 }}>{d.code || d.name.slice(0, 4)}</span>
                            )}
                          </td>
                          <td style={{ padding: "6px 10px" }}>
                            <span
                              className={`pill ${d.is_active ? "gold" : "grey"}`}
                              onClick={() => handleToggleDeptStatus(d)}
                              style={{ cursor: "pointer", fontSize: 10 }}
                            >
                              {d.is_active ? "✓ Active" : "✕ Disabled"}
                            </span>
                          </td>
                          <td style={{ padding: "6px 10px", textAlign: "right" }}>
                            {isEditing ? (
                              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                                <button className="btn sm" onClick={() => handleSaveEditedDept(d)} style={{ padding: "2px 6px", fontSize: 11 }}>
                                  💾
                                </button>
                                <button className="btn ghost sm" onClick={() => setEditingDeptId(null)} style={{ padding: "2px 6px", fontSize: 11 }}>
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn ghost sm"
                                onClick={() => {
                                  setEditingDeptId(d.id);
                                  setEditingDeptForm({ name: d.name, code: d.code || "", description: d.description || "" });
                                }}
                                style={{ padding: "2px 6px", fontSize: 11 }}
                              >
                                ✏️ Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
