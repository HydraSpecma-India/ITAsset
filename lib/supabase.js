"use client";

import { createClient } from "@supabase/supabase-js";

// These are safe to expose in the browser — the database is protected by
// row level security. Override them with environment variables if you move
// the app to a different Supabase project.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ollhtyeflpggdazrsqsq.supabase.co";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_vXtlD6VqEY8u_tBSdmw-0A_hxEIlf2j";

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "itbm-auth",
  },
});
