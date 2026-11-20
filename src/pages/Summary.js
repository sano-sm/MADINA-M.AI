import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, downloadUrl } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Input, Select } from "@/components/kit";
import { FileText, WalletCards } from "lucide-react";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

export default function Summary() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("monthly");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [ymonth, setYmonth] = useState("all");
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    if (mode === "monthly") api.get(`/reports/monthly?month=${month}`).then((r) => setData(r.data)).catch(() => {});
    else api.get(`/reports/yearly?year=${year}${ymonth !== "all" ? `&month=${ymonth}` : ""}`).then((r) => setData(r.data)).catch(() => {});
  }, [mode, month, year, ymonth]);
  useEffect(() => { load(); }, [load]);

  const color = (tone) => tone === "green" ? "text-emerald-400" : tone === "red" ? "text-red-400" : tone === "gold" ? "gold-text" : "text-gray-200";
  const d = data || {};
  const costOfSoldItems = d.cost_of_sold_items ?? d.cogs ?? 0;
  const remainingStock = d.remaining_stock ?? d.closing_stock ?? ((d.total_purchases || 0) - costOfSoldItems);
  const salesProfitLoss = d.sales_profit_loss ?? ((d.total_sales || 0) - costOfSoldItems);
  const otherSales = d.other_sales ?? ((d.scrap_sales || 0) + (d.shokubai_sales || 0) + (d.small_sales || 0));

  const groups = [
    { h: t("purchases_hdr"), rows: [
      ["vehicle_purchases", t("vehicle_purchases"), d.vehicle_purchases, "silver"],
      ["standalone_purchases", t("standalone_purchases"), d.standalone_purchases, "silver"],
      ["spare_parts_purchases", t("spare_parts_purchases"), d.parts_purchases, "silver"],
      ["total_purchases", t("total_purchases"), d.total_purchases, "gold"],
      ["cost_of_sold_items", "Cost of Sold Items", costOfSoldItems, "silver"],
      ["remaining_stock", "Remaining Stock", remainingStock, "gold"],
    ]},
    { h: t("sales_hdr"), rows: [
      ["complete_sale", t("complete_sale"), d.complete_sales, "gold"],
      ["engine", t("engine"), d.engine_sales, "gold"],
      ["half_cut", t("half_cut"), d.halfcut_sales, "gold"],
      ["parts", t("parts"), d.parts_sales, "gold"],
      ["other_sales", "Scrap + Shokubai + Small Sales", otherSales, "gold"],
      ["total", t("total"), d.total_sales, "green"],
      ["cost_of_sold_items", "Cost of Sold Items", costOfSoldItems, "silver"],
      ["sales_profit_loss", "Sales Profit / Loss", salesProfitLoss, salesProfitLoss >= 0 ? "green" : "red"],
    ]},
    { h: t("cash_hdr"), rows: [
      ["amount_received", t("amount_received"), d.received, "green"],
      ["balance_due", t("balance_due"), d.balance_due, "red"],
    ]},
    { h: t("stock_hdr"), rows: [
      ["opening_stock", t("opening_stock"), d.opening_stock, "silver"],
      ["closing_stock", t("closing_stock"), d.closing_stock, "silver"],
      ["sales_profit_loss", "Sales Profit / Loss", salesProfitLoss, salesProfitLoss >= 0 ? "green" : "red"],
      ["expenses", t("expenses"), d.total_expenses, "red"],
      ["net_profit", t("net_profit"), d.net_profit, (d.net_profit || 0) >= 0 ? "green" : "red"],
    ]},
  ];

  const pdfUrl = mode === "monthly"
    ? downloadUrl(`/reports/monthly/pdf?month=${month}`)
    : downloadUrl(`/reports/yearly/pdf?year=${year}${ymonth !== "all" ? `&month=${ymonth}` : ""}`);

  return (
    <div>
      <PageHeader title={t("summary")} actions={<>
        {can("settings.manage") && <Btn variant="dark" data-testid="summary-cash-bank" onClick={() => navigate("/funds")}><WalletCards size={16} />{t("cash_bank")}</Btn>}
        <a href={pdfUrl} target="_blank" rel="noreferrer" data-testid="summary-download-pdf"><Btn><FileText size={16} />{t("download_pdf")}</Btn></a>
      </>} />
      <div className="mb-4 flex flex-wrap items-end gap-3 card-surface rounded-sm p-4">
        <div className="flex gap-2">{["monthly", "yearly"].map((x) => (
          <button key={x} data-testid={`sum-mode-${x}`} onClick={() => setMode(x)} className={`rounded-sm border px-4 py-2 text-sm font-medium transition-colors ${mode === x ? "gold-gradient border-transparent text-black" : "border-border text-gray-300 hover:text-white"}`}>{t(x)}</button>))}</div>
        {mode === "monthly" ? (
          <div className="w-44"><label className="mb-1 block text-xs text-muted-foreground">{t("select_month")}</label><Input type="month" data-testid="sum-month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        ) : (<>
          <div className="w-28"><label className="mb-1 block text-xs text-muted-foreground">{t("select_year")}</label><Input type="number" data-testid="sum-year" value={year} onChange={(e) => setYear(e.target.value)} /></div>
          <div className="w-40"><label className="mb-1 block text-xs text-muted-foreground">{t("select_month")}</label><Select data-testid="sum-ymonth" value={ymonth} onChange={(e) => setYmonth(e.target.value)}><option value="all">{t("full_year")}</option>{MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</Select></div>
        </>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{groups.map((g) => (
        <div key={g.h} className="card-surface rounded-sm p-5" data-testid={`sum-group-${g.h}`}><h3 className="mb-3 font-head text-lg font-bold gold-text">{g.h}</h3>{g.rows.map(([k, label, v, tone]) => (
          <div key={k} data-testid={`sum-${k}`} className="flex items-center justify-between border-b border-border py-2.5 text-sm last:border-0"><span className="text-muted-foreground">{label}</span><span className={`font-semibold ${color(tone)}`}>{money(v || 0)}</span></div>))}</div>))}</div>
    </div>
  );
}
