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
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("it_users").select("*").eq("id", u.id).maybeSingle();
    setProfile(data || null);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      const u = data?.session?.user || null;
      setUser(u);
      await loadProfile(u);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      const u = session?.user || null;
      setUser(u);
      await loadProfile(u);
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
