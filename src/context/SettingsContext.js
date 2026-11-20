import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

const SettingsContext = createContext(null);
export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);

  const load = useCallback(() => {
    api.get("/settings").then((r) => setSettings(r.data)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const money = useCallback((n) => {
    const sym = settings?.currency_symbol || "¥";
    const val = Number(n || 0);
    return `${sym}${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }, [settings]);

  return (
    <SettingsContext.Provider value={{ settings, reload: load, money }}>
      {children}
    </SettingsContext.Provider>
  );
}
