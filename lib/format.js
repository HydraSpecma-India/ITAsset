export const SCOPES = [
  { value: "local", label: "Local staff" },
  { value: "global", label: "Global staff" },
];

export const ITEM_TYPES = [
  { value: "hardware", label: "Hardware" },
  { value: "software", label: "Software" },
  { value: "service", label: "Service" },
];

export const ASSET_STATUS = [
  { value: "in_use", label: "In use" },
  { value: "spare", label: "Spare" },
  { value: "repair", label: "Under repair" },
  { value: "disposed", label: "Disposed" },
];

export function money(n, currency = "INR") {
  const v = Number(n || 0);
  const s = v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return currency === "INR" ? `₹${s}` : `${currency} ${s}`;
}

export function moneyShort(n) {
  const v = Number(n || 0);
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 10000000) return `${sign}₹${(a / 10000000).toFixed(2)} Cr`;
  if (a >= 100000) return `${sign}₹${(a / 100000).toFixed(2)} L`;
  if (a >= 1000) return `${sign}₹${(a / 1000).toFixed(1)} K`;
  return `${sign}₹${a.toFixed(0)}`;
}

export function dateStr(d) {
  if (!d) return "—";
  const dt = new Date(d + (String(d).length === 10 ? "T00:00:00" : ""));
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function daysUntil(d) {
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d + "T00:00:00");
  return Math.round((target - today) / 86400000);
}

export function expiryState(days) {
  if (days === null) return { key: "none", label: "—", cls: "grey" };
  if (days < 0) return { key: "expired", label: `Expired ${Math.abs(days)}d ago`, cls: "red" };
  if (days <= 30) return { key: "critical", label: `${days}d left`, cls: "red" };
  if (days <= 90) return { key: "soon", label: `${days}d left`, cls: "amber" };
  return { key: "ok", label: `${days}d left`, cls: "green" };
}

export function scopeLabel(s) {
  return s === "global" ? "Global" : "Local";
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function currentYear() {
  return new Date().getFullYear();
}

export function csvDownload(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
