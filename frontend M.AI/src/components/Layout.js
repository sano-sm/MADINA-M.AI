import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { useAiPreferences } from "@/components/AiPreferences";
import {
  LayoutDashboard, LayoutGrid, Car, Wrench, Users, Receipt, Calculator, FileBarChart,
  Settings as SettingsIcon, LogOut, Languages, Menu, X, History, Mic,
} from "lucide-react";

const NAV = [
  { to: "/", key: "home", icon: LayoutGrid, perm: "dashboard.view" },
  { to: "/dashboard", key: "dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
  { to: "/vehicles", key: "vehicles", icon: Car, perm: "vehicles.view" },
  { to: "/parts", key: "parts", icon: Wrench, perm: "parts.view" },
  { to: "/customers", key: "customers", icon: Users, perm: "customers.view" },
  { to: "/vehicle-sales", key: "vehicle_sales", icon: Receipt, perm: "finance.view" },
  { to: "/expenses", key: "expenses", icon: Calculator, perm: "finance.view" },
  { to: "/reports", key: "reports", icon: FileBarChart, perm: "reports.view" },
  { to: "/audit", key: "audit", icon: History, perm: "reports.view" },
  { to: "/settings", key: "settings", icon: SettingsIcon, perm: "settings.view" },
];

export default function Layout({ children }) {
  const { user, logout, can } = useAuth();
  const { t, toggle, lang } = useI18n();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [voiceKind, setVoiceKind] = useState(null);
  const { prefs } = useAiPreferences();

  const items = NAV.filter((n) => can(n.perm));
  const logo = settings?.logo_url || "/logo.png";

  const doLogout = () => { logout(); navigate("/login"); };

  const SidebarContent = () => (
    <>
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <img src={logo} alt="MTC" className="h-11 w-11 rounded-sm object-cover" />
        <div>
          <div className="font-head text-sm font-bold leading-tight gold-text">{settings?.name || "Madina Trading Co."}</div>
          <div className="text-[10px] text-muted-foreground">Import · Export · Auto · Parts</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={() => setOpen(false)}
            data-testid={`nav-${n.key}`}
            className={({ isActive }) =>
              `nav-link flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium ${
                isActive ? "gold-gradient text-black" : "text-gray-300 hover:bg-[var(--surface-2)] hover:text-white"
              }`}>
            <n.icon size={18} className="rtl:rotate-0" />
            <span>{t(n.key)}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <div className="mb-2 px-2 text-xs text-muted-foreground">
          {user?.name} · <span className="gold-text">{user?.role}</span>
        </div>
        <button onClick={doLogout} data-testid="logout-btn"
          className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-sm text-gray-300 hover:bg-destructive hover:text-white">
          <LogOut size={18} /> {t("logout")}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-col border-e border-border bg-[var(--surface)] md:flex">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-64 flex-col bg-[var(--surface)]">
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-[var(--surface)]/85 px-4 py-3 backdrop-blur-xl">
          <button className="md:hidden text-white" onClick={() => setOpen(!open)} data-testid="mobile-menu">
            {open ? <X /> : <Menu />}
          </button>
          <div className="hidden md:block text-sm text-muted-foreground">{t("welcome")}, <span className="text-white">{user?.name}</span></div>
          <div className="flex items-center gap-2">
            <CompanySwitcher />
            {prefs.master && prefs.agent && <button type="button" title="AI" aria-label="AI voice assistant" onClick={() => window.dispatchEvent(new CustomEvent("madina:toggle-voice", {detail:{kind:"agent"}}))} className={`rounded-full border p-1 text-gray-300 ${voiceKind === "agent" ? "border-emerald-400 text-emerald-300 animate-pulse" : "border-white/20"}`}><Mic size={15} /><span className="block text-[8px] font-bold leading-none">AI</span></button>}
            {prefs.master && prefs.voice && <button type="button" title="MAI" aria-label="MAI voice assistant" onClick={() => window.dispatchEvent(new CustomEvent("madina:toggle-voice", {detail:{kind:"voice"}}))} className={`rounded-full border p-1 text-gray-300 ${voiceKind === "voice" ? "border-emerald-400 text-emerald-300 animate-pulse" : "border-white/20"}`}><Mic size={15} /><span className="block text-[8px] font-bold leading-none">MAI</span></button>}
            <button onClick={toggle} data-testid="lang-toggle"
              className="flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-sm text-white hover:border-[var(--gold)]">
              <Languages size={16} /> {lang === "en" ? "اردو" : "English"}
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
