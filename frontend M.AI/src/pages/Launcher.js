import VehicleCatalogSearch from "@/components/VehicleCatalogSearch";
import CameraReview from "@/components/CameraReview";
import { useAiPreferences } from "@/components/AiPreferences";
import { SearchRecords } from "@/components/TradingDocuments";
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { toast } from "sonner";
import {
  Car, Disc3, ShoppingCart, Receipt, Users, Wallet, Calculator,
  UserCog, Settings as SettingsIcon, Package, Bell, Cog, Recycle,
  CalendarRange, User, Home, Clock, Plus, Search, Power, Contact,
  Landmark, Container, Menu, Languages, PiggyBank, TrendingUp,
  PieChart, ClipboardList, AlertTriangle, ChevronDown, Mic, Camera, Bot,
} from "lucide-react";

const GOLD = "#D4AF37";
const SILVER = "#C0C0C0";

const APPS = [
  { key: "purchases", route: "/purchases", icon: ShoppingCart, perm: "reports.view", color: GOLD },
  { key: "parts_inventory", route: "/parts", icon: Disc3, perm: "parts.view", color: SILVER },
  { key: "vehicles", route: "/vehicles", icon: Car, perm: "vehicles.view", color: GOLD },
  { key: "parts_sales", route: "/recovery", icon: Cog, perm: "parts.view", color: SILVER },
  { key: "vehicle_sales", route: "/vehicle-sales", icon: Receipt, perm: "finance.view", color: GOLD },
  { key: "expenses", route: "/expenses", icon: Calculator, perm: "finance.view", color: GOLD },
  { key: "stock_overview", route: "/stock", icon: Package, perm: "reports.view", color: GOLD },
  { key: "summary", route: "/summary", icon: CalendarRange, perm: "reports.view", color: GOLD },
  { key: "allocations", route: "/allocations", icon: Recycle, perm: "finance.view", color: GOLD },
  { key: "customers", route: "/customers", icon: Users, perm: "customers.view", color: GOLD },
  { key: "loans", route: "/loans", icon: Landmark, perm: "reports.view", color: GOLD },
  { key: "brokers", route: "/brokers", icon: Contact, perm: "finance.view", color: GOLD },
  { key: "users", route: "/settings?tab=users_roles", icon: UserCog, perm: "settings.view", color: GOLD },
  { key: "alerts", route: "/alerts", icon: Bell, perm: "dashboard.view", color: GOLD, badge: true },
  { key: "settings", route: "/settings?tab=company_profile", icon: SettingsIcon, perm: "settings.view", color: GOLD },
  { key: "container_tt", route: "/container", icon: Container, perm: "finance.view", color: GOLD },
];

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function Launcher() {
  const navigate = useNavigate();
  const { prefs } = useAiPreferences();
  const { user, can, logout } = useAuth();
  const { t, tOther, lang, setLang } = useI18n();
  const { settings, money } = useSettings();
  const [stats, setStats] = useState(null);
  const [biz, setBiz] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [series, setSeries] = useState([]);
  const [period, setPeriod] = useState("month");
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const monthStr = new Date().toISOString().slice(0, 7);
  const yearStr = monthStr.slice(0, 4);

  useEffect(() => {
    if (!can("dashboard.view")) return;
    api.get("/dashboard").then((r) => setStats(r.data)).catch(() => {});
    api.get("/alerts").then((r) => setAlerts(r.data)).catch(() => {});
  }, [can]);

  useEffect(() => {
    if (!can("reports.view")) return;
    const url = period === "month" ? `/reports/monthly?month=${monthStr}` : `/reports/yearly?year=${yearStr}`;
    api.get(url).then((r) => setBiz(r.data)).catch(() => {});
  }, [can, period, monthStr, yearStr]);

  useEffect(() => {
    if (!can("reports.view")) return;
    const now = new Date();
    const months = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ label: MONTH_LABELS[d.getMonth()], ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` });
    }
    Promise.all(months.map((m) => api.get(`/reports/monthly?month=${m.ym}`).then((r) => ({ label: m.label, value: r.data.total_sales || 0 })).catch(() => ({ label: m.label, value: 0 }))))
      .then(setSeries);
  }, [can]);

  const apps = APPS.filter((a) => can(a.perm));
  const alertCount = stats?.alerts_count || 0;

  const openApp = (a) => {
    if (a.route === "__soon__") { toast.info(t("coming_soon")); return; }
    setMenuOpen(false); navigate(a.route);
  };

  const quickAdd = [
    can("vehicles.edit") && { key: "new_vehicle", route: "/vehicles", icon: Car },
    can("parts.edit") && { key: "new_part", route: "/parts", icon: Disc3 },
    can("finance.edit") && { key: "new_sale", route: "/vehicle-sales", icon: Receipt },
    can("finance.edit") && { key: "new_payment", route: "/customers", icon: Wallet },
  ].filter(Boolean);

  const bottom = [
    { key: "home", icon: Home, onClick: () => navigate("/"), active: true },
    { key: "activity", icon: Clock, onClick: () => navigate("/audit") },
    { key: "container_tt", icon: Container, onClick: () => navigate("/container") },
    { key: "logout", icon: Power, onClick: () => { logout(); navigate("/login"); } },
  ];

  const bizCards = [
    { key: "total_purchases", icon: PiggyBank, color: "#34d399", value: biz?.total_purchases },
    { key: "total_sales", icon: TrendingUp, color: "#34d399", value: biz?.total_sales },
    { key: "amount_received", icon: Wallet, color: "#38bdf8", value: biz?.received },
    { key: "customer_balance", icon: Users, color: "#f87171", value: stats?.outstanding },
    { key: "net_profit", icon: PieChart, color: "#a78bfa", value: biz?.net_profit },
  ];

  const [searchOpen,setSearchOpen] = useState(false);
  const [voiceKind,setVoiceKind] = useState(null);
  const [cameraOpen,setCameraOpen] = useState(false);
  const [catalogOpen,setCatalogOpen] = useState(false);
  const maxSale = Math.max(1, ...series.map((s) => s.value));

  return (
    <div className="mx-auto w-full max-w-5xl overflow-x-hidden px-3 pb-28">

      {cameraOpen && <CameraReview onClose={()=>setCameraOpen(false)} />}
      {catalogOpen && <VehicleCatalogSearch onClose={()=>setCatalogOpen(false)} />}
      {searchOpen && <SearchRecords close={() => setSearchOpen(false)} navigate={navigate} />}
      {/* Top utility bar */}
      <div className="relative mb-2 flex items-center justify-between gap-2 pt-1 animate-fade-up">
        <button data-testid="home-menu-btn" onClick={() => setMenuOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[var(--surface-2)] text-white hover:border-[var(--gold)]">
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <div className="flex items-center rounded-full border border-white/10 bg-[var(--surface-2)] p-0.5">
            {["en", "ur"].map((l) => (
              <button key={l} data-testid={`lang-${l}`} onClick={() => setLang(l)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${lang === l ? "gold-gradient text-black" : "text-muted-foreground"}`}>
                <Languages size={13} />{l === "en" ? "English" : "اردو"}
              </button>
            ))}
          </div>
          <CompanySwitcher />
        </div>
        <button data-testid="home-search-btn" onClick={() => setSearchOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[var(--surface-2)] text-white hover:border-[var(--gold)]">
          <Search size={20} />
        </button>

        
        {menuOpen && (
          <div data-testid="home-menu" className="absolute start-0 top-12 z-50 grid w-64 grid-cols-2 gap-1 rounded-xl border border-white/10 bg-[var(--surface-2)] p-2 shadow-2xl">
            {apps.map((a) => (
              <button key={a.key} data-testid={`menu-${a.key}`} onClick={() => openApp(a)}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-white hover:bg-white/10">
                <a.icon size={16} style={{ color: a.color }} />{t(a.key)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Brand header */}
      <div className="mb-3 flex items-center justify-between gap-3 animate-fade-up">
        <div className="flex items-start gap-1">
        <button data-testid="home-owner-avatar" onClick={() => can("settings.manage") ? navigate("/owner") : (can("settings.view") && navigate("/settings?tab=users_roles"))}
          className="flex flex-col items-center gap-0.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--gold)]/50 bg-[var(--surface-2)]">
            <User size={20} className="gold-text" />
          </span>
          <span className="text-[9px] gold-text">{user?.role}</span>
        </button>
        {prefs.master && prefs.camera && <button type="button" title="Camera privacy review" aria-label="Camera privacy review" onClick={() => setCameraOpen(true)} className="mt-2 rounded-full border border-white/20 p-1.5 text-gray-300"><Camera size={15}/></button>}
          <button type="button" data-testid="catalog-search-btn" title="Model / Engine Lookup" aria-label="Model / Engine Lookup" onClick={() => setCatalogOpen(true)} className="mt-2 rounded-full border border-white/20 p-1.5 text-gray-300"><Search size={15}/></button>
        </div>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate font-head text-lg font-black leading-tight gold-text sm:text-2xl">{settings?.name || t("app_name")}</h1>
          <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{t("system_subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {prefs.master && prefs.agent && <button type="button" title="AI - External Agent" aria-label="AI - External Agent" onClick={() => window.dispatchEvent(new CustomEvent("mai:open", { detail: { kind: "agent" } }))} className={`rounded-full border p-1 text-gray-300 ${voiceKind==="agent"?"border-emerald-400 text-emerald-300 animate-pulse":"border-white/20"}`}><Mic size={15}/><span className="block text-[8px] font-bold leading-none">AI</span></button>}
          {prefs.master && prefs.voice && <button type="button" title="MAI - Madina Assistant" aria-label="MAI - Madina Assistant" onClick={() => window.dispatchEvent(new CustomEvent("mai:open", { detail: { kind: "voice" } }))} className={`rounded-full border p-1 text-gray-300 ${voiceKind==="voice"?"border-emerald-400 text-emerald-300 animate-pulse":"border-white/20"}`}><Mic size={15}/><span className="block text-[8px] font-bold leading-none">MAI</span></button>}
          <img src={settings?.logo_url || "/logo.png"} alt="MTC" className="h-11 w-11 rounded-xl object-cover ring-1 ring-[var(--gold)]/40 sm:h-12 sm:w-12" />
        </div>
      </div>

      {/* Top stats */}
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/5 bg-white/5 sm:grid-cols-4 animate-fade-up">
          <TopStat icon={Car} color={GOLD} label="MTC Vehicles" sub="MTC گاڑیاں" value={stats.purchase_company_counts?.MTC?.vehicles || 0} />
          <TopStat icon={Disc3} color={SILVER} label="MTC Parts" sub="MTC پارٹس" value={stats.purchase_company_counts?.MTC?.parts || 0} />
          <TopStat icon={Car} color={GOLD} label="TSK Vehicles" sub="TSK گاڑیاں" value={stats.purchase_company_counts?.TSK?.vehicles || 0} />
          <TopStat icon={Disc3} color={SILVER} label="TSK Parts" sub="TSK پارٹس" value={stats.purchase_company_counts?.TSK?.parts || 0} />
        </div>
      )}

      {/* Quick Access */}
      <SectionTitle en={t("quick_access")} ur={tOther("quick_access")} />
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 sm:gap-2 lg:grid-cols-8">
        {apps.map((a, i) => (
          <button key={a.key} data-testid={`app-${a.key}`} onClick={() => openApp(a)}
            className="stat-card relative flex flex-col items-center justify-center gap-1 rounded-xl border border-white/5 px-1 py-2.5 animate-fade-up"
            style={{ background: "linear-gradient(160deg,#1c1c1f 0%,#141416 100%)", animationDelay: `${i * 25}ms`, boxShadow: "0 4px 12px rgba(0,0,0,0.45)" }}>
            {a.badge && alertCount > 0 && (
              <span data-testid="alerts-badge" className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">{alertCount}</span>
            )}
            <a.icon size={22} style={{ color: a.color }} strokeWidth={1.7} />
            <div className="text-center leading-tight">
              <div className="text-[10px] font-semibold text-white sm:text-[11px]">{a.key === "expenses" ? "Expenses & Shipping" : t(a.key)}</div>
              <div className="text-[9px] font-semibold text-emerald-400">{tOther(a.key)}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Business Overview */}
      {can("reports.view") && (
        <>
          <div className="mt-5 mb-2 flex items-center justify-between">
            <SectionTitle en={t("business_overview")} ur={tOther("business_overview")} noMargin />
            <div className="relative">
              <select data-testid="biz-period" value={period} onChange={(e) => setPeriod(e.target.value)}
                className="appearance-none rounded-xl border border-white/10 bg-[var(--surface-2)] py-2 ps-3 pe-8 text-sm text-white outline-none">
                <option value="month">{t("this_month")}</option>
                <option value="year">{t("this_year")}</option>
              </select>
              <ChevronDown size={15} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {bizCards.map((c) => (
              <div key={c.key} data-testid={`biz-${c.key}`} className="card-surface flex flex-col items-center gap-1.5 rounded-2xl border border-white/5 p-4 text-center">
                <c.icon size={26} style={{ color: c.color }} />
                <div className="text-xs text-muted-foreground">{t(c.key)}</div>
                <div className="font-head text-base font-black" style={{ color: c.color }}>{money(c.value || 0)}</div>
                <div className="text-[10px] text-[var(--gold)]/70">{tOther(c.key)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Charts + Activity */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {can("reports.view") && (
          <div className="card-surface rounded-2xl border border-white/5 p-4">
            <SectionTitle en={t("monthly_sales_overview")} ur={tOther("monthly_sales_overview")} small />
            <div className="mt-4 flex h-44 items-end justify-between gap-1.5">
              {series.map((s, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5" data-testid={`chart-bar-${s.label}`}>
                  <div className="flex w-full items-end justify-center" style={{ height: "140px" }}>
                    <div className="w-full max-w-[26px] rounded-t-md gold-gradient transition-all"
                      style={{ height: `${Math.max(4, (s.value / maxSale) * 140)}px` }} title={money(s.value)} />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {stats && (
          <div className="card-surface rounded-2xl border border-white/5 p-4">
            <div className="flex items-center justify-between">
              <SectionTitle en={t("recent_activities")} ur={tOther("recent_activities")} small />
              <button data-testid="activity-view-all" onClick={() => navigate("/audit")} className="text-xs text-[var(--gold)] hover:underline">{t("view_all")}</button>
            </div>
            <div className="mt-3 space-y-2">
              {(stats.recent_activity || []).slice(0, 5).map((a, i) => (
                <div key={i} className="flex items-start gap-3 border-b border-white/5 pb-2 last:border-0">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--gold)]/10">
                    <ClipboardList size={15} className="gold-text" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">{a.details || `${a.action || ""} ${a.entity || ""}`.trim()}</div>
                    <div className="text-[11px] text-muted-foreground">{a.user_name || "—"}</div>
                  </div>
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">{relTime(a.timestamp)}</span>
                </div>
              ))}
              {(!stats.recent_activity || stats.recent_activity.length === 0) && (
                <div className="py-4 text-center text-sm text-muted-foreground">{t("no_data")}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Reminders & Alerts */}
      {alerts && (
        <>
          <SectionTitle en={t("reminders_alerts")} ur={tOther("reminders_alerts")} className="mt-5" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Reminder icon={Users} tone="#f87171" count={alerts.overdue?.length || 0} title={t("payment_overdue")} onClick={() => navigate("/customers")} testid="rem-overdue" />
            <Reminder icon={Package} tone="#34d399" count={alerts.low_stock?.length || 0} title={t("low_stock")} onClick={() => navigate("/alerts")} testid="rem-lowstock" />
            <Reminder icon={Wallet} tone="#38bdf8" count={money(stats?.outstanding || 0)} title={t("outstanding")} onClick={() => navigate("/customers")} testid="rem-outstanding" />
            <Reminder icon={AlertTriangle} tone={GOLD} count={alertCount} title={t("alerts")} onClick={() => navigate("/alerts")} testid="rem-alerts" />
          </div>
        </>
      )}

      {/* Bottom tab bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[var(--surface)]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-end justify-between px-8 py-2">
          {bottom.slice(0, 2).map((b) => <TabBtn key={b.key} b={b} t={t} />)}
          <div className="relative">
            {addOpen && quickAdd.length > 0 && (
              <div data-testid="quick-add-menu" className="absolute bottom-16 start-1/2 z-50 w-40 -translate-x-1/2 rounded-sm border border-border bg-[var(--surface-2)] p-1 shadow-xl rtl:translate-x-1/2">
                {quickAdd.map((q) => (
                  <button key={q.key} data-testid={`quick-${q.key}`} onClick={() => { setAddOpen(false); navigate(q.route); }}
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-white hover:bg-white/10">
                    <q.icon size={16} className="gold-text" />{t(q.key)}
                  </button>
                ))}
              </div>
            )}
            <button data-testid="home-fab" onClick={() => setAddOpen((v) => !v)}
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full gold-gradient text-black shadow-[0_6px_16px_rgba(212,175,55,0.5)] active:scale-90">
              <Plus size={28} className={addOpen ? "rotate-45" : ""} style={{ transition: "transform .15s" }} />
            </button>
          </div>
          {bottom.slice(2).map((b) => <TabBtn key={b.key} b={b} t={t} />)}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ en, ur, small, noMargin, className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${noMargin ? "" : "mb-2"} ${className}`}>
      <h2 className={`font-head font-black text-white ${small ? "text-base" : "text-lg"}`}>{en}</h2>
      <span className="text-sm text-[var(--gold)]/70">{ur}</span>
    </div>
  );
}

function TopStat({ icon: Icon, color, label, sub, value, valueClass = "text-white" }) {
  return (
    <div className="flex items-center gap-2.5 bg-[var(--surface)] p-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: `${color}55` }}>
        <Icon size={17} style={{ color }} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[10px] text-muted-foreground">{label}</div>
        <div className={`font-head text-base font-black leading-tight ${valueClass}`}>{value}</div>
        <div className="truncate text-[9px] text-[var(--gold)]/70">{sub}</div>
      </div>
    </div>
  );
}

function Reminder({ icon: Icon, tone, count, title, onClick, testid }) {
  return (
    <button data-testid={testid} onClick={onClick}
      className="card-surface flex items-center gap-3 rounded-2xl border border-white/5 p-3 text-start transition-colors hover:border-[var(--gold)]/40">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${tone}1a` }}>
        <Icon size={18} style={{ color: tone }} />
      </span>
      <div className="min-w-0">
        <div className="font-head text-sm font-black text-white">{count}</div>
        <div className="truncate text-[11px] text-muted-foreground">{title}</div>
      </div>
    </button>
  );
}

function TabBtn({ b, t }) {
  return (
    <button data-testid={`tab-${b.key}`} onClick={b.onClick}
      className={`flex flex-col items-center gap-1 ${b.active ? "gold-text" : "text-muted-foreground hover:text-white"}`}>
      <b.icon size={20} />
      <span className="text-[10px]">{t(b.key)}</span>
    </button>
  );
}

function relTime(ts) {
  if (!ts) return "";
  const then = new Date(ts).getTime();
  if (isNaN(then)) return "";
  const s = Math.floor((Date.now() - then) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
