import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader } from "@/components/kit";
import { Car, Disc3, Cog, Recycle, Package } from "lucide-react";

export default function Stock() {
  const { t } = useI18n();
  const { money } = useSettings();
  const [s, setS] = useState(null);

  useEffect(() => { api.get("/reports/stock").then((r) => setS(r.data)).catch(() => {}); }, []);

  const cards = s ? [
    { icon: Car, label: t("in_stock_vehicles"), qty: s.vehicles_count, value: s.vehicles_value },
    { icon: Disc3, label: t("available_parts"), qty: s.parts_count, value: s.parts_value },
    { icon: Cog, label: t("available_engines_hcuts"), qty: null, value: s.standalone_value },
    { icon: Recycle, label: t("dismantled_remaining"), qty: null, value: s.dismantled_remaining },
  ] : [];

  return (
    <div>
      <PageHeader title={t("stock")} />
      <div className="mb-4 card-surface rounded-sm p-5" data-testid="stock-total">
        <div className="flex items-center gap-3">
          <Package className="text-[var(--gold)]" size={28} />
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("total_stock_value")}</div>
            <div className="font-head text-3xl font-bold gold-text">{s ? money(s.total_value) : "…"}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t("stock_at_cost")}</div>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c, i) => (
          <div key={i} data-testid={`stock-card-${i}`} className="card-surface flex items-center justify-between rounded-sm p-4">
            <div className="flex items-center gap-3">
              <c.icon className="text-[var(--gold)]" size={20} />
              <div>
                <div className="text-sm text-white">{c.label}</div>
                {c.qty !== null && <div className="text-xs text-muted-foreground">{c.qty} {t("units")}</div>}
              </div>
            </div>
            <div className="font-semibold text-white">{money(c.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
