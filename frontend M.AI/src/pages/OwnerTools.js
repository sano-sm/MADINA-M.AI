import { OwnerDocuments, Restore } from "@/components/TradingDocuments";
import React, { useCallback, useEffect, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader, Btn, Modal, Badge } from "@/components/kit";
import { toast } from "sonner";
import { Archive, ChevronLeft, Download, Eye, FolderOpen, LockKeyhole, UnlockKeyhole, CalendarDays, BarChart3, Info, FileText, Package, TrendingUp, Settings2, Printer, CheckCircle2 } from "lucide-react";

export default function OwnerTools() {
  const { t } = useI18n();
  const { money } = useSettings();
  const [years, setYears] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [both, setBoth] = useState(false);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [openFolder, setOpenFolder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedYear, setSelectedYear] = useState(2026);
  const [yearReport, setYearReport] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);

  async function exportFile(fmt) {
    if (!both) return api.get("/owner/backup." + fmt, { responseType: "blob" });
    return api.post("/owner/combined/" + fmt, { password: ownerPassword }, { responseType: "blob", __noRetry: true });
  }
  const load = useCallback(() => api.get("/owner/fiscal-years").then((r) => setYears(r.data?.years || [])).catch((e) => toast.error(apiError(e))), []);
  useEffect(() => { load(); }, [load]);

  const closeYear = async (y) => {
    if (!window.confirm("Close " + y.fiscal_year_start + "? This saves the profit and remaining-stock snapshot, carries stock into the next year, and starts a new profit period. Existing inventory, customers, brokers and balances will NOT be deleted. Download a Full Backup ZIP before proceeding.")) return;
    try { await api.post(`/owner/fiscal-years/${y.fiscal_year_start}/close`); toast.success(t("year_closed")); await load(); setSelectedYear(y.fiscal_year_start + 1); loadYearReport(y.fiscal_year_start + 1); }
    catch (e) { toast.error(apiError(e)); }
  };
  const reopenYear = async (y) => {
    if (!window.confirm(`${t("reopen_year")} ${y.label}?`)) return;
    try { await api.post(`/owner/fiscal-years/${y.fiscal_year_start}/reopen`); toast.success(t("year_open")); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const viewSnapshot = async (y) => {
    try { const { data } = await api.get(`/owner/fiscal-years/${y.fiscal_year_start}/snapshot`); setSnapshot(data); }
    catch (e) { toast.error(apiError(e)); }
  };
  const openYear = (y) => { setSelectedYear(y.fiscal_year_start); };
  const loadYearReport = useCallback(async (year) => {
    setReportBusy(true);
    try { const r = await api.get(`/owner/fiscal-years/${year}/summary`); setYearReport(r.data); }
    catch (e) { setYearReport(null); toast.error(apiError(e)); }
    finally { setReportBusy(false); }
  }, []);
  useEffect(() => { if (openFolder === "years") loadYearReport(selectedYear); }, [openFolder, selectedYear, loadYearReport]);
  const backup = async () => {
    setBusy(true);
    try {
      const r = await exportFile("zip");
      const cd = r.headers?.["content-disposition"] || "";
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] || `${both ? "MTC-TSK" : localStorage.getItem("mtc_company") || "MTC"}-FULL-BACKUP-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(r.data); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t("backup_ready"));
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      const r = await exportFile("pdf");
      const cd = r.headers?.["content-disposition"] || "";
      const m = /filename="?([^";]+)"?/i.exec(cd);
      const filename = m?.[1] || `${both ? "MTC-TSK" : localStorage.getItem("mtc_company") || "MTC"}-BUSINESS-REPORT-${new Date().toISOString().slice(0, 10)}.pdf`;
      const url = URL.createObjectURL(r.data); const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("PDF ready");
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return <div>
    <PageHeader title="OWNER TOOLS" />

    {!openFolder && <div className="mb-5 grid w-full max-w-[460px] grid-cols-2 justify-items-center gap-x-8 gap-y-8 px-1 sm:gap-x-12">
      <OwnerDesktopFolder title="Year Archives" detail={`${years.length} years`} onClick={() => setOpenFolder("years")} />
      <OwnerDesktopFolder title="Invoices" detail="Invoice folders" onClick={() => setOpenFolder("invoices")} />
      <OwnerDesktopFolder title="Full Backup ZIP" detail="Backup files" onClick={() => setOpenFolder("backup")} small />
    </div>}

    {openFolder === "years" && <section className="mb-5 rounded-xl border border-[#3a5066] bg-[#06111f] p-3 text-white shadow-xl sm:p-5">
      <button type="button" className="mb-4 flex items-center gap-1 text-sm text-slate-300" onClick={() => setOpenFolder(null)}><ChevronLeft size={16}/> Back</button>
      <div className="mb-5 flex items-start gap-3">
        <FolderOpen className="mt-1 shrink-0 text-[#e9b947]" size={38}/>
        <div><h2 className="text-2xl font-bold">Year Archives</h2><p className="text-sm text-slate-400">Yearly business records, closing, and summary reports.</p></div>
      </div>
      <div className="mb-5 grid grid-cols-4 gap-2 lg:grid-cols-8">
        {Array.from({length:8}, (_,i)=>2026+i).map(y=>{
          const data=years.find(x=>x.fiscal_year_start===y);
          const current=years.find(x=>!x.closed) || years[0];
          const active=data && !data.closed && current?.fiscal_year_start===y;
          return <button key={y} type="button" onClick={()=>setSelectedYear(y)} className={`rounded-xl border px-1 py-3 text-center transition ${selectedYear===y?"border-[#f2c44c] shadow-[0_0_12px_#d6a43a]":"border-[#53677d] hover:border-[#d4ae52]"} bg-gradient-to-b from-[#142235] to-[#07111e]`}>
            <div className="text-lg font-bold sm:text-xl">{y}</div>
            <span className={`mt-2 inline-block rounded-md px-1.5 py-1 text-[10px] font-semibold sm:text-xs ${active?"bg-[#08683c] text-[#b5fbd4]":data?.closed?"bg-[#715328] text-[#ffe4a4]":"bg-[#34465b] text-slate-200"}`}>{active?"Open":data?.closed?"Closed":"Future"}</span>
          </button>;
        })}
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#52677b] bg-[#07111e] p-3">
        <div className="flex items-center gap-2 font-bold"><CalendarDays size={21}/> Year: {selectedYear} <span className="text-sm text-emerald-400">({years.find(y=>y.fiscal_year_start===selectedYear)?.closed?"Closed":years.some(y=>y.fiscal_year_start===selectedYear)?"Open":"Future"})</span></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={()=>loadYearReport(selectedYear)} className="flex items-center gap-2 rounded-lg border border-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-200"><BarChart3 size={16}/> View Summary</button>
          {years.some(y=>y.fiscal_year_start===selectedYear&&!y.closed&&!y.snapshot_at) && <button type="button" onClick={()=>closeYear(years.find(y=>y.fiscal_year_start===selectedYear))} className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#f4d76b] to-[#c39224] px-3 py-2 text-sm font-bold text-black"><LockKeyhole size={16}/> Close Year</button>}
          {years.some(y=>y.fiscal_year_start===selectedYear&&y.closed) && <button type="button" onClick={()=>reopenYear(years.find(y=>y.fiscal_year_start===selectedYear))} className="flex items-center gap-2 rounded-lg border border-[#c9a34b] px-3 py-2 text-sm"><UnlockKeyhole size={16}/> Reopen</button>}
          <button type="button" onClick={()=>toast.info("Year settings are managed by the automatic closing and opening process.")} className="flex items-center gap-2 rounded-lg border border-indigo-400 px-3 py-2 text-sm"><Settings2 size={16}/> Year Settings</button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,1fr)]">
        <div className="overflow-hidden rounded-xl border border-[#53718f] bg-gradient-to-b from-[#102c4e] via-[#081827] to-[#06111c]">
          <div className="border-b border-[#34506c] p-4"><div className="flex items-center gap-2 text-xl font-bold"><TrendingUp className="text-[#e9b947]"/> {selectedYear} – Year Summary</div><p className="mt-1 text-xs text-slate-300">Annual Business Report {yearReport?.summary ? `(${yearReport.summary.period_start} – ${yearReport.summary.period_end})` : ""}</p></div>
          <div className="p-3">
            {reportBusy && <p className="py-5 text-center text-slate-300">Loading year summary…</p>}
            {!reportBusy && !yearReport?.summary && <p className="py-5 text-center text-slate-300">No report available for this year.</p>}
            {!reportBusy && yearReport?.summary && <>
              <div className="overflow-x-auto rounded-lg border border-[#284057]">
                <table className="w-full min-w-[390px] text-left text-sm">
                  <thead className="bg-[#101f31] text-slate-200"><tr><th className="p-3">Item</th><th className="p-3 text-right">Total</th></tr></thead>
                  <tbody className="divide-y divide-[#304358]">
                    {[
                      ["Total Purchasing — Cars, Parts & Others","purchasing_total"],
                      ["Dismantled Cars (Total)","dismantled_count","count"],
                      ["Dismantled Cars Purchase Value","dismantled_purchase_value"],
                      ["Complete Cars Sold","complete_sold_count","count"],
                      ["Complete Cars Sales Amount","complete_sales_amount"],
                      ["Engine Sales (Total)","engine_sales"],
                      ["Spare Parts Sales (Total)","spare_parts_sales"],
                      ["Shokubai (Catalyst) Sales","shokubai_sales"],
                      ["Scrap Sales","scrap_sales"],
                      ["Local Sales (Other)","local_other_sales"],
                      ["Invoice Sales","invoice_sales"],
                      ["Total Expenses","expenses_total"],
                    ].map(([label,key,type])=><tr key={key} className="odd:bg-[#071320] even:bg-[#0b1c2d]"><td className="px-3 py-2.5">{label}</td><td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{type==="count"?`${yearReport.summary[key]??0} Cars`:money(yearReport.summary[key]??0)}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-emerald-500 bg-gradient-to-br from-[#073d2d] to-[#071b1d] p-3"><div className="flex items-center gap-1 text-xs font-bold sm:text-sm"><TrendingUp size={16}/> Net Profit*</div><div className="mt-2 break-words text-lg font-bold text-emerald-300 sm:text-xl">{money(yearReport.summary.net_profit??0)}</div></div>
                <div className="rounded-xl border border-sky-400 bg-gradient-to-br from-[#083051] to-[#071b2d] p-3"><div className="flex items-center gap-1 text-xs font-bold sm:text-sm"><Package size={16}/> Closing Stock</div><div className="mt-2 break-words text-lg font-bold text-sky-200 sm:text-xl">{yearReport.closing_stock?money(yearReport.closing_stock.total_value??0):"—"}</div></div>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">*Profit currently uses invoice-based P&amp;L. Scrap, Shokubai and other recovery totals are listed separately; they are not yet included in this profit figure.</p>
            </>}
          </div>
        </div>
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-[#53718f] bg-[#081827]"><h3 className="flex items-center gap-2 border-b border-[#34506c] bg-[#102c4e] p-3 font-bold"><Info className="text-sky-400"/> Year Status</h3><div className="space-y-0 text-sm">{[["Year",selectedYear],["Status",years.find(y=>y.fiscal_year_start===selectedYear)?.closed?"Closed":years.some(y=>y.fiscal_year_start===selectedYear)?"Open":"Future"],["Period",yearReport?.summary?`${yearReport.summary.period_start} – ${yearReport.summary.period_end}`:"Not started"],["Next Year",selectedYear+1]].map(([label,val])=><div key={label} className="flex justify-between gap-3 border-b border-[#283d53] px-3 py-2"><span>{label}</span><span className="text-right font-semibold">{val}</span></div>)}</div></div>
          <div className="overflow-hidden rounded-xl border border-[#53718f] bg-[#081827]"><h3 className="flex items-center gap-2 border-b border-[#34506c] bg-[#102c4e] p-3 font-bold"><FileText className="text-[#e9b947]"/> What Happens on Close?</h3><div className="space-y-3 p-3 text-sm">{["Saves annual totals, final profit and stock snapshot.","Carries remaining stock into the next year's opening balance.","Keeps customers, brokers and outstanding balances active.","Starts a new profit period without deleting existing records."].map(x=><div key={x} className="flex gap-2"><CheckCircle2 className="shrink-0 text-emerald-400" size={18}/>{x}</div>)}</div></div>
          <div className="overflow-hidden rounded-xl border border-[#53718f] bg-[#081827]"><h3 className="flex items-center gap-2 border-b border-[#34506c] bg-[#102c4e] p-3 font-bold"><TrendingUp className="text-[#e9b947]"/> Quick Actions</h3><div className="space-y-2 p-3">
            <button type="button" onClick={()=>window.print()} className="flex w-full items-center gap-2 rounded-lg border border-[#667f99] bg-[#1b2e45] p-3 text-left text-sm"><Printer size={18}/> Print Year Summary</button>
            <button type="button" onClick={()=>{if(!yearReport?.summary)return toast.error("Load a report first");const rows=Object.entries(yearReport.summary).map(([k,v])=>[k,v].join(",")).join("\n");const blob=new Blob([rows],{type:"text/csv"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`Year-${selectedYear}-Summary.csv`;a.click();URL.revokeObjectURL(url);}} className="flex w-full items-center gap-2 rounded-lg border border-[#667f99] bg-[#1b2e45] p-3 text-left text-sm"><Download size={18}/> Download Report (CSV)</button>
            <button type="button" onClick={()=>{const closed=years.filter(y=>y.closed);if(closed.length)setSelectedYear(closed[0].fiscal_year_start);else toast.info("No closed years yet");}} className="flex w-full items-center gap-2 rounded-lg border border-[#667f99] bg-[#1b2e45] p-3 text-left text-sm"><FolderOpen size={18}/> View Closed Years</button>
          </div></div>
        </div>
      </div>
    </section>}

    {openFolder === "invoices" && <section className="card-surface mb-5 max-w-3xl rounded-sm p-5">
      <div className="mb-3"><Btn variant="ghost" onClick={() => setOpenFolder(null)}><ChevronLeft size={15} />Back</Btn></div>
      <div className="mb-5 flex items-center gap-2"><FolderOpen className="gold-text" /><h2 className="font-head text-lg font-bold text-white">Invoices</h2></div>
      <div className="grid grid-cols-2 items-start justify-between gap-x-10 gap-y-6 px-1 pt-1 sm:gap-x-24 sm:px-5">
        <OwnerDocuments compact invoiceKind="manual" />
        <OwnerDocuments compact invoiceKind="custom" />
      </div>
    </section>}

    {openFolder === "backup" && <section className="card-surface mb-5 max-w-3xl rounded-sm p-5">
      <div className="mb-3"><Btn variant="ghost" onClick={() => setOpenFolder(null)}><ChevronLeft size={15} />Back</Btn></div>
      <div className="mb-4 flex items-center gap-2"><Archive className="gold-text" /><h2 className="font-head text-lg font-bold text-white">Full Backup ZIP</h2></div>
      <p className="mb-4 text-sm text-muted-foreground">{t("full_backup_zip_hint")}</p>
      <div className="flex flex-wrap gap-2">
        <label className="w-full"><input type="checkbox" checked={both} onChange={e => { setBoth(e.target.checked); setOwnerPassword(""); }} /> Both companies · MTC + TSK</label>
        {both && <input type="password" autoComplete="current-password" className="rounded p-2 text-black" placeholder="Owner password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)} />}
        <Btn disabled={busy} onClick={backup}><Download size={16} />{busy ? t("preparing") : t("full_backup_zip")}</Btn>
        <Btn disabled={busy} variant="dark" onClick={downloadPdf}><Download size={16} />{busy ? t("preparing") : "Download PDF Report"}</Btn>
      </div><Restore />
    </section>}

    <Modal open={!!snapshot} onClose={() => setSnapshot(null)} title={snapshot?.label || t("view_snapshot")} wide>
      {snapshot && <div>
        {snapshot.profit_summary && snapshot.closing_stock && <div className="mb-4 grid grid-cols-2 gap-3">
          <Snap label="Closed Year · Net Profit" value={money(snapshot.profit_summary.net_profit || 0)} />
          <Snap label="Closed Year · Remaining Stock" value={money(snapshot.closing_stock.total_value || 0)} />
        </div>}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Snap label={t("total_available")} value={money(snapshot.funds?.available || 0)} />
          <Snap label={t("receivable")} value={money(snapshot.funds?.receivable || 0)} />
          <Snap label={t("payable")} value={money(snapshot.funds?.payable || 0)} />
          <Snap label={t("active_vehicles")} value={snapshot.active_vehicles?.length || 0} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <List title={t("customers")} rows={(snapshot.customers || []).map((x) => `${x.name} · ${money(x.balance?.outstanding || 0)}`)} />
          <List title={t("brokers")} rows={(snapshot.brokers || []).map((x) => `${x.name} · ${money(x.account?.payment_due || 0)}`)} />
          <List title={t("loans")} rows={(snapshot.loans || []).map((x) => `${x.name} · ${money(x.balance?.net || 0)}`)} />
        </div>
      </div>}
    </Modal>
  </div>;
}

function Snap({ label, value }) { return <div className="rounded-sm bg-white/5 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-bold gold-text">{value}</div></div>; }
function List({ title, rows }) { return <div><h3 className="mb-2 font-semibold text-white">{title}</h3><div className="max-h-56 space-y-1 overflow-auto text-xs text-muted-foreground">{rows.length ? rows.map((x, i) => <div key={i} className="border-b border-border py-1">{x}</div>) : <div>—</div>}</div></div>; }
function OwnerDesktopFolder({ title, detail, onClick, small=false }) {
  return <button type="button" onClick={onClick} aria-label={title} title={detail}
    className={`group relative flex h-[102px] w-[148px] flex-col items-center justify-center overflow-hidden rounded-[20px] border border-[#e6c477] bg-gradient-to-br from-[#f1d78f] via-[#b78b43] to-[#765024] px-3 text-center shadow-[0_5px_0_#4a331b,0_10px_24px_rgba(0,0,0,0.35)] transition-all duration-200 hover:-translate-y-1 hover:border-[#ffe6a5] hover:shadow-[0_7px_0_#4a331b,0_14px_28px_rgba(0,0,0,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e9bd5e] active:translate-y-0 sm:h-[112px] sm:w-[166px] ${small ? "opacity-100" : ""}`}>
    <span aria-hidden="true" className="pointer-events-none absolute inset-[4px] rounded-[16px] border border-white/35" />
    <span aria-hidden="true" className="pointer-events-none absolute -left-10 -top-16 h-32 w-28 rotate-45 bg-white/20 blur-xl" />
    <span className="relative z-10 font-head text-[15px] font-extrabold leading-snug tracking-wide text-[#21180c] drop-shadow-[0_1px_0_rgba(255,255,255,0.4)] sm:text-[17px]">{title}</span>
    <span aria-hidden="true" className="relative z-10 mt-2 h-[2px] w-10 rounded-full bg-[#493016]/60" />
  </button>;
}
