import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader } from "@/components/kit";
import { Car, Cog, Disc3, ShoppingCart } from "lucide-react";

export default function Purchases() {
  const { t } = useI18n();
  const { money } = useSettings();
  const now = new Date();
  const [mode, setMode] = useState("month");
  const [month, setMonth] = useState(now.toISOString().slice(0, 7));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [d, setD] = useState(null);

  const load = useCallback(() => {
    const url = mode === "month" ? `/reports/monthly?month=${month}` : `/reports/yearly?year=${year}`;
    api.get(url).then((r) => setD(r.data)).catch(() => {});
  }, [mode, month, year]);
  useEffect(() => { load(); }, [load]);

  const rows = d ? [
    { icon: Car, label: t("vehicle_purchases"), qty: d.vehicles_purchased, value: d.vehicle_purchases },
    { icon: Cog, label: t("standalone_purchases"), qty: null, value: d.standalone_purchases },
    { icon: Disc3, label: t("parts_purchases"), qty: null, value: d.parts_purchases },
  ] : [];

  return (
    <div>
      <PageHeader title={t("purchases")} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-sm border border-border">
          <button data-testid="pur-mode-month" onClick={() => setMode("month")}
            className={`px-3 py-1.5 text-sm ${mode === "month" ? "gold-gradient text-black" : "text-gray-300"}`}>{t("monthly")}</button>
          <button data-testid="pur-mode-year" onClick={() => setMode("year")}
            className={`px-3 py-1.5 text-sm ${mode === "year" ? "gold-gradient text-black" : "text-gray-300"}`}>{t("yearly")}</button>
        </div>
        {mode === "month"
          ? <input type="month" data-testid="pur-month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="rounded-sm border border-input bg-[var(--surface-2)] px-3 py-1.5 text-sm text-white outline-none" />
          : <input type="number" data-testid="pur-year" value={year} onChange={(e) => setYear(e.target.value)}
              className="w-28 rounded-sm border border-input bg-[var(--surface-2)] px-3 py-1.5 text-sm text-white outline-none" />}
      </div>

      <div className="mb-4 card-surface rounded-sm p-5" data-testid="purchase-total">
        <div className="flex items-center gap-3">
          <ShoppingCart className="text-[var(--gold)]" size={28} />
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("total_purchases")}</div>
            <div className="font-head text-3xl font-bold gold-text">{d ? money(d.total_purchases) : "…"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t("purchase_cost_only")}</div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {rows.map((c, i) => (
          <div key={i} data-testid={`purchase-card-${i}`} className="card-surface rounded-sm p-4">
            <div className="flex items-center gap-2"><c.icon className="text-[var(--gold)]" size={18} /><span className="text-sm text-white">{c.label}</span></div>
            {c.qty !== null && <div className="mt-1 text-xs text-muted-foreground">{c.qty} {t("units")}</div>}
            <div className="mt-2 font-semibold text-white">{money(c.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
