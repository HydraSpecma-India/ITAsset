"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Card, Field, Modal, Empty } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { money, dateStr, todayISO, SCOPES, ITEM_TYPES, ASSET_STATUS, csvDownload } from "@/lib/format";

const blankLine = () => ({
  asset_name: "", asset_tag: "", serial_no: "", model: "",
  category_id: "", scope: "local", item_type: "hardware",
  staff_name: "", staff_code: "", department: "", location: "",
  quantity: 1, unit_cost: "", purchase_date: todayISO(),
  warranty_end: "", license_end: "", amc_end: "", replacement_due: "",
  status: "in_use", remarks: "",
});

export default function InvoicesPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [invoices, setInvoices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [i, c, v] = await Promise.all([
      supabase.from("v_it_invoice_totals").select("*").order("invoice_date", { ascending: false }),
      supabase.from("it_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("it_vendors").select("*").eq("is_active", true).order("name"),
    ]);
    setInvoices(i.data || []);
    setCategories(c.data || []);
    setVendors(v.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return invoices;
    return invoices.filter((i) =>
      [i.invoice_no, i.vendor_name, i.po_number, i.notes].filter(Boolean).join(" ").toLowerCase().includes(s)
    );
  }, [invoices, q]);

  const total = filtered.reduce((a, i) => a + Number(i.invoice_total), 0);

  async function openEdit(inv) {
    const { data } = await supabase.from("it_assets").select("*").eq("invoice_id", inv.id).order("created_at");
    setEditing({
      id: inv.id,
      invoice_no: inv.invoice_no, invoice_date: inv.invoice_date, vendor_id: inv.vendor_id || "",
      po_number: inv.po_number || "", currency: inv.currency, tax_amount: inv.tax_amount,
      other_charges: inv.other_charges, notes: inv.notes || "", attachment_path: inv.attachment_path || "",
      lines: (data || []).map((l) => ({ ...l, unit_cost: String(l.unit_cost), warranty_end: l.warranty_end || "", license_end: l.license_end || "", amc_end: l.amc_end || "", replacement_due: l.replacement_due || "" })),
    });
    setOpen(true);
  }

  async function showDetail(inv) {
    const { data } = await supabase
      .from("it_assets").select("*, it_categories(name)").eq("invoice_id", inv.id).order("created_at");
    setDetail({ inv, lines: data || [] });
  }

  async function remove(inv) {
    if (!confirm(`Delete invoice ${inv.invoice_no} and its ${inv.line_count} line(s)?`)) return;
    await supabase.from("it_invoices").delete().eq("id", inv.id);
    load();
  }

  function exportCsv() {
    csvDownload("invoices.csv", filtered.map((i) => ({
      invoice_no: i.invoice_no, invoice_date: i.invoice_date, vendor: i.vendor_name || "",
      po_number: i.po_number || "", lines: i.line_count, lines_total: i.lines_total,
      tax: i.tax_amount, other: i.other_charges, total: i.invoice_total,
    })));
  }

  return (
    <Shell
      title="Invoices"
      subtitle="Every IT purchase invoice with its asset lines"
      actions={
        <>
          <button className="btn ghost sm" onClick={exportCsv}>Export CSV</button>
          {isAdmin && (
            <button className="btn sm" onClick={() => { setEditing({ invoice_no: "", invoice_date: todayISO(), vendor_id: "", po_number: "", currency: "INR", tax_amount: 0, other_charges: 0, notes: "", attachment_path: "", lines: [blankLine()] }); setOpen(true); }}>
              + New invoice
            </button>
          )}
        </>
      }
    >
      <div className="toolbar">
        <div className="field" style={{ minWidth: 300, flex: 1 }}>
          <span className="field-label">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice no, vendor, PO, notes…" />
        </div>
      </div>

      <Card title={`${filtered.length} invoice${filtered.length === 1 ? "" : "s"}`} hint={`Total value ${money(total)}`}>
        {loading ? <div className="loading">Loading…</div> : filtered.length === 0 ? (
          <Empty>No invoices recorded yet.{isAdmin ? " Use “New invoice” to add the first one." : ""}</Empty>
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
                {filtered.map((i) => (
                  <tr key={i.id}>
                    <td style={{ fontWeight: 600 }}>{i.invoice_no}</td>
                    <td className="mono">{dateStr(i.invoice_date)}</td>
                    <td style={{ color: "var(--muted)" }}>{i.vendor_name || "—"}</td>
                    <td style={{ color: "var(--muted)" }}>{i.po_number || "—"}</td>
                    <td className="num mono">{i.line_count}</td>
                    <td className="num mono">{money(i.lines_total, i.currency)}</td>
                    <td className="num mono">{money(Number(i.tax_amount) + Number(i.other_charges), i.currency)}</td>
                    <td className="num mono" style={{ fontWeight: 600 }}>{money(i.invoice_total, i.currency)}</td>
                    <td>
                      <div className="btn-row">
                        <button className="btn ghost sm" onClick={() => showDetail(i)}>View</button>
                        {isAdmin && <button className="btn ghost sm" onClick={() => openEdit(i)}>Edit</button>}
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
          userId={profile.id}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); load(); }}
        />
      )}

      {detail && (
        <Modal wide title={`Invoice ${detail.inv.invoice_no}`} onClose={() => setDetail(null)}>
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
                  <th>Asset</th><th>Category</th><th>Scope</th><th>Assigned to</th>
                  <th className="num">Qty</th><th className="num">Unit</th><th className="num">Total</th>
                  <th>Warranty</th><th>Licence</th><th>AMC</th><th>Replace</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.asset_name}{l.asset_tag ? <div style={{ fontSize: 11, color: "var(--faint)" }}>{l.asset_tag}</div> : null}</td>
                    <td style={{ color: "var(--muted)" }}>{l.it_categories?.name}</td>
                    <td><span className={`pill ${l.scope === "global" ? "blue" : "grey"}`}>{l.scope === "global" ? "Global" : "Local"}</span></td>
                    <td style={{ color: "var(--muted)" }}>{l.staff_name || "—"}</td>
                    <td className="num mono">{l.quantity}</td>
                    <td className="num mono">{money(l.unit_cost)}</td>
                    <td className="num mono">{money(l.line_total)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{dateStr(l.warranty_end)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{dateStr(l.license_end)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{dateStr(l.amc_end)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{dateStr(l.replacement_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.inv.notes && <p style={{ color: "var(--muted)", fontSize: 13 }}>{detail.inv.notes}</p>}
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

function InvoiceForm({ value, categories, vendors, userId, onClose, onSaved }) {
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

      const rows = inv.lines.map((l) => ({
        lineId: l.id || null,
        invoice_id: invoiceId,
        asset_name: l.asset_name.trim(),
        asset_tag: l.asset_tag || null,
        serial_no: l.serial_no || null,
        model: l.model || null,
        category_id: l.category_id,
        scope: l.scope,
        item_type: l.item_type,
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
        remarks: l.remarks || null,
      }));
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

              <Field label="Assigned staff"><input value={l.staff_name} onChange={(e) => setLine(i, "staff_name", e.target.value)} /></Field>
              <Field label="Staff code"><input value={l.staff_code} onChange={(e) => setLine(i, "staff_code", e.target.value)} /></Field>
              <Field label="Department"><input value={l.department} onChange={(e) => setLine(i, "department", e.target.value)} /></Field>
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
