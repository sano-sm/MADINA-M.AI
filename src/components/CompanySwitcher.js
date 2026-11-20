import React from "react";
import { useCompany, COMPANIES } from "@/context/CompanyContext";

export function CompanySwitcher() {
  const { company, setCompany } = useCompany();
  return (
    <div className="flex items-center gap-1.5" data-testid="company-switcher">
      {COMPANIES.map((c) => {
        const active = c.id === company;
        return (
          <button
            key={c.id}
            data-testid={`company-${c.id}`}
            onClick={() => setCompany(c.id)}
            title={c.name}
            className={`flex items-center gap-1.5 rounded-full border px-2 py-1 transition-colors ${
              active
                ? "border-emerald-500/60 bg-emerald-500/10"
                : "border-border bg-[var(--surface-2)] opacity-60 hover:opacity-100"
            }`}
          >
            <img src={c.logo} alt={c.name} className="h-5 w-5 rounded-full object-cover" />
            <span className={`text-xs font-bold ${active ? "text-white" : "text-muted-foreground"}`}>{c.name}</span>
            <span
              data-testid={`company-active-${c.id}`}
              className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-gray-500"}`}
            />
          </button>
        );
      })}
    </div>
  );
}
