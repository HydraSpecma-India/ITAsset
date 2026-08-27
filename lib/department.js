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
  const [dept, setDeptState] = useState("IT");

  const isGlobalUser =
    (profile?.role === "admin" && (profile?.department === "All" || !profile?.department || profile?.department === "IT")) ||
    profile?.role === "global_reader" ||
    profile?.role === "viewer";

  const isDeptAdmin =
    profile?.role === "admin" ||
    (profile?.role === "dept_admin" && profile?.department);

  useEffect(() => {
    if (!profile) return;
    const userDept = profile?.department;
    const saved = typeof window !== "undefined" ? localStorage.getItem("itbm_selected_dept") : null;

    if (isGlobalUser) {
      if (saved && (DEPARTMENTS.includes(saved) || saved === "All")) {
        setDeptState(saved);
      } else {
        setDeptState(userDept && DEPARTMENTS.includes(userDept) ? userDept : "IT");
      }
    } else if (userDept && DEPARTMENTS.includes(userDept)) {
      setDeptState(userDept);
      if (typeof window !== "undefined") {
        localStorage.setItem("itbm_selected_dept", userDept);
      }
    }
  }, [profile, isGlobalUser]);

  const setDept = (newDept) => {
    setDeptState(newDept);
    if (typeof window !== "undefined") {
      localStorage.setItem("itbm_selected_dept", newDept);
    }
  };

  const availableDepts = isGlobalUser
    ? ["All", ...DEPARTMENTS]
    : [profile?.department || "IT"];

  return (
    <DeptContext.Provider
      value={{
        dept,
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
