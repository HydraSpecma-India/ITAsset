"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/session";

const NAV = [
  { group: "Overview", items: [
    { href: "/dashboard", label: "Dashboard", ico: "◈" },
    { href: "/budgets", label: "Budget vs Actual", ico: "▤" },
    { href: "/expiry", label: "Expiry & Renewals", ico: "⏱" },
    { href: "/planning", label: "Next Year Budget", ico: "◇" },
  ]},
  { group: "Records", items: [
    { href: "/invoices", label: "Invoices", ico: "▦" },
    { href: "/assets", label: "Asset Register", ico: "▧" },
    { href: "/employees", label: "Employees & Depts", ico: "👥" },
  ]},
  { group: "Setup", items: [
    { href: "/masters", label: "Categories & Vendors", ico: "⚙", adminOnly: true },
    { href: "/users", label: "Users", ico: "◉", adminOnly: true },
  ]},
];

export default function Shell({ title, subtitle, actions, children }) {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [theme, setTheme] = useState("dark");
  const [mobileOpen, setMobileOpen] = useState(false);

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
    else if (profile && !profile.is_active) signOut();
  }, [loading, user, profile, router, signOut]);

  if (loading || !user || !profile || profile.must_change_password) {
    return <div className="loading">Loading…</div>;
  }

  const isAdmin = profile.role === "admin";
  const initials = (profile.full_name || profile.email || "?")
    .split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

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
          const items = g.items.filter((i) => !i.adminOnly || isAdmin);
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <div className="nav-label">{g.group}</div>
              {items.map((i) => (
                <Link key={i.href} href={i.href} className={`nav-item ${pathname === i.href ? "active" : ""}`}>
                  <span className="nav-ico">{i.ico}</span>
                  {i.label}
                </Link>
              ))}
            </div>
          );
        })}

        <div style={{ flex: 1 }} />
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
            <button className="btn ghost sm" onClick={toggleTheme} title="Toggle Dark/Light Mode" style={{ borderRadius: 20, padding: "4px 12px" }}>
              {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
            </button>
            <span className={`pill ${isAdmin ? "gold" : "blue"}`}>{isAdmin ? "Admin" : "Viewer"}</span>
            <div className="avatar" title={profile.email}>{initials}</div>
          </div>
        </header>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}
