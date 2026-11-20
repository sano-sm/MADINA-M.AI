import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";

// Compact "this month" purchase box. kind: "vehicles" | "parts"
export function PurchaseBox({ kind }) {
  const { t } = useI18n();
  const { money } = useSettings();
  const [d, setD] = useState(null);
  const month = new Date().toISOString().slice(0, 7);

  useEffect(() => { api.get(`/reports/monthly?month=${month}`).then((r) => setD(r.data)).catch(() => {}); }, [month]);
  if (!d) return null;

  const count = kind === "vehicles" ? d.vehicles_purchased : d.parts_count_purchased;
  const cost = kind === "vehicles" ? d.vehicle_purchases : d.parts_purchases;

  return (
    <div className="mb-4 flex flex-wrap gap-3" data-testid={`purchase-box-${kind}`}>
      <div className="card-surface rounded-sm px-4 py-2">
        <div className="text-xs text-muted-foreground">{t("this_month")} · {t("purchased_count")}</div>
        <div className="font-head text-lg font-bold gold-text">{count != null ? count : "—"}</div>
      </div>
      <div className="card-surface rounded-sm px-4 py-2">
        <div className="text-xs text-muted-foreground">{t("this_month")} · {t("purchase_cost")}</div>
        <div className="font-head text-lg font-bold gold-text">{money(cost || 0)}</div>
      </div>
    </div>
  );
}
