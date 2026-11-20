import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader, Empty, Badge } from "@/components/kit";
import { AlertTriangle, PackageX, UserX } from "lucide-react";

export default function Alerts() {
  const { t } = useI18n();
  const { money } = useSettings();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  useEffect(() => { api.get("/alerts").then((r) => setData(r.data)).catch(() => {}); }, []);

  return (
    <div>
      <PageHeader title={t("alerts")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-surface rounded-sm">
          <div className="flex items-center gap-2 border-b border-border p-3 font-head font-bold gold-text">
            <PackageX size={18} /> {t("low_stock")}
          </div>
          {!data ? <Empty text="..." /> : data.low_stock.length === 0 ? <Empty text={t("no_alerts")} /> :
            data.low_stock.map((p) => (
              <button key={p.id} data-testid={`alert-part-${p.id}`} onClick={() => navigate("/parts")}
                className="flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-sm hover:bg-white/5">
                <span>{p.name} <span className="text-muted-foreground">{p.part_number ? `[${p.part_number}]` : ""}</span></span>
                <Badge tone={p.quantity === 0 ? "red" : "gold"}>{t("quantity")}: {p.quantity}</Badge>
              </button>))}
        </div>
        <div className="card-surface rounded-sm">
          <div className="flex items-center gap-2 border-b border-border p-3 font-head font-bold gold-text">
            <UserX size={18} /> {t("overdue")}
          </div>
          {!data ? <Empty text="..." /> : data.overdue.length === 0 ? <Empty text={t("no_alerts")} /> :
            data.overdue.map((c) => (
              <button key={c.id} data-testid={`alert-customer-${c.id}`} onClick={() => navigate("/customers")}
                className="flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-sm hover:bg-white/5">
                <span>{c.name} <span className="text-muted-foreground">{c.phone}</span></span>
                <Badge tone="red">{money(c.outstanding)}</Badge>
              </button>))}
        </div>
      </div>
      {data && data.count === 0 && (
        <div className="mt-6 flex items-center justify-center gap-2 text-emerald-400">
          <AlertTriangle size={18} /> {t("all_clear")}
        </div>
      )}
    </div>
  );
}
