"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { Field } from "@/components/ui";

function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, profile, loading, refresh, signOut } = useAuth();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const forced = profile?.must_change_password;
  const s = strength(pw1);
  const bars = ["var(--red)", "var(--red)", "var(--amber)", "var(--amber)", "var(--green)", "var(--green)"];

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (pw1.length < 8) return setErr("Password must be at least 8 characters.");
    if (s < 3) return setErr("Use a mix of upper case, lower case and numbers.");
    if (pw1 !== pw2) return setErr("The two passwords do not match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }
    const { error: rpcErr } = await supabase.rpc("it_mark_password_changed");
    if (rpcErr) {
      setErr(rpcErr.message);
      setBusy(false);
      return;
    }
    await refresh();
    router.replace("/dashboard");
  }

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-head">
          <div className="brand-mark">IT</div>
          <h1>{forced ? "Set your password" : "Change password"}</h1>
          <p>{forced ? "For security, choose a new password before continuing." : "Update the password for your account."}</p>
        </div>

        {err && <div className="alert err">{err}</div>}
        {forced && <div className="alert info">You are signed in as {profile?.email}.</div>}

        <form onSubmit={submit} className="stack">
          <Field label="New password">
            <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} required autoComplete="new-password" />
          </Field>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} style={{ flex: 1, height: 4, borderRadius: 3, background: i < s ? bars[s] : "rgba(255,255,255,.1)" }} />
            ))}
          </div>
          <Field label="Confirm new password">
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" />
          </Field>
          <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: 4 }}>
            {busy ? "Saving…" : "Save password & continue"}
          </button>
          <button type="button" className="btn ghost" onClick={() => (forced ? signOut() : router.push("/dashboard"))}>
            {forced ? "Sign out" : "Cancel"}
          </button>
        </form>
      </div>
    </div>
  );
}
