import React, { createContext, useContext, useState } from "react";

export const COMPANIES = [
  { id: "MTC", name: "MTC", logo: "/logo.png" },
  { id: "TSK", name: "TSK", logo: "/logo-tsk.png" },
];

const CompanyContext = createContext(null);
export const useCompany = () => useContext(CompanyContext);

export function CompanyProvider({ children }) {
  const stored = localStorage.getItem("mtc_company") || "MTC";
  if (!localStorage.getItem("mtc_company")) localStorage.setItem("mtc_company", "MTC");
  const [company] = useState(stored);

  // Switching does a full reload so every query re-runs with the new company header
  // and no records from the other company are ever briefly shown.
  const setCompany = (id) => {
    if (id === company) return;
    localStorage.setItem("mtc_company", id);
    window.location.assign("/");
  };

  return (
    <CompanyContext.Provider value={{ company, companies: COMPANIES, setCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}
