"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./session";

export const DEPARTMENTS = [
  "IT",
  "HR",
  "Purchase",
  "Quality",
  "Sales",
  "Operations",
  "Production",
  "Logistics",
];

const DeptContext = createContext({
  dept: "IT",
  setDept: () => {},
  availableDepts: ["All", ...DEPARTMENTS],
  isGlobal: true,
  isDeptAdmin: false,
});

export function DeptProvider({ children }) {
  const { profile } = useAuth();

  const isGlobalUser =
    (profile?.role === "admin" && (profile?.department === "All" || !profile?.department || profile?.department === "IT")) ||
    profile?.role === "global_reader" ||
    profile?.role === "viewer";

  const isDeptAdmin =
    profile?.role === "admin" ||
    (profile?.role === "dept_admin" && profile?.department);

  const getEffectiveDept = () => {
    if (!profile) return "IT";
    if (isGlobalUser) {
      const saved = typeof window !== "undefined" ? localStorage.getItem("itbm_selected_dept") : null;
      return saved && (DEPARTMENTS.includes(saved) || saved === "All") ? saved : "IT";
    }
    return profile.department && DEPARTMENTS.includes(profile.department) ? profile.department : "IT";
  };

  const [deptState, setDeptState] = useState(getEffectiveDept);

  useEffect(() => {
    if (profile) {
      setDeptState(getEffectiveDept());
    }
  }, [profile, isGlobalUser]);

  const setDept = (newDept) => {
    setDeptState(newDept);
    if (typeof window !== "undefined") {
      localStorage.setItem("itbm_selected_dept", newDept);
    }
  };

  const currentDept = getEffectiveDept();

  const availableDepts = isGlobalUser
    ? ["All", ...DEPARTMENTS]
    : [profile?.department || "IT"];

  return (
    <DeptContext.Provider
      value={{
        dept: currentDept,
        setDept,
        availableDepts,
        isGlobal: isGlobalUser,
        isDeptAdmin,
        userDept: profile?.department || "IT",
      }}
    >
      {children}
    </DeptContext.Provider>
  );
}

export function useDept() {
  return useContext(DeptContext);
}
