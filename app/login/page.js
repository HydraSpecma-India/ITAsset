"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/session";
import { Field } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (loading || !user || !profile) return;
    router.replace(profile.must_change_password ? "/change-password" : "/dashboard");
  }, [loading, user, profile, router]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();

    // 1. Try Supabase Auth
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (!authErr && authData?.user) {
      const { data: prof } = await supabase.from("it_users").select("*").eq("id", authData.user.id).maybeSingle();
      if (!prof || !prof.is_active) {
        await supabase.auth.signOut();
        setErr("This user account is disabled. Contact the IT administrator.");
        setBusy(false);
        return;
      }
      if (prof.role === "employee") {
        router.replace("/assets");
      } else {
        router.replace(prof.must_change_password ? "/change-password" : "/dashboard");
      }
      return;
    }

    // 2. Check employee default credentials in it_users table
    const { data: prof } = await supabase.from("it_users").select("*").eq("email", cleanEmail).maybeSingle();
    if (prof && prof.is_active !== false) {
      const firstName = (prof.full_name || "").trim().split(" ")[0].toLowerCase();
      const expectedPass = (prof.default_password || `${firstName.substring(0, 5)}@2026`).toLowerCase();

      if (password.trim() === expectedPass || password.trim() === prof.default_password) {
        if (typeof window !== "undefined") {
          localStorage.setItem("itbm_local_user", JSON.stringify(prof));
        }
        window.location.href = prof.role === "employee" ? "/assets" : "/dashboard";
        return;
      }
    }

    setErr("Wrong email or password.");
    setBusy(false);
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-head">
          <div className="brand-mark">HS</div>
          <h1>IT Budget Monitor</h1>
          <p>Purchase, asset & budget control · HydraSpecma</p>
        </div>

        {err && <div className="alert err">{err}</div>}

        <form onSubmit={submit} className="stack">
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="itadmin@hydraspecma.com" required autoComplete="username" />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required autoComplete="current-password" />
          </Field>
          <button className="btn" type="submit" disabled={busy} style={{ width: "100%", marginTop: 4 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p style={{ fontSize: 11.5, color: "var(--faint)", textAlign: "center", marginTop: 18, marginBottom: 0 }}>
          First-time users must set a new password after signing in.
        </p>
      </div>
    </div>
  );
}
