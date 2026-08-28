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

  const deptPermissions = profile?.dept_permissions || {};

  const isGlobalUser =
    (profile?.role === "admin" && (profile?.department === "All" || !profile?.department || profile?.department === "IT")) ||
    profile?.role === "global_reader";

  // Build list of departments user has access to
  const extraDepts = Object.keys(deptPermissions).filter((k) => deptPermissions[k] && deptPermissions[k] !== "none");
  const primaryDept = profile?.department && profile?.department !== "All" ? profile.department : null;
  
  const userAllowedDepts = Array.from(new Set([
    ...(primaryDept ? [primaryDept] : []),
    ...extraDepts,
    ...(Array.isArray(profile?.allowed_departments) ? profile.allowed_departments : []),
  ]));

  const availableDepts = isGlobalUser
    ? ["All", ...departments]
    : userAllowedDepts.length > 0
    ? userAllowedDepts
    : ["IT"];

  const getEffectiveDept = useCallback(() => {
    if (!profile) return "IT";
    if (isGlobalUser) {
      const saved = typeof window !== "undefined" ? localStorage.getItem("itbm_selected_dept") : null;
      return saved && (departments.includes(saved) || saved === "All") ? saved : "IT";
    }
    const saved = typeof window !== "undefined" ? localStorage.getItem("itbm_selected_dept") : null;
    if (saved && availableDepts.includes(saved)) return saved;
    return availableDepts[0] || "IT";
  }, [profile, isGlobalUser, departments, availableDepts]);

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

  // Check if user has full admin access for currently selected department
  const currentDeptPerm = deptPermissions[currentDept];
  const isDeptAdmin =
    profile?.role === "admin" ||
    currentDeptPerm === "admin" ||
    (profile?.role === "dept_admin" && (currentDept === profile?.department || currentDept === "IT"));

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
        deptPermissions,
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
