import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

const SettingsContext = createContext(null);
export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [theme, setThemeState] = useState(() => {
    try { return ["black", "white", "navy"].includes(localStorage.getItem("madina-ui-theme")) ? localStorage.getItem("madina-ui-theme") : "black"; }
    catch { return "black"; }
  });
  const setTheme = useCallback((next) => {
    if (!["black", "white", "navy"].includes(next)) return;
    setThemeState(next);
    try { localStorage.setItem("madina-ui-theme", next); } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.setAttribute("data-madina-theme", theme);
  }, [theme]);

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
    <SettingsContext.Provider value={{ settings, reload: load, money, theme, setTheme }}>
      {children}
    </SettingsContext.Provider>
  );
}
