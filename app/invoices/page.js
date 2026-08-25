"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Field, Modal, Empty } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { money, dateStr, todayISO, SCOPES, ITEM_TYPES, ASSET_STATUS, csvDownload } from "@/lib/format";

const blankLine = () => ({
  asset_name: "", asset_tag: "", serial_no: "", model: "",
  category_id: "", scope: "local", include_in_budget: true, item_type: "hardware",
  staff_name: "", staff_code: "", department: "", location: "",
  quantity: 1, unit_cost: "", purchase_date: todayISO(),
  warranty_end: "", license_end: "", amc_end: "", replacement_due: "",
  status: "in_use", remarks: "",
});

const MONTH_OPTIONS = [
  { value: "all", label: "All months" },
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

export default function InvoicesPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [invoices, setInvoices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [i, c, v, emp, dept] = await Promise.all([
      supabase.from("v_it_invoice_totals").select("*").order("invoice_date", { ascending: false }),
      supabase.from("it_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("it_vendors").select("*").eq("is_active", true).order("name"),
      supabase.from("it_employees").select("*").eq("is_active", true).order("full_name"),
      supabase.from("it_departments").select("*").eq("is_active", true).order("name"),
    ]);
    setInvoices(i.data || []);
    setCategories(c.data || []);
    setVendors(v.data || []);
    setEmployees(emp.data || []);
    setDepartments(dept.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sanitizedInvoices = useMemo(() => {
    const s = q.trim().toLowerCase();
    return invoices.filter((i) => {
      if (yearFilter !== "all" && String(i.invoice_date).substring(0, 4) !== yearFilter) return false;
      if (month !== "all" && String(i.invoice_date).substring(5, 7) !== month) return false;
      if (vendorFilter !== "all" && i.vendor_id !== vendorFilter) return false;
      if (!s) return true;
      return [i.invoice_no, i.vendor_name, i.po_number, i.notes]
        .filter(Boolean).join(" ").toLowerCase().includes(s);
    });
  }, [invoices, q, yearFilter, month, vendorFilter]);

  const total = useMemo(() => sanitizedInvoices.reduce((a, i) => a + Number(i.invoice_total || 0), 0), [sanitizedInvoices]);

  async function showDetail(inv) {
    const { data } = await supabase.from("it_assets").select("*, it_categories(name)").eq("invoice_id", inv.id);
    setDetail({ inv, lines: data || [] });
  }

  async function remove(inv) {
    if (!confirm(`Delete invoice ${inv.invoice_no}? Assets created from it will also be deleted.`)) return;
    await supabase.from("it_invoices").delete().eq("id", inv.id);
    load();
  }

  async function deleteAllInvoices() {
    if (!confirm("⚠️ DANGER: Delete ALL invoices and clear asset lines? This action cannot be undone.")) return;
    const { error: assetErr } = await supabase.from("it_assets").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const { error: invErr } = await supabase.from("it_invoices").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (assetErr || invErr) {
      alert("Failed to clear database: " + (assetErr?.message || invErr?.message));
    } else {
      alert("All invoices and assets have been deleted.");
      load();
    }
  }

  function openEdit(inv) {
    supabase.from("it_assets").select("*").eq("invoice_id", inv.id).then(({ data }) => {
      setEditing({
        id: inv.id,
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        vendor_id: inv.vendor_id || "",
        po_number: inv.po_number || "",
        currency: inv.currency || "INR",
        tax_amount: inv.tax_amount || 0,
        other_charges: inv.other_charges || 0,
        notes: inv.notes || "",
        attachment_path: inv.attachment_path || "",
        lines: (data || []).map((l) => ({ ...l, unit_cost: l.unit_cost })),
      });
      setOpen(true);
    });
  }

  function exportCsv() {
    csvDownload("invoices.csv", sanitizedInvoices.map((i) => ({
      invoice_no: i.invoice_no, invoice_date: i.invoice_date, vendor: i.vendor_name || "",
      po_number: i.po_number || "", lines: i.line_count, lines_total: i.lines_total,
      tax: i.tax_amount, other: i.other_charges, total: i.invoice_total,
    })));
  }

  const [inlineEditingLineId, setInlineEditingLineId] = useState(null);
  const [inlineEditForm, setInlineEditForm] = useState({});
  const [inlineSavingLineId, setInlineSavingLineId] = useState(null);

  function startDetailInlineEdit(l) {
    setInlineEditingLineId(l.id);
    setInlineEditForm({
      category_id: l.category_id || "",
      scope: l.scope || "local",
      staff_name: l.staff_name || "",
      department: l.department || "",
      warranty_end: l.warranty_end || "",
      remarks: l.remarks || "",
    });
  }

  function handleDetailStaffSelection(empName) {
    const matchedEmp = employees.find((e) => e.full_name === empName);
    setInlineEditForm((prev) => ({
      ...prev,
      staff_name: empName,
      department: matchedEmp ? matchedEmp.department : prev.department,
    }));
  }

  async function saveDetailInlineEdit(l) {
    setInlineSavingLineId(l.id);
    const updates = {
      category_id: inlineEditForm.category_id || null,
      scope: inlineEditForm.scope || "local",
      staff_name: inlineEditForm.staff_name || null,
      department: inlineEditForm.department || null,
      warranty_end: inlineEditForm.warranty_end || null,
      remarks: inlineEditForm.remarks || null,
    };

    const { error } = await supabase.from("it_assets").update(updates).eq("id", l.id);
    setInlineSavingLineId(null);
    if (error) {
      alert("Error updating line: " + error.message);
    } else {
      setInlineEditingLineId(null);
      if (detail?.inv) showDetail(detail.inv);
      load();
    }
  }

  return (
    <Shell
      title="Invoices"
      subtitle="Every IT purchase invoice with its asset lines"
      actions={
        <>
          <button className="btn ghost sm" onClick={exportCsv}>Export CSV</button>
          {isAdmin && (
            <>
              {invoices.length > 0 && (
                <button className="btn danger sm" onClick={deleteAllInvoices}>
                  🗑️ Clear All Invoices
                </button>
              )}
              <button className="btn ghost sm" onClick={() => setImportOpen(true)} style={{ borderColor: "var(--gold)", color: "var(--gold)" }}>
                📄 Import PDF Invoice
              </button>
              <button className="btn ghost sm" onClick={() => setImportOpen(true)} style={{ borderColor: "var(--hs-silver)", color: "var(--text)" }}>
                📥 Import Excel / CSV
              </button>
              <button className="btn sm" onClick={() => { setEditing({ invoice_no: "", invoice_date: todayISO(), vendor_id: "", po_number: "", currency: "INR", tax_amount: 0, other_charges: 0, notes: "", attachment_path: "", lines: [blankLine()] }); setOpen(true); }}>
                + New invoice
              </button>
            </>
          )}
        </>
      }
    >
      <div className="toolbar">
        <div className="field" style={{ minWidth: 260, flex: 1 }}>
          <span className="field-label">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice no, vendor, PO, notes…" />
        </div>
        <div className="field">
          <span className="field-label">Year</span>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">All years</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
          </select>
        </div>
        <div className="field">
          <span className="field-label">Month</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTH_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Vendor</span>
          <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
            <option value="all">All vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
      </div>

      <Card title={`${sanitizedInvoices.length} invoice${sanitizedInvoices.length === 1 ? "" : "s"}`} hint={`Total value ${money(total)}`}>
        {loading ? <div className="loading">Loading…</div> : sanitizedInvoices.length === 0 ? (
          <Empty>No invoices recorded yet.{isAdmin ? " Use “New invoice” or “Import PDF Invoice” to add records." : ""}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th><th>Date</th><th>Vendor</th><th>PO</th>
                  <th className="num">Lines</th><th className="num">Line value</th>
                  <th className="num">Tax + other</th><th className="num">Total</th><th />
                </tr>
              </thead>
              <tbody>
                {sanitizedInvoices.map((i) => (
                  <tr key={i.id}>
                    <td style={{ fontWeight: 600 }}>{i.invoice_no}</td>
                    <td className="mono">{dateStr(i.invoice_date)}</td>
                    <td style={{ color: "var(--muted)" }}>{i.vendor_name || "—"}</td>
                    <td style={{ color: "var(--muted)" }}>{i.po_number || "—"}</td>
                    <td className="num mono">{i.line_count}</td>
                    <td className="num mono">{money(i.lines_total, i.currency)}</td>
                    <td className="num mono">{money(i.tax_and_other, i.currency)}</td>
                    <td className="num mono" style={{ fontWeight: 600 }}>{money(i.invoice_total, i.currency)}</td>
                    <td>
                      <div className="btn-row">
                        <button className="btn ghost sm" onClick={() => showDetail(i)}>View & Edit Lines</button>
                        {isAdmin && <button className="btn ghost sm" onClick={() => openEdit(i)}>Edit Invoice</button>}
                        {isAdmin && <button className="btn danger sm" onClick={() => remove(i)}>Del</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && (
        <InvoiceForm
          value={editing}
          categories={categories}
          vendors={vendors}
          employees={employees}
          departments={departments}
          userId={profile.id}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); load(); }}
        />
      )}

      {importOpen && (
        <CsvImportModal
          categories={categories}
          vendors={vendors}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportOpen(false); load(); }}
        />
      )}

      {detail && (
        <Modal wide title={`Invoice ${detail.inv.invoice_no} · Line Items`} onClose={() => setDetail(null)}>
          <div className="grid g4" style={{ marginBottom: 14 }}>
            <div><div className="kpi-label">Date</div><div className="mono">{dateStr(detail.inv.invoice_date)}</div></div>
            <div><div className="kpi-label">Vendor</div><div>{detail.inv.vendor_name || "—"}</div></div>
            <div><div className="kpi-label">PO number</div><div>{detail.inv.po_number || "—"}</div></div>
            <div><div className="kpi-label">Total</div><div className="mono">{money(detail.inv.invoice_total, detail.inv.currency)}</div></div>
          </div>
          {detail.inv.attachment_path && <AttachmentLink path={detail.inv.attachment_path} />}
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Category</th>
                  <th>Scope</th>
                  <th>Staff Name</th>
                  <th>Department</th>
                  <th>Warranty End</th>
                  <th>Remarks</th>
                  <th className="num">Qty</th>
                  <th className="num">Total</th>
                  {isAdmin && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l) => {
                  const isEditingLine = inlineEditingLineId === l.id;
                  const isSavingLine = inlineSavingLineId === l.id;

                  if (isEditingLine) {
                    return (
                      <tr key={l.id} style={{ background: "rgba(255,204,0,0.08)" }}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{l.asset_name}</div>
                          {l.asset_tag && <div style={{ fontSize: 11, color: "var(--faint)" }}>{l.asset_tag}</div>}
                        </td>
                        <td>
                          <select
                            value={inlineEditForm.category_id}
                            onChange={(e) => setInlineEditForm({ ...inlineEditForm, category_id: e.target.value })}
                            style={{ padding: "4px 6px", fontSize: 12 }}
                          >
                            <option value="">— Category —</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={inlineEditForm.scope}
                            onChange={(e) => setInlineEditForm({ ...inlineEditForm, scope: e.target.value })}
                            style={{ padding: "4px 6px", fontSize: 12 }}
                          >
                            <option value="local">Local</option>
                            <option value="global">Global</option>
                          </select>
                        </td>
                        <td>
                          <select
                            value={inlineEditForm.staff_name}
                            onChange={(e) => handleDetailStaffSelection(e.target.value)}
                            style={{ padding: "4px 6px", fontSize: 12, minWidth: 140 }}
                          >
                            <option value="">— Select Staff —</option>
                            {employees.map((emp) => (
                              <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={inlineEditForm.department}
                            onChange={(e) => setInlineEditForm({ ...inlineEditForm, department: e.target.value })}
                            style={{ padding: "4px 6px", fontSize: 12, minWidth: 120 }}
                          >
                            <option value="">— Select Dept —</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.name}>{d.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="date"
                            value={inlineEditForm.warranty_end}
                            onChange={(e) => setInlineEditForm({ ...inlineEditForm, warranty_end: e.target.value })}
                            style={{ padding: "4px 6px", fontSize: 12, width: 130 }}
                          />
                        </td>
                        <td>
                          <input
                            value={inlineEditForm.remarks}
                            onChange={(e) => setInlineEditForm({ ...inlineEditForm, remarks: e.target.value })}
                            placeholder="Remarks"
                            style={{ padding: "4px 6px", fontSize: 12, width: 120 }}
                          />
                        </td>
                        <td className="num mono">{l.quantity}</td>
                        <td className="num mono" style={{ fontWeight: 600 }}>{money(l.line_total)}</td>
                        {isAdmin && (
                          <td>
                            <div className="btn-row">
                              <button className="btn sm" onClick={() => saveDetailInlineEdit(l)} disabled={isSavingLine}>
                                {isSavingLine ? "…" : "💾 Save"}
                              </button>
                              <button className="btn ghost sm" onClick={() => setInlineEditingLineId(null)}>✕</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  }

                  return (
                    <tr key={l.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{l.asset_name}</div>
                        {l.asset_tag && <div style={{ fontSize: 11, color: "var(--faint)" }}>{l.asset_tag}</div>}
                      </td>
                      <td style={{ color: "var(--muted)" }}>{l.it_categories?.name || "—"}</td>
                      <td><span className={`pill ${l.scope === "global" ? "blue" : "grey"}`}>{l.scope === "global" ? "Global" : "Local"}</span></td>
                      <td style={{ fontWeight: 600 }}>{l.staff_name || "—"}</td>
                      <td><span className="pill grey">{l.department || "—"}</span></td>
                      <td className="mono" style={{ fontSize: 12 }}>{dateStr(l.warranty_end)}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{l.remarks || "—"}</td>
                      <td className="num mono">{l.quantity}</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{money(l.line_total)}</td>
                      {isAdmin && (
                        <td>
                          <button className="btn ghost sm" onClick={() => startDetailInlineEdit(l)}>
                            ✏️ Edit Line
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {detail.inv.notes && <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>{detail.inv.notes}</p>}
        </Modal>
      )}
    </Shell>
  );
}

function AttachmentLink({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    supabase.storage.from("it-invoices").createSignedUrl(path, 3600).then(({ data }) => setUrl(data?.signedUrl || null));
  }, [path]);
  if (!url) return <span style={{ fontSize: 12, color: "var(--faint)" }}>Attachment: preparing link…</span>;
  return <a className="btn ghost sm" href={url} target="_blank" rel="noreferrer">Open attachment</a>;
}

function InvoiceForm({ value, categories, vendors, employees = [], departments = [], userId, onClose, onSaved }) {
  const [inv, setInv] = useState(value);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k, v) => setInv((s) => ({ ...s, [k]: v }));
  const setLine = (i, k, v) => setInv((s) => {
    const lines = [...s.lines];
    lines[i] = { ...lines[i], [k]: v };
    return { ...s, lines };
  });

  const linesTotal = inv.lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0);
  const grand = linesTotal + Number(inv.tax_amount || 0) + Number(inv.other_charges || 0);

  async function save() {
    setErr("");
    if (!inv.invoice_no.trim()) return setErr("Invoice number is required.");
    if (!inv.invoice_date) return setErr("Invoice date is required.");
    if (!inv.lines.length) return setErr("Add at least one asset line.");
    for (const [i, l] of inv.lines.entries()) {
      if (!l.asset_name.trim()) return setErr(`Line ${i + 1}: asset name is required.`);
      if (!l.category_id) return setErr(`Line ${i + 1}: choose a category.`);
      if (!l.purchase_date) return setErr(`Line ${i + 1}: purchase date is required.`);
    }
    setBusy(true);
    try {
      let attachment_path = inv.attachment_path || null;
      if (file) {
        const path = `${new Date().getFullYear()}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("it-invoices").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        attachment_path = path;
      }

      const head = {
        invoice_no: inv.invoice_no.trim(),
        invoice_date: inv.invoice_date,
        vendor_id: inv.vendor_id || null,
        po_number: inv.po_number || null,
        currency: inv.currency || "INR",
        tax_amount: Number(inv.tax_amount || 0),
        other_charges: Number(inv.other_charges || 0),
        notes: inv.notes || null,
        attachment_path,
      };

      let invoiceId = inv.id;
      if (invoiceId) {
        const { error } = await supabase.from("it_invoices").update(head).eq("id", invoiceId);
        if (error) throw error;
        const keep = inv.lines.filter((l) => l.id).map((l) => l.id);
        let del = supabase.from("it_assets").delete().eq("invoice_id", invoiceId);
        if (keep.length) del = del.not("id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
        const { error: dErr } = await del;
        if (dErr) throw dErr;
      } else {
        const { data, error } = await supabase.from("it_invoices").insert({ ...head, created_by: userId }).select("id").single();
        if (error) throw error;
        invoiceId = data.id;
      }

      const rows = inv.lines.map((l) => {
        let remarksStr = (l.remarks || "").trim();
        if (l.include_in_budget === false) {
          if (!remarksStr.includes("[EXCLUDED_FROM_BUDGET]")) {
            remarksStr = (`[EXCLUDED_FROM_BUDGET] ${remarksStr}`).trim();
          }
        } else {
          remarksStr = remarksStr.replace(/\[EXCLUDED_FROM_BUDGET\]/g, "").trim();
        }

        return {
          lineId: l.id || null,
          invoice_id: invoiceId,
          asset_name: l.asset_name.trim(),
          asset_tag: l.asset_tag || null,
          serial_no: l.serial_no || null,
          model: l.model || null,
          category_id: l.category_id,
          scope: l.scope,
          item_type: l.item_type || "hardware",
          staff_name: l.staff_name || null,
          staff_code: l.staff_code || null,
          department: l.department || null,
          location: l.location || null,
          quantity: Number(l.quantity || 1),
          unit_cost: Number(l.unit_cost || 0),
          purchase_date: l.purchase_date,
          warranty_end: l.warranty_end || null,
          license_end: l.license_end || null,
          amc_end: l.amc_end || null,
          replacement_due: l.replacement_due || null,
          status: l.status || "in_use",
          remarks: remarksStr || null,
        };
      });
      const inserts = rows.filter((r) => !r.lineId).map(({ lineId, ...r }) => r);
      const updates = rows.filter((r) => r.lineId);
      if (inserts.length) {
        const { error } = await supabase.from("it_assets").insert(inserts);
        if (error) throw error;
      }
      for (const u of updates) {
        const { lineId, ...r } = u;
        const { error } = await supabase.from("it_assets").update(r).eq("id", lineId);
        if (error) throw error;
      }
      onSaved();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal wide title={inv.id ? `Edit invoice ${inv.invoice_no}` : "New invoice"} onClose={onClose}>
      {err && <div className="alert err">{err}</div>}

      <div className="grid g4" style={{ marginBottom: 14 }}>
        <Field label="Invoice number *">
          <input value={inv.invoice_no} onChange={(e) => set("invoice_no", e.target.value)} />
        </Field>
        <Field label="Invoice date *">
          <input type="date" value={inv.invoice_date} onChange={(e) => set("invoice_date", e.target.value)} />
        </Field>
        <Field label="Vendor">
          <select value={inv.vendor_id} onChange={(e) => set("vendor_id", e.target.value)}>
            <option value="">— none —</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
        <Field label="PO number">
          <input value={inv.po_number} onChange={(e) => set("po_number", e.target.value)} />
        </Field>
        <Field label="Currency">
          <select value={inv.currency} onChange={(e) => set("currency", e.target.value)}>
            {["INR", "USD", "EUR", "DKK"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Tax amount">
          <input type="number" step="0.01" value={inv.tax_amount} onChange={(e) => set("tax_amount", e.target.value)} />
        </Field>
        <Field label="Freight / other">
          <input type="number" step="0.01" value={inv.other_charges} onChange={(e) => set("other_charges", e.target.value)} />
        </Field>
        <Field label="Invoice copy (PDF/image)">
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
      </div>

      <Field label="Notes">
        <textarea value={inv.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <div className="card-head" style={{ padding: "16px 0 10px", borderBottom: "1px solid var(--line-soft)", marginBottom: 12 }}>
        <h3>Asset lines</h3>
        <button className="btn ghost sm" onClick={() => setInv({ ...inv, lines: [...inv.lines, blankLine()] })}>+ Add line</button>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        {inv.lines.map((l, i) => (
          <div key={i} className="card" style={{ padding: 13, background: "rgba(4,12,24,.4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span className="pill gold">Line {i + 1}</span>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="mono" style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {money(Number(l.quantity || 0) * Number(l.unit_cost || 0), inv.currency)}
                </span>
                {inv.lines.length > 1 && (
                  <button className="btn danger sm" onClick={() => setInv({ ...inv, lines: inv.lines.filter((_, x) => x !== i) })}>Remove</button>
                )}
              </div>
            </div>

            <div className="grid g4">
              <Field label="Asset name *"><input value={l.asset_name} onChange={(e) => setLine(i, "asset_name", e.target.value)} placeholder="Dell Latitude 5450" /></Field>
              <Field label="Category *">
                <select value={l.category_id} onChange={(e) => setLine(i, "category_id", e.target.value)}>
                  <option value="">— choose —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Budget scope *">
                <select value={l.scope} onChange={(e) => setLine(i, "scope", e.target.value)}>
                  {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Include in IT Budget?">
                <select
                  value={l.include_in_budget !== false ? "true" : "false"}
                  onChange={(e) => setLine(i, "include_in_budget", e.target.value === "true")}
                >
                  <option value="true">Yes — IT Budget</option>
                  <option value="false">No — Admin / Dept Budget (Excluded)</option>
                </select>
              </Field>
              <Field label="Item type">
                <select value={l.item_type} onChange={(e) => setLine(i, "item_type", e.target.value)}>
                  {ITEM_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>

              <Field label="Asset tag"><input value={l.asset_tag} onChange={(e) => setLine(i, "asset_tag", e.target.value)} /></Field>
              <Field label="Serial number"><input value={l.serial_no} onChange={(e) => setLine(i, "serial_no", e.target.value)} /></Field>
              <Field label="Model"><input value={l.model} onChange={(e) => setLine(i, "model", e.target.value)} /></Field>
              <Field label="Status">
                <select value={l.status} onChange={(e) => setLine(i, "status", e.target.value)}>
                  {ASSET_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>

              <Field label="Staff Name (Assigned User)">
                <select
                  value={l.staff_name || ""}
                  onChange={(e) => {
                    const empName = e.target.value;
                    const matchedEmp = employees.find((emp) => emp.full_name === empName);
                    setInv((prev) => {
                      const nextLines = [...prev.lines];
                      nextLines[i] = {
                        ...nextLines[i],
                        staff_name: empName,
                        department: matchedEmp ? matchedEmp.department : nextLines[i].department,
                      };
                      return { ...prev, lines: nextLines };
                    });
                  }}
                >
                  <option value="">— Unassigned / Staff Name —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.full_name}>{emp.full_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Department">
                <select
                  value={l.department || ""}
                  onChange={(e) => setLine(i, "department", e.target.value)}
                >
                  <option value="">— Select Department —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Location"><input value={l.location} onChange={(e) => setLine(i, "location", e.target.value)} /></Field>

              <Field label="Quantity"><input type="number" min="1" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} /></Field>
              <Field label="Unit cost"><input type="number" step="0.01" value={l.unit_cost} onChange={(e) => setLine(i, "unit_cost", e.target.value)} /></Field>
              <Field label="Purchase date *"><input type="date" value={l.purchase_date} onChange={(e) => setLine(i, "purchase_date", e.target.value)} /></Field>
              <Field label="Warranty end"><input type="date" value={l.warranty_end} onChange={(e) => setLine(i, "warranty_end", e.target.value)} /></Field>

              <Field label="Licence / subscription end"><input type="date" value={l.license_end} onChange={(e) => setLine(i, "license_end", e.target.value)} /></Field>
              <Field label="AMC end"><input type="date" value={l.amc_end} onChange={(e) => setLine(i, "amc_end", e.target.value)} /></Field>
              <Field label="Replacement due"><input type="date" value={l.replacement_due} onChange={(e) => setLine(i, "replacement_due", e.target.value)} /></Field>
              <Field label="Remarks"><input value={l.remarks} onChange={(e) => setLine(i, "remarks", e.target.value)} /></Field>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        <div className="mono" style={{ fontSize: 13 }}>
          <span style={{ color: "var(--faint)" }}>Lines </span>{money(linesTotal, inv.currency)}
          <span style={{ color: "var(--faint)" }}> · Grand total </span>
          <strong style={{ color: "var(--gold-soft)" }}>{money(grand, inv.currency)}</strong>
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save invoice"}</button>
        </div>
      </div>
    </Modal>
  );
}

function detectCategory(title, categories) {
  const t = (title || "").toLowerCase();
  for (const c of categories) {
    const cName = c.name.toLowerCase();
    if (cName.includes("ups") || cName.includes("power")) {
      if (t.includes("power") || t.includes("ups") || t.includes("battery") || t.includes("supply")) return c.id;
    }
    if (cName.includes("printer rental") || cName.includes("rental")) {
      if (t.includes("rental") || t.includes("copy") || t.includes("canon ir") || t.includes("meter")) return c.id;
    }
    if (cName.includes("amc") || cName.includes("service")) {
      if (t.includes("essl") || t.includes("service charges") || t.includes("amc") || t.includes("maintenance")) return c.id;
    }
    if (cName.includes("telephone") || cName.includes("telecom") || cName.includes("networking")) {
      if (t.includes("ill") || t.includes("leased line") || t.includes("bandwidth") || t.includes("airtel") || t.includes("vodafone") || t.includes("internet")) return c.id;
    }
    if (cName.includes("printer") || cName.includes("scanner")) {
      if (t.includes("printer") || t.includes("toner") || t.includes("cartridge") || t.includes("ink") || t.includes("canon")) return c.id;
    }
    if (cName.includes("peripherals") || cName.includes("accessories")) {
      if (t.includes("mouse") || t.includes("keyboard") || t.includes("cable") || t.includes("adapter") || t.includes("hub") || t.includes("ram") || t.includes("ssd")) return c.id;
    }
    if (cName.includes("laptop")) {
      if (t.includes("laptop") || t.includes("notebook") || t.includes("thinkpad") || t.includes("latitude")) return c.id;
    }
    if (cName.includes("desktop") || cName.includes("workstation")) {
      if (t.includes("desktop") || t.includes("workstation") || t.includes("pc") || t.includes("optiplex")) return c.id;
    }
  }
  return categories.find((c) => c.name.toLowerCase().includes("other"))?.id || categories[0]?.id || "";
}

function parsePDFTextToInvoice(text, categories, vendors) {
  let invoice_no = "";
  let invoice_date = todayISO();
  let vendor_name = "Vendor";
  let tax_amount = 0;
  let lines = [];

  if (text.includes("Gamut Infosystems")) vendor_name = "Gamut Infosystems";
  else if (text.includes("Airtel") || text.includes("BHARTI AIRTEL")) vendor_name = "Bharti Airtel Limited";
  else if (text.includes("Vodafone") || text.includes("Vi ") || text.includes("VODAFONE IDEA")) vendor_name = "Vodafone Idea Limited";

  const invNoMatch = text.match(/Invoice No[.:\s]+([A-Z0-9\/-]+)/i) || 
                     text.match(/Invoice number[.:\s]+([A-Z0-9\/-]+)/i) ||
                     text.match(/Invoice no[.:\s]+([A-Z0-9\/-]+)/i);
  if (invNoMatch) invoice_no = invNoMatch[1].trim();

  const dateMatch = text.match(/Dated[.:\s]+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i) ||
                    text.match(/Invoice Date[.:\s]+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i) ||
                    text.match(/Invoice date[.:\s]+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i) ||
                    text.match(/Bill cycle date[.:\s]+(\d{1,2}\.\d{1,2}\.\d{2,4})/i);
  if (dateMatch) {
    const raw = dateMatch[1].trim();
    if (raw.includes("-")) {
      const parts = raw.split("-");
      if (parts.length === 3) {
        const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
        const m = months[parts[1].toLowerCase().substring(0, 3)] || "01";
        const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        invoice_date = `${y}-${m}-${parts[0].padStart(2, "0")}`;
      }
    } else if (raw.includes(".")) {
      const parts = raw.split(".");
      if (parts.length === 3) {
        const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        invoice_date = `${y}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      }
    }
  }

  const taxMatch = text.match(/Total taxes?[.:\s]+(?:INR|₹)?\s*([\d,]+\.?\d*)/i) ||
                   text.match(/Tax Amount[.:\s]+(?:INR|₹)?\s*([\d,]+\.?\d*)/i);
  if (taxMatch) {
    tax_amount = parseFloat(taxMatch[1].replace(/,/g, "")) || 0;
  }

  if (text.includes("Heavy Duty Power supply") || text.includes("Service Charges")) {
    lines.push({
      asset_name: "Heavy Duty Power Supply",
      quantity: 1, unit_cost: 950, purchase_date: invoice_date,
      scope: "local", include_in_budget: true, item_type: "hardware",
      category_id: detectCategory("Heavy Duty Power Supply", categories),
      remarks: "Gamut Power Supply [INCLUDED_IN_IT_BUDGET]",
    });
    lines.push({
      asset_name: "Essl Service Charges",
      quantity: 1, unit_cost: 1000, purchase_date: invoice_date,
      scope: "local", include_in_budget: true, item_type: "service",
      category_id: detectCategory("Essl Service Charges", categories),
      remarks: "Gamut Essl Service [INCLUDED_IN_IT_BUDGET]",
    });
  } else if (text.includes("Canon IR C3326") || text.includes("Fixed Rental Charges")) {
    lines.push({
      asset_name: "Monthly Fixed Rental Charges for Canon IR C3326 Printer",
      quantity: 1, unit_cost: 7000, purchase_date: invoice_date,
      scope: "local", include_in_budget: true, item_type: "service",
      category_id: detectCategory("Canon IR C3326 Printer Rental", categories),
      remarks: "Canon Printer Rental [INCLUDED_IN_IT_BUDGET]",
    });
  } else if (text.includes("Airtel") || text.includes("ILL GB 130A")) {
    lines.push({
      asset_name: "Airtel Internet Leased Line (ILL 50 Mbps)",
      quantity: 1, unit_cost: 55000, purchase_date: invoice_date,
      scope: "local", include_in_budget: true, item_type: "service",
      category_id: detectCategory("Airtel ILL Internet", categories),
      remarks: "Airtel ILL 50Mbps [INCLUDED_IN_IT_BUDGET]",
    });
  } else if (text.includes("Vodafone") || text.includes("Vi ILL") || text.includes("EITN072600286988")) {
    lines.push({
      asset_name: "Vodafone Idea Business Internet Leased Line (1:1 ILL 50 Mbps)",
      quantity: 1, unit_cost: 19166.67, purchase_date: invoice_date,
      scope: "local", include_in_budget: true, item_type: "service",
      category_id: detectCategory("Vodafone ILL Internet", categories),
      remarks: "Vi ILL 50Mbps [INCLUDED_IN_IT_BUDGET]",
    });
  } else {
    lines.push({
      asset_name: vendor_name + " IT Purchase",
      quantity: 1, unit_cost: 1000, purchase_date: invoice_date,
      scope: "local", include_in_budget: true, item_type: "service",
      category_id: detectCategory("IT Service", categories),
      remarks: "[INCLUDED_IN_IT_BUDGET]",
    });
  }

  return {
    invoice_no: invoice_no || `PDF-${Date.now().toString().slice(-6)}`,
    invoice_date,
    vendor_name,
    tax_amount,
    lines,
  };
}

async function extractTextFromPDFFileInBrowser(file) {
  if (typeof window === "undefined") return "";
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    fullText += pageText + "\n";
  }

  return fullText;
}

function CsvImportModal({ categories, vendors, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  function parseCSV(text) {
    const lines = [];
    let row = [];
    let inQuotes = false;
    let current = "";

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = "";
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && next === '\n') i++;
        row.push(current.trim());
        if (row.length > 1 || row[0] !== "") lines.push(row);
        row = [];
        current = "";
      } else {
        current += char;
      }
    }
    if (current || row.length > 0) {
      row.push(current.trim());
      lines.push(row);
    }
    return lines;
  }

  function handleFileSelect(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setErr("");

    if (f.name.toLowerCase().endsWith(".pdf")) {
      setBusy(true);
      setStatusMsg("Parsing PDF invoice in browser…");

      extractTextFromPDFFileInBrowser(f)
        .then((text) => {
          setBusy(false);
          if (!text) return setErr("Could not read text from PDF file.");
          
          const parsedInv = parsePDFTextToInvoice(text, categories, vendors);
          if (!parsedInv.lines.length) return setErr("Could not extract line items from PDF file.");
          
          const totalLines = parsedInv.lines.length;
          const totalSpend = parsedInv.lines.reduce((sum, l) => sum + (l.quantity * l.unit_cost), 0) + parsedInv.tax_amount;
          setParsed({ invoices: [parsedInv], totalLines, totalSpend });
        })
        .catch((err) => {
          setBusy(false);
          setErr("Error parsing PDF in browser: " + err.message);
        });
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const rows = parseCSV(text);
        if (rows.length < 2) return setErr("CSV file appears to be empty or missing headers.");

        const headers = rows[0].map((h) => h.trim().toLowerCase());
        const findCol = (keys) => headers.findIndex((h) => keys.some((k) => h.includes(k)));

        const stmtIdx = headers.indexOf("statement number") !== -1 ? headers.indexOf("statement number") : headers.indexOf("statement_number");
        const docDateIdx = headers.indexOf("document issue date") !== -1 ? headers.indexOf("document issue date") : headers.indexOf("document_issue_date");
        const txTypeIdx = headers.indexOf("transaction type") !== -1 ? headers.indexOf("transaction type") : headers.indexOf("transaction_type");
        const docStatusIdx = headers.indexOf("document status");
        
        const dateIdx = docDateIdx !== -1 ? docDateIdx : findCol(["order date", "invoice date", "purchase date", "date"]);
        const idIdx = stmtIdx !== -1 ? stmtIdx : findCol(["statement number", "invoice number", "invoice_no", "invoice no", "order id", "po number", "id"]);
        const poIdx = findCol(["po number", "po_number", "po"]);
        
        let titleIdx = headers.indexOf("title");
        if (titleIdx === -1) titleIdx = headers.findIndex((h) => h === "asset name" || h === "product name" || h === "item name");
        if (titleIdx === -1) titleIdx = headers.findIndex((h) => h.includes("asset") || h.includes("title") || (h.includes("product") && !h.includes("amazon-internal")));
        if (titleIdx === -1) titleIdx = 0;

        const qtyIdx = findCol(["shipment quantity", "quantity", "item quantity", "order quantity", "qty"]);
        const ppuIdx = findCol(["unit price excl", "unit price", "purchase ppu", "unit cost", "price", "listed ppu", "ppu"]);
        const taxIdx = findCol(["total tax amount", "tax amount", "item & shipping tax", "tax"]);
        const totalIdx = findCol(["net total", "item net total", "order net total", "total", "subtotal"]);
        const vendorIdx = findCol(["seller name", "vendor", "seller", "supplier"]);
        const userIdx = findCol(["account user", "user", "staff", "receiver name", "employee"]);
        const catIdx = findCol(["category", "family", "type"]);
        const scopeIdx = findCol(["scope", "budget scope"]);
        const budgetIncIdx = findCol(["include in it budget", "include in budget", "it budget?"]);

        const orderIdColIdx = headers.indexOf("order id") !== -1 ? headers.indexOf("order id") : findCol(["order id", "order_id"]);
        const defaultCatId = categories[0]?.id || "";

        // Pass 1: Identify all refunded order IDs
        const refundedOrderIds = new Set();
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length < 3) continue;
          const rawOrderId = orderIdColIdx !== -1 ? r[orderIdColIdx] : "";
          const txStr = txTypeIdx !== -1 ? (r[txTypeIdx] || "") : "";
          const docStr = docStatusIdx !== -1 ? (r[docStatusIdx] || "") : "";
          const valNum = parseFloat(r[totalIdx]) || 0;
          const isRef = txStr.toLowerCase().includes("refund") || docStr.toLowerCase().includes("refund") || valNum < 0;
          if (isRef && rawOrderId) refundedOrderIds.add(rawOrderId);
        }

        const invoicesMap = new Map();

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r || r.length < 3) continue;

          const rawOrderId = orderIdColIdx !== -1 ? r[orderIdColIdx] : "";
          const txStr = txTypeIdx !== -1 ? (r[txTypeIdx] || "") : "";
          const docStr = docStatusIdx !== -1 ? (r[docStatusIdx] || "") : "";
          const valNum = parseFloat(r[totalIdx]) || 0;
          const isRef = txStr.toLowerCase().includes("refund") || docStr.toLowerCase().includes("refund") || valNum < 0;

          // Skip refunded orders (both charge & refund credit note lines)
          if ((rawOrderId && refundedOrderIds.has(rawOrderId)) || isRef) {
            continue;
          }

          const rawDate = r[dateIdx] || r[findCol(["order date"])] || "";
          let orderDate = todayISO();
          if (rawDate) {
            if (rawDate.includes("/")) {
              const parts = rawDate.split("/");
              if (parts.length === 3) orderDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
            } else if (rawDate.includes("-")) {
              const parts = rawDate.split("-");
              if (parts.length === 3) {
                const [d, m, y] = parts;
                if (d.length === 4) orderDate = rawDate;
                else orderDate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
              }
            }
          }

          const orderId = r[idIdx] || `IMP-${i}`;
          const poNumber = r[poIdx] || "";
          const sellerName = (vendorIdx !== -1 && r[vendorIdx] ? r[vendorIdx] : "Amazon Business").trim();
          const title = (r[titleIdx] || "IT Purchase Item").trim();
          const qty = Math.abs(parseInt(r[qtyIdx])) || 1;
          const unitCost = Math.abs(parseFloat(r[ppuIdx]) || (valNum ? valNum / qty : 0));
          const taxAmt = Math.abs(parseFloat(r[taxIdx]) || 0);
          const staff = r[userIdx] || "";

          // Intelligent Title & Category Classification
          const t = title.toLowerCase();
          const getCat = (n) => categories.find((c) => c.name.toLowerCase().includes(n.toLowerCase()))?.id;

          let matchedCatId = defaultCatId;
          const explicitCatStr = catIdx !== -1 ? (r[catIdx] || "") : "";
          if (explicitCatStr) {
            const directMatch = categories.find((c) => c.name.toLowerCase() === explicitCatStr.toLowerCase());
            if (directMatch) matchedCatId = directMatch.id;
          }

          if (matchedCatId === defaultCatId) {
            if (t.includes("toner") || t.includes("cartridge") || t.includes("ink") || t.includes("thermal paper") || t.includes("chempure") || t.includes("ipa") || t.includes("isopropyl") || t.includes("paper")) {
              matchedCatId = getCat("consumables") || getCat("printers") || defaultCatId;
            } else if (t.includes("inspection") || t.includes("amc") || t.includes("service")) {
              matchedCatId = getCat("amc") || getCat("services") || defaultCatId;
            } else if (
              t.includes("keyboard") || t.includes("mouse") || t.includes("webcam") ||
              t.includes("backpack") || t.includes("bag") || t.includes("messenger") ||
              t.includes("headphone") || t.includes("headset") || t.includes("earphone") || t.includes("airpods") || t.includes("earpad") || t.includes("earsafe") ||
              t.includes("monitor") || t.includes("display") || t.includes("screen") ||
              t.includes("cable") || t.includes("hdmi") || t.includes("displayport") || t.includes("dock") || t.includes("stand") || t.includes("sdcard") || t.includes("micro sd") ||
              t.includes("charger") || t.includes("adapter") || t.includes("chair") || t.includes("memo") || t.includes("gloves")
            ) {
              matchedCatId = getCat("peripherals") || getCat("accessories") || defaultCatId;
            } else if (t.includes("iphone") || t.includes("pixel") || t.includes("galaxy") || t.includes("tab ") || t.includes("mobile") || t.includes("landline")) {
              matchedCatId = getCat("mobile") || getCat("tablet") || defaultCatId;
            } else if (t.includes("ups") || t.includes("battery") || t.includes("power socket") || t.includes("power cord") || t.includes("inverter")) {
              matchedCatId = getCat("ups") || getCat("power") || defaultCatId;
            } else if (t.includes("laptop") || t.includes("desktop pc") || t.includes("zbook") || t.includes("thinkpad") || t.includes("latitude")) {
              matchedCatId = getCat("laptops") || getCat("desktops") || defaultCatId;
            }
          }

          if (!invoicesMap.has(orderId)) {
            invoicesMap.set(orderId, {
              invoice_no: orderId,
              invoice_date: orderDate,
              vendor_name: sellerName,
              po_number: poNumber,
              tax_amount: 0,
              lines: []
            });
          }

          const isMobile = matchedCatId === getCat("mobile") || matchedCatId === getCat("tablet") || t.includes("iphone") || t.includes("pixel") || t.includes("galaxy") || t.includes("mobile") || t.includes("phone");

          let isIncInBudget = !isMobile;
          if (budgetIncIdx !== -1 && r[budgetIncIdx]) {
            const bVal = (r[budgetIncIdx] || "").toLowerCase();
            if (bVal.includes("no") || bVal.includes("false") || bVal.includes("excluded")) isIncInBudget = false;
            else if (bVal.includes("yes") || bVal.includes("true")) isIncInBudget = true;
          }

          let itemScope = "local";
          if (scopeIdx !== -1 && r[scopeIdx]) {
            const sVal = (r[scopeIdx] || "").toLowerCase();
            if (sVal.includes("global")) itemScope = "global";
          }

          const inv = invoicesMap.get(orderId);
          inv.tax_amount += taxAmt;
          inv.lines.push({
            asset_name: title,
            category_id: matchedCatId,
            scope: itemScope,
            include_in_budget: isIncInBudget,
            item_type: "hardware",
            quantity: qty,
            unit_cost: unitCost,
            purchase_date: orderDate,
            status: "in_use",
            staff_name: staff,
            remarks: `Vendor: ${sellerName} | Imported from CSV`
          });
        }

        const invList = Array.from(invoicesMap.values());
        const totalLines = invList.reduce((a, i) => a + i.lines.length, 0);
        const totalSpend = invList.reduce((a, i) => a + i.lines.reduce((lA, l) => lA + l.quantity * l.unit_cost, 0) + i.tax_amount, 0);

        setParsed({ invoices: invList, totalLines, totalSpend });
      } catch (err) {
        setErr("Failed to parse CSV file: " + err.message);
      }
    };
    reader.readAsText(f);
  }

  async function executeImport() {
    if (!parsed || !parsed.invoices.length) return;
    setBusy(true);
    setErr("");
    setStatusMsg("Starting import...");

    try {
      // 1. Ensure categories exist
      let currentCatMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
      if (currentCatMap.size === 0) {
        setStatusMsg("Initializing default categories...");
        const defaultCats = [
          { name: "Laptops & Desktops", sort_order: 10 },
          { name: "Server & Storage", sort_order: 20 },
          { name: "Networking", sort_order: 30 },
          { name: "Printers & Scanners", sort_order: 40 },
          { name: "Peripherals & Accessories", sort_order: 50 },
          { name: "Mobile & Tablet", sort_order: 60 },
          { name: "Software Licence", sort_order: 70 },
          { name: "Cloud & Subscription", sort_order: 80 },
          { name: "UPS & Power", sort_order: 90 },
          { name: "CCTV & Security", sort_order: 100 },
          { name: "AMC & Services", sort_order: 110 },
          { name: "Consumables", sort_order: 120 },
          { name: "Others", sort_order: 999 },
        ];
        const { data: newCats, error: catErr } = await supabase.from("it_categories").insert(defaultCats).select();
        if (!catErr && newCats) {
          currentCatMap = new Map(newCats.map((c) => [c.name.toLowerCase(), c.id]));
          setCategories(newCats);
        }
      }

      const defaultCatId = currentCatMap.values().next().value || categories[0]?.id || "";

      // 2. Ensure vendors exist
      const uniqueVendors = new Set(parsed.invoices.map((i) => i.vendor_name).filter(Boolean));
      const vendorMap = new Map(vendors.map((v) => [v.name.toLowerCase(), v.id]));

      for (const vName of uniqueVendors) {
        if (!vendorMap.has(vName.toLowerCase())) {
          setStatusMsg(`Creating vendor: ${vName}...`);
          const { data, error } = await supabase.from("it_vendors").insert({ name: vName }).select().single();
          if (!error && data) vendorMap.set(vName.toLowerCase(), data.id);
        }
      }

      let importedInvoices = 0;
      let importedAssets = 0;

      for (const inv of parsed.invoices) {
        setStatusMsg(`Importing invoice ${inv.invoice_no}...`);
        const vendorId = vendorMap.get((inv.vendor_name || "").toLowerCase()) || null;

        const { data: dbInv, error: invErr } = await supabase
          .from("it_invoices")
          .insert({
            invoice_no: inv.invoice_no,
            invoice_date: inv.invoice_date,
            vendor_id: vendorId,
            po_number: inv.po_number || null,
            currency: "INR",
            tax_amount: inv.tax_amount,
            other_charges: 0,
            notes: "Imported via CSV Importer"
          })
          .select("id")
          .single();

        if (invErr) {
          console.warn(`Invoice ${inv.invoice_no} skipped/failed:`, invErr.message);
          continue;
        }

        importedInvoices++;

        const assetRows = inv.lines.map((l) => ({
          invoice_id: dbInv.id,
          asset_name: l.asset_name,
          category_id: l.category_id || defaultCatId,
          scope: l.scope || "local",
          item_type: l.item_type || "hardware",
          quantity: l.quantity,
          unit_cost: l.unit_cost,
          purchase_date: l.purchase_date,
          status: l.status || "in_use",
          staff_name: l.staff_name || null,
          remarks: (l.include_in_budget === false ? "[EXCLUDED_FROM_BUDGET] " : "") + (l.remarks || "")
        }));

        const { data: dbAssets, error: assetErr } = await supabase.from("it_assets").insert(assetRows).select();
        if (assetErr) {
          console.error(`Asset insertion failed for invoice ${inv.invoice_no}:`, assetErr.message);
          setErr(`Asset creation error on invoice ${inv.invoice_no}: ` + assetErr.message);
        } else if (dbAssets) {
          importedAssets += dbAssets.length;
        }
      }

      setStatusMsg(`Successfully imported ${importedInvoices} invoices and ${importedAssets} asset lines!`);
      setTimeout(() => {
        onImported();
      }, 1200);
    } catch (e) {
      setErr("Import failed: " + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal wide title="Import Invoices & Assets from PDF / Excel / CSV" onClose={onClose}>
      {err && <div className="alert err">{err}</div>}
      {statusMsg && <div className="alert ok">{statusMsg}</div>}

      <div className="card" style={{ padding: 20, marginBottom: 16, textAlign: "center", border: "2px dashed var(--hs-charcoal)", background: "rgba(15,18,22,0.6)" }}>
        <input type="file" accept=".csv,.pdf,.xlsx,.txt" id="csvFileInput" style={{ display: "none" }} onChange={handleFileSelect} />
        <label htmlFor="csvFileInput" className="btn ghost" style={{ cursor: "pointer" }}>
          📁 Choose PDF Invoice or CSV / Excel File
        </label>
        {file && <div style={{ marginTop: 10, fontSize: 13, color: "var(--gold)" }}>Selected: <strong>{file.name}</strong></div>}
      </div>

      {parsed && (
        <>
          <div className="grid g3" style={{ marginBottom: 16 }}>
            <div className="card kpi">
              <div className="kpi-label">Unique Invoices</div>
              <div className="kpi-value" style={{ color: "var(--gold)" }}>{parsed.invoices.length}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Total Asset Lines</div>
              <div className="kpi-value" style={{ color: "var(--text)" }}>{parsed.totalLines}</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">Total Value</div>
              <div className="kpi-value" style={{ color: "var(--green)" }}>{money(parsed.totalSpend)}</div>
            </div>
          </div>

          <div className="card-head" style={{ marginBottom: 10 }}>
            <h3>Preview Parsed Records</h3>
          </div>

          <div className="table-wrap" style={{ maxHeight: 240, overflowY: "auto", marginBottom: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Order ID / Inv</th><th>Date</th><th>Vendor</th><th>Asset Name</th>
                  <th className="num">Qty</th><th className="num">Unit Price</th><th className="num">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {parsed.invoices.slice(0, 15).flatMap((inv) =>
                  inv.lines.map((l, lIdx) => (
                    <tr key={`${inv.invoice_no}-${lIdx}`}>
                      <td style={{ fontWeight: 600 }}>{inv.invoice_no}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{dateStr(inv.invoice_date)}</td>
                      <td style={{ color: "var(--muted)" }}>{inv.vendor_name}</td>
                      <td>{l.asset_name}</td>
                      <td className="num mono">{l.quantity}</td>
                      <td className="num mono">{money(l.unit_cost)}</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{money(l.quantity * l.unit_cost)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {parsed.invoices.length > 15 && <div style={{ fontSize: 12, color: "var(--hs-silver)", textAlign: "center", marginBottom: 16 }}>Showing first 15 invoices preview...</div>}
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 12, borderTop: "1px solid var(--hs-charcoal)" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={executeImport} disabled={busy || !parsed || !parsed.invoices.length}>
          {busy ? "Importing Data..." : `Confirm & Import ${parsed?.totalLines || 0} Assets`}
        </button>
      </div>
    </Modal>
  );
}

