"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/session";

export default function Home() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (profile?.must_change_password) router.replace("/change-password");
    else router.replace("/dashboard");
  }, [loading, user, profile, router]);

  return <div className="loading">Loading…</div>;
}
