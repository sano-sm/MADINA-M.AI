import React, { useEffect, useState, useCallback } from "react";
import { api, downloadUrl } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader, Btn, Field, Input } from "@/components/kit";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText, DatabaseBackup, Car, Package, Users, Receipt, Wallet, Wrench, Recycle, Coins, Banknote, X } from "lucide-react";

const EXPORTS = [
  ["vehicles", "vehicles"], ["parts", "parts"], ["customers", "customers"],
  ["invoices", "invoices"], ["payments", "payments"], ["expenses", "expenses"],
  ["tracked_parts", "engine_halfcut"], ["scrap_allocations", "scrap"],
  ["shokubai_allocations", "shokubai"], ["salaries", "salaries"],
];

const RECORD_ICONS = [Car, Package, Users, Receipt, Wallet, Banknote, Wrench, Recycle, Coins, Users];
const RECORD_NAMES = ["Vehicles", "Spare Parts", "Customers", "Invoices", "Payments", "Expenses", "Engine / Half Cut", "Scrap", "Shokubai", "Salaries"];

export default function Reports() {
  const { t } = useI18n();
  const { money } = useSettings();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const openPdf = async (path, name) => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await api.get(path, {responseType:"blob"});
      if (!response.data.type.includes("pdf")) throw new Error("Not a PDF");
      setPreview({url:URL.createObjectURL(response.data), name});
    } catch (e) { toast.error("Unable to open PDF report"); }
    finally { setBusy(false); }
  };
  const [pnl, setPnl] = useState(null);
  const [stock, setStock] = useState(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rMonth, setRMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rYear, setRYear] = useState(String(new Date().getFullYear()));

  const loadPnl = useCallback(() => {
    const qs = [];
    if (start) qs.push(`start=${start}`);
    if (end) qs.push(`end=${end}`);
    api.get(`/reports/pnl${qs.length ? `?${qs.join("&")}` : ""}`).then((r) => setPnl(r.data));
  }, [start, end]);

  useEffect(() => { loadPnl(); api.get("/reports/stock").then((r) => setStock(r.data)); }, [loadPnl]);

  return (
    <div>
      <PageHeader title={t("reports")} actions={
        <Btn data-testid="download-report-btn" disabled={busy} onClick={()=>openPdf("/reports/pnl/pdf","Financial Report")}><Download size={16} />{t("download_report")}</Btn>} />

      {preview && <div role="dialog" aria-modal="true" aria-label={preview.name} className="fixed inset-0 z-[100] flex flex-col bg-[var(--surface-2)] p-2 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold gold-text">{preview.name}</span>
          <div className="flex items-center gap-2"><a href={preview.url} download={preview.name+".pdf"} className="flex items-center gap-1 rounded border border-border p-2 text-sm"><Download size={16}/> PDF</a><button type="button" aria-label="Close PDF" onClick={()=>setPreview(null)} className="rounded border border-border p-2"><X size={20}/></button></div>
        </div>
        <iframe title={preview.name} src={preview.url} className="min-h-0 w-full flex-1 rounded bg-white"/>
      </div>}
      {/* Date filter */}
      <div className="mb-4 flex flex-wrap items-end gap-3 card-surface rounded-sm p-4">
        <div className="w-40"><Field label={t("from_date")}><Input type="date" data-testid="report-start" value={start} onChange={(e) => setStart(e.target.value)} /></Field></div>
        <div className="w-40"><Field label={t("to_date")}><Input type="date" data-testid="report-end" value={end} onChange={(e) => setEnd(e.target.value)} /></Field></div>
        <Btn data-testid="report-apply" onClick={loadPnl}>{t("apply")}</Btn>
        <Btn variant="dark" data-testid="report-clear" onClick={() => { setStart(""); setEnd(""); }}>{t("clear")}</Btn>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-surface rounded-sm p-5">
          <h3 className="mb-4 font-head text-lg font-bold gold-text">{t("profit_loss")}</h3>
          {pnl && [["sales_revenue", pnl.sales_revenue, "green"], ["cogs", pnl.cogs, "silver"],
            ["gross_profit", pnl.gross_profit, "gold"], ["expenses", pnl.expenses, "red"],
            ["salaries", pnl.salaries, "red"], ["net_profit", pnl.net_profit, pnl.net_profit >= 0 ? "green" : "red"],
            ["tax", pnl.tax_collected, "silver"]].map(([k, v, tone]) => (
            <div key={k} className="flex justify-between border-b border-border py-2.5 text-sm">
              <span className="text-muted-foreground">{t(k)}</span>
              <span className={`font-semibold ${tone === "green" ? "text-emerald-400" : tone === "red" ? "text-red-400" : tone === "gold" ? "gold-text" : "text-gray-300"}`}>{money(v)}</span>
            </div>))}
        </div>
        <div className="space-y-4">
          <div className="card-surface rounded-sm p-5">
            <h3 className="mb-4 font-head text-lg font-bold gold-text">{t("stock_valuation")}</h3>
            {stock && (<>
              <Row l={`${t("vehicles")} (${stock.vehicles_count})`} v={money(stock.vehicles_value)} />
              <Row l={`${t("parts")} (${stock.parts_count})`} v={money(stock.parts_value)} />
              <div className="mt-2 flex justify-between border-t border-[var(--gold)]/40 pt-3 text-base">
                <span className="font-head font-bold text-white">{t("inventory_value")}</span>
                <span className="font-head font-black gold-text">{money(stock.total_value)}</span>
              </div>
            </>)}
          </div>
        </div>
      </div>

      {/* PDF period reports */}
      <div className="mt-4 card-surface rounded-sm p-5">
        <h3 className="mb-3 font-head text-lg font-bold gold-text">{t("period_reports")}</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Btn variant="dark" data-testid="report-today-pdf" disabled={busy} onClick={()=>openPdf("/reports/today/pdf","Daily Report")}><FileText size={15} />{t("today_report")}</Btn>
          <div className="flex items-end gap-2">
            <div className="w-40"><Field label={t("select_month")}><Input type="month" data-testid="report-month-input" value={rMonth} onChange={(e) => setRMonth(e.target.value)} /></Field></div>
            <Btn variant="dark" data-testid="report-monthly-pdf" disabled={busy} onClick={()=>openPdf(`/reports/monthly/pdf?month=${rMonth}`,"Monthly Report")}><FileText size={15} />{t("monthly_report")}</Btn>
          </div>
          <div className="flex items-end gap-2">
            <div className="w-28"><Field label={t("select_year")}><Input type="number" data-testid="report-year-input" value={rYear} onChange={(e) => setRYear(e.target.value)} /></Field></div>
            <Btn variant="dark" data-testid="report-yearly-pdf" disabled={busy} onClick={()=>openPdf(`/reports/yearly/pdf?year=${rYear}`,"Yearly Report")}><FileText size={15} />{t("yearly_report")}</Btn>
          </div>
        </div>
      </div>

      {/* CSV export + full backup */}
      <div className="mt-4 card-surface rounded-sm p-5">
        <h3 className="mb-1 font-head text-lg font-bold gold-text">{t("export_data")}</h3>
        <p className="mb-3 text-xs text-muted-foreground">Open a PDF report or download the original CSV for Excel.</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {EXPORTS.map(([e, label], i) => {
            const Icon = RECORD_ICONS[i];
            return <div key={e} className="min-w-0 rounded-xl border border-[var(--gold)]/60 bg-[var(--surface-2)] p-2">
              <button type="button" disabled={busy} data-testid={`export-${e}`} onClick={()=>openPdf(`/export/${e}?format=pdf`, RECORD_NAMES[i])} className="flex min-h-[84px] w-full flex-col items-center justify-center gap-2 rounded-lg px-1 text-center text-sm font-bold">
                <Icon size={25} className="gold-text"/><span>{RECORD_NAMES[i]}</span>
              </button>
              <div className="flex justify-center border-t border-border pt-2"><a className="flex items-center gap-1 text-xs text-muted-foreground" href={downloadUrl(`/export/${e}`)}><FileSpreadsheet size={13}/> CSV / Excel</a></div>
            </div>;
          })}
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <a href={downloadUrl("/export/backup")} target="_blank" rel="noreferrer" data-testid="export-backup">
            <Btn><DatabaseBackup size={16} />{t("full_backup")}</Btn>
          </a>
          <p className="mt-2 text-xs text-muted-foreground">{t("backup_hint")}</p>
        </div>
      </div>
    </div>
  );
}
function Row({ l, v }) {
  return <div className="flex justify-between border-b border-border py-2.5 text-sm"><span className="text-muted-foreground">{l}</span><span className="font-semibold text-gray-200">{v}</span></div>;
}
