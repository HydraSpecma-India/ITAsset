"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";

const AuthCtx = createContext({ user: null, profile: null, loading: true, refresh: () => {}, signOut: () => {} });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (u) => {
    if (!u) {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem("itbm_local_user");
        if (saved) {
          try {
            const p = JSON.parse(saved);
            setUser({ id: p.id, email: p.email });
            setProfile(p);
            return;
          } catch {}
        }
      }
      setProfile(null);
      return;
    }

    let { data: userProf } = await supabase.from("it_users").select("*").eq("id", u.id).maybeSingle();
    if (!userProf && u.email) {
      const { data: emailMatch } = await supabase.from("it_users").select("*").ilike("email", u.email).maybeSingle();
      userProf = emailMatch;
    }

    if (!userProf && u.email) {
      const { data: empMatch } = await supabase.from("it_employees").select("*").ilike("email", u.email).maybeSingle();
      if (empMatch) {
        userProf = {
          id: empMatch.id,
          email: empMatch.email,
          full_name: empMatch.full_name,
          role: "employee",
          department: empMatch.department,
          is_active: empMatch.is_active,
        };
      }
    }

    setProfile(userProf || { id: u.id, email: u.email, full_name: u.email ? u.email.split("@")[0] : "User", role: "admin", department: "IT" });
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      const u = data?.session?.user || null;
      if (u) {
        setUser(u);
        await loadProfile(u);
      } else {
        await loadProfile(null);
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      const u = session?.user || null;
      if (u) {
        setUser(u);
        await loadProfile(u);
      } else {
        await loadProfile(null);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [loadProfile]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    await loadProfile(data?.user || null);
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      localStorage.removeItem("itbm_local_user");
    }
    setUser(null);
    setProfile(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, profile, loading, refresh, signOut }}>{children}</AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
