"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Field, Modal, Empty } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";

export default function MastersPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [tab, setTab] = useState("categories");
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [c, v] = await Promise.all([
      supabase.from("it_categories").select("*").order("sort_order"),
      supabase.from("it_vendors").select("*").order("name"),
    ]);
    setCategories(c.data || []);
    setVendors(v.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setErr("");
    const table = edit.kind === "category" ? "it_categories" : "it_vendors";
    const { kind, id, ...rest } = edit;
    if (!rest.name?.trim()) return setErr("Name is required.");
    const payload = kind === "category"
      ? { name: rest.name.trim(), description: rest.description || null, category_type: rest.category_type || "capex", sort_order: Number(rest.sort_order || 100), is_active: !!rest.is_active }
      : { name: rest.name.trim(), gst_no: rest.gst_no || null, contact_person: rest.contact_person || null, phone: rest.phone || null, email: rest.email || null, is_active: !!rest.is_active };
    const { error } = id
      ? await supabase.from(table).update(payload).eq("id", id)
      : await supabase.from(table).insert(payload);
    if (error) return setErr(error.message);
    setEdit(null);
    load();
  }

  async function toggle(table, row) {
    if (!isAdmin) return;
    await supabase.from(table).update({ is_active: !row.is_active }).eq("id", row.id);
    load();
  }

  return (
    <Shell
      title="Categories & Vendors"
      subtitle="Master data used by budgets, invoices and the asset register"
      actions={
        isAdmin && (
          <button className="btn sm" onClick={() => setEdit(tab === "categories"
            ? { kind: "category", name: "", description: "", category_type: "capex", sort_order: 100, is_active: true }
            : { kind: "vendor", name: "", gst_no: "", contact_person: "", phone: "", email: "", is_active: true })}>
            + New {tab === "categories" ? "category" : "vendor"}
          </button>
        )
      }
    >
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className={`btn ${tab === "categories" ? "" : "ghost"} sm`} onClick={() => setTab("categories")}>
          Categories ({categories.length})
        </button>
        <button className={`btn ${tab === "vendors" ? "" : "ghost"} sm`} onClick={() => setTab("vendors")}>
          Vendors ({vendors.length})
        </button>
      </div>

      {loading ? <div className="loading">Loading…</div> : tab === "categories" ? (
        <Card title="Budget categories" hint="Each category can hold a local and a global budget line per year">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num" style={{ width: 70 }}>Order</th><th>Name</th><th>Type</th><th>Description</th><th>Status</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td className="num mono">{c.sort_order}</td>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td>
                      <span className={`pill ${(c.category_type || "capex") === "opex" ? "amber" : "blue"}`}>
                        {(c.category_type || "capex").toUpperCase()}
                      </span>
                    </td>
                    <td style={{ color: "var(--muted)" }}>{c.description || "—"}</td>
                    <td><span className={`pill ${c.is_active ? "green" : "grey"}`}>{c.is_active ? "Active" : "Inactive"}</span></td>
                    {isAdmin && (
                      <td>
                        <div className="btn-row">
                          <button className="btn ghost sm" onClick={() => setEdit({ kind: "category", ...c })}>Edit</button>
                          <button className="btn ghost sm" onClick={() => toggle("it_categories", c)}>{c.is_active ? "Disable" : "Enable"}</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title="Vendors">
          {vendors.length === 0 ? <Empty>No vendors yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th>GST no</th><th>Contact</th><th>Phone</th><th>Email</th><th>Status</th>
                    {isAdmin && <th />}
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id}>
                      <td style={{ fontWeight: 600 }}>{v.name}</td>
                      <td className="mono" style={{ color: "var(--muted)" }}>{v.gst_no || "—"}</td>
                      <td style={{ color: "var(--muted)" }}>{v.contact_person || "—"}</td>
                      <td className="mono" style={{ color: "var(--muted)" }}>{v.phone || "—"}</td>
                      <td style={{ color: "var(--muted)" }}>{v.email || "—"}</td>
                      <td><span className={`pill ${v.is_active ? "green" : "grey"}`}>{v.is_active ? "Active" : "Inactive"}</span></td>
                      {isAdmin && (
                        <td>
                          <div className="btn-row">
                            <button className="btn ghost sm" onClick={() => setEdit({ kind: "vendor", ...v })}>Edit</button>
                            <button className="btn ghost sm" onClick={() => toggle("it_vendors", v)}>{v.is_active ? "Disable" : "Enable"}</button>
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
      )}

      {edit && (
        <Modal title={`${edit.id ? "Edit" : "New"} ${edit.kind}`} onClose={() => setEdit(null)}>
          {err && <div className="alert err">{err}</div>}
          <div className="stack">
            <Field label="Name *"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {edit.kind === "category" ? (
              <>
                <Field label="Category Type *">
                  <select
                    value={edit.category_type || "capex"}
                    onChange={(e) => setEdit({ ...edit, category_type: e.target.value })}
                  >
                    <option value="capex">CapEx (Capital Expenditure)</option>
                    <option value="opex">OpEx (Operating Expenditure)</option>
                  </select>
                </Field>
                <Field label="Description"><input value={edit.description || ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
                <Field label="Sort order"><input type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value })} /></Field>
              </>
            ) : (
              <>
                <Field label="GST number"><input value={edit.gst_no || ""} onChange={(e) => setEdit({ ...edit, gst_no: e.target.value })} /></Field>
                <Field label="Contact person"><input value={edit.contact_person || ""} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} /></Field>
                <Field label="Phone"><input value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
                <Field label="Email"><input type="email" value={edit.email || ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
              </>
            )}
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={!!edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} style={{ width: 16, height: 16 }} />
              Active
            </label>
            <div className="btn-row" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button className="btn" onClick={save}>Save</button>
            </div>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
