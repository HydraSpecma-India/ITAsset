"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "./session";
import { supabase } from "./supabase";

export const DEFAULT_DEPARTMENTS = [
  "IT",
  "HR",
  "Purchase",
  "Quality",
  "Sales",
  "Operations",
  "Production",
  "Logistics",
];

export const DEPARTMENTS = DEFAULT_DEPARTMENTS;

const DeptContext = createContext({
  dept: "IT",
  setDept: () => {},
  availableDepts: ["All", ...DEFAULT_DEPARTMENTS],
  departments: DEFAULT_DEPARTMENTS,
  isGlobal: true,
  isDeptAdmin: false,
  refreshDepartments: () => {},
});

export function DeptProvider({ children }) {
  const { profile } = useAuth();
  const [departments, setDepartments] = useState(DEFAULT_DEPARTMENTS);

  const isGlobalUser =
    (profile?.role === "admin" && (profile?.department === "All" || !profile?.department || profile?.department === "IT")) ||
    profile?.role === "global_reader" ||
    profile?.role === "viewer";

  const isDeptAdmin =
    profile?.role === "admin" ||
    (profile?.role === "dept_admin" && profile?.department);

  const fetchDepartments = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("it_budget_departments")
        .select("name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (data && data.length > 0) {
        const names = data.map((d) => d.name);
        setDepartments(names);
      }
    } catch (err) {
      console.error("Failed to load dynamic budget departments:", err);
    }
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const getEffectiveDept = useCallback(() => {
    if (!profile) return "IT";
    if (isGlobalUser) {
      const saved = typeof window !== "undefined" ? localStorage.getItem("itbm_selected_dept") : null;
      return saved && (departments.includes(saved) || saved === "All") ? saved : "IT";
    }
    return profile.department && departments.includes(profile.department) ? profile.department : "IT";
  }, [profile, isGlobalUser, departments]);

  const [deptState, setDeptState] = useState(getEffectiveDept);

  useEffect(() => {
    if (profile) {
      setDeptState(getEffectiveDept());
    }
  }, [profile, isGlobalUser, departments, getEffectiveDept]);

  const setDept = (newDept) => {
    setDeptState(newDept);
    if (typeof window !== "undefined") {
      localStorage.setItem("itbm_selected_dept", newDept);
    }
  };

  const currentDept = getEffectiveDept();

  const availableDepts = isGlobalUser
    ? ["All", ...departments]
    : [profile?.department || "IT"];

  return (
    <DeptContext.Provider
      value={{
        dept: currentDept,
        setDept,
        availableDepts,
        departments,
        isGlobal: isGlobalUser,
        isDeptAdmin,
        userDept: profile?.department || "IT",
        refreshDepartments: fetchDepartments,
      }}
    >
      {children}
    </DeptContext.Provider>
  );
}

export function useDept() {
  return useContext(DeptContext);
}
