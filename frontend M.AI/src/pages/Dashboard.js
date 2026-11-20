import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader } from "@/components/kit";
import { TrendingUp, Wallet, Boxes, Car, Users, AlertCircle, Wrench } from "lucide-react";

function Stat({ icon: Icon, label, subtitle, value, tone = "gold", i }) {
  const color = { gold: "text-[var(--gold)]", green: "text-emerald-400", red: "text-red-400", silver: "text-gray-300" }[tone];
  return (
    <div className="stat-card card-surface rounded-sm p-5 animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          {subtitle && <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>}
        </div>
        <Icon size={18} className={color} />
      </div>
      <div className={`mt-3 font-head text-2xl font-black ${color}`}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const { money } = useSettings();
  const [d, setD] = useState(null);

  useEffect(() => { api.get("/dashboard").then((r) => setD(r.data)).catch(() => {}); }, []);

  if (!d) return <div className="text-muted-foreground">Loading...</div>;
  const { pnl, stock, vehicles } = d;
  const companyCounts = d.purchase_company_counts || {};
  const mtc = companyCounts.MTC || { vehicles: 0, parts: 0 };
  const tsk = companyCounts.TSK || { vehicles: 0, parts: 0 };

  return (
    <div>
      <PageHeader title={t("dashboard")} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat i={0} icon={Car} label="MTC Vehicles" value={mtc.vehicles || 0} tone="gold" />
        <Stat i={1} icon={Boxes} label="MTC Parts" value={mtc.parts || 0} tone="gold" />
        <Stat i={2} icon={Car} label="TSK Vehicles" value={tsk.vehicles || 0} tone="silver" />
        <Stat i={3} icon={Boxes} label="TSK Parts" value={tsk.parts || 0} tone="silver" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat i={4} icon={TrendingUp} label="Net Profit" subtitle="خالص منافع" value={money(pnl.net_profit)} tone={pnl.net_profit >= 0 ? "green" : "red"} />
        <Stat i={5} icon={Wallet} label="Sales Revenue" subtitle="فروخت کی آمدنی" value={money(pnl.sales_revenue)} tone="gold" />
        <Stat i={6} icon={Boxes} label="Inventory Value" subtitle="موجودہ اسٹاک کی مالیت" value={money(stock.total_value)} tone="silver" />
        <Stat i={7} icon={AlertCircle} label="Customer Receivable" subtitle="کسٹمر سے لینا باقی" value={money(d.outstanding)} tone={d.outstanding > 0 ? "red" : "green"} />
        <Stat i={8} icon={Car} label={t("in_stock")} value={vehicles.in_stock} tone="gold" />
        <Stat i={9} icon={Car} label={t("sold")} value={vehicles.sold} tone="green" />
        <Stat i={10} icon={Wrench} label={t("dismantled")} value={vehicles.dismantled} tone="silver" />
        <Stat i={11} icon={Users} label={t("customers")} value={d.customers} tone="gold" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card-surface rounded-sm p-5">
          <h3 className="mb-4 font-head text-lg font-bold gold-text">{t("profit_loss")}</h3>
          {[["sales_revenue", pnl.sales_revenue, "green"], ["cogs", pnl.cogs, "silver"],
            ["gross_profit", pnl.gross_profit, "gold"], ["expenses", pnl.expenses, "red"],
            ["salaries", pnl.salaries, "red"], ["net_profit", pnl.net_profit, "green"]].map(([k, v, tone]) => (
            <div key={k} className="flex items-center justify-between border-b border-border py-2 text-sm">
              <span className="text-muted-foreground">{t(k)}</span>
              <span className={`font-semibold ${tone === "green" ? "text-emerald-400" : tone === "red" ? "text-red-400" : tone === "gold" ? "gold-text" : "text-gray-300"}`}>{money(v)}</span>
            </div>
          ))}
        </div>
        <div className="card-surface rounded-sm p-5">
          <h3 className="mb-4 font-head text-lg font-bold gold-text">{t("recent_activity")}</h3>
          {d.recent_activity.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("no_data")}</div>
          ) : d.recent_activity.map((a) => (
            <div key={a.id} className="border-b border-border py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="gold-text font-medium">{a.action} · {a.entity}</span>
                <span className="text-xs text-muted-foreground">{a.timestamp.slice(0, 16).replace("T", " ")}</span>
              </div>
              <div className="text-xs text-muted-foreground">{a.details} — {a.user_name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
