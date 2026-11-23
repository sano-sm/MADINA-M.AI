import { OwnerDocuments, Restore } from "@/components/TradingDocuments";
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader, Btn, Modal, Badge } from "@/components/kit";
import { toast } from "sonner";
import { ChevronLeft, Download, Eye, FilePlus, Folder, FolderOpen, LockKeyhole, UnlockKeyhole } from "lucide-react";

export default function OwnerTools() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { money } = useSettings();
  const [years, setYears] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [both, setBoth] = useState(false);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [openFolder, setOpenFolder] = useState(null);
  const [busy, setBusy] = useState(false);

  async function exportFile(fmt) {
    if (!both) return api.get("/owner/backup." + fmt, { responseType: "blob" });
    return api.post("/owner/combined/" + fmt, { password: ownerPassword }, { responseType: "blob", __noRetry: true });
  }
  const load = useCallback(() => api.get("/owner/fiscal-years").then((r) => setYears(r.data?.years || [])).catch((e) => toast.error(apiError(e))), []);
  useEffect(() => { load(); }, [load]);

  const closeYear = async (y) => {
    if (!window.confirm(`${t("close_year")} ${y.label}?`)) return;
    try { await api.post(`/owner/fiscal-years/${y.fiscal_year_start}/close`); toast.success(t("year_closed")); load(); }
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
  const openYear = (y) => navigate(`/container?year=${encodeURIComponent(y.fiscal_year_start)}`);
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
    <PageHeader title={t("owner_tools")} />

    {!openFolder && <div className="mb-5 grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
      <button type="button" onClick={() => setOpenFolder("years")} className="card-surface w-full max-w-[220px] rounded-lg border border-[var(--gold)]/30 p-3 text-start transition hover:-translate-y-0.5 hover:border-[var(--gold)]/70">
        <div className="flex items-center gap-2"><Folder className="h-6 w-6 shrink-0 text-[var(--gold)]" /><div><div className="font-head text-sm font-bold text-white">Special Years</div><div className="mt-0.5 text-[11px] text-muted-foreground">{years.length} accounting years</div></div></div>
      </button>
      <button type="button" onClick={() => setOpenFolder("invoices")} className="card-surface w-full max-w-[220px] rounded-lg border border-border p-3 text-start transition hover:-translate-y-0.5 hover:border-[var(--gold)]/60">
        <div className="flex items-center gap-2"><Folder className="h-6 w-6 shrink-0 text-[var(--gold)]" /><div><div className="font-head text-sm font-bold text-white">Invoices</div><div className="mt-0.5 text-[11px] text-muted-foreground">Invoice folders</div></div></div>
      </button>
      <button type="button" onClick={() => setOpenFolder("years")} className="card-surface w-full max-w-[220px] rounded-lg border border-border p-3 text-start transition hover:-translate-y-0.5 hover:border-[var(--gold)]/60">
        <div className="flex items-center gap-2"><Folder className="h-6 w-6 shrink-0 text-[var(--gold)]" /><div><div className="font-head text-sm font-bold text-white">Fiscal Years</div><div className="mt-0.5 text-[11px] text-muted-foreground">Close and snapshots</div></div></div>
      </button>
    </div>}

    {openFolder === "years" && <section className="card-surface mb-5 rounded-sm p-5">
      <div className="mb-3"><Btn variant="ghost" onClick={() => setOpenFolder(null)}><ChevronLeft size={15} />Back</Btn></div>
      <div className="mb-4 flex items-center gap-2"><FolderOpen className="gold-text" /><div><h2 className="font-head text-lg font-bold text-white">Special Years</h2><p className="text-xs text-muted-foreground">Select a year to open its accounting summary.</p></div></div>
      <div className="grid max-w-4xl grid-cols-3 gap-4">
        {years.map((y) => <div key={y.fiscal_year_start} className="rounded-xl border border-border bg-white/[0.03] p-3 transition hover:border-[var(--gold)]/60">
          <button type="button" onClick={() => openYear(y)} className="flex min-h-20 w-full flex-col items-center justify-center rounded-lg text-center hover:bg-[var(--gold)]/10"><div className="font-head text-xl font-bold tracking-wide text-white">{y.fiscal_year_start}</div><div className="mt-1 text-[11px] text-muted-foreground">{y.label}</div><Badge tone={y.closed ? "green" : "gold"}>{y.closed ? t("year_closed") : t("year_open")}</Badge></button>
          <div className="mt-2 flex justify-center gap-1 border-t border-border pt-2">
            {y.snapshot_at && <Btn variant="ghost" onClick={() => viewSnapshot(y)}><Eye size={13} /></Btn>}
            {y.closed ? <Btn variant="dark" onClick={() => reopenYear(y)}><UnlockKeyhole size={13} /></Btn> : <Btn onClick={() => closeYear(y)}><LockKeyhole size={13} /></Btn>}
          </div>
        </div>)}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t("fiscal_snapshot_hint")}</p>
    </section>}

    {openFolder === "invoices" && <section className="card-surface mb-5 max-w-3xl rounded-sm p-5">
      <div className="mb-3"><Btn variant="ghost" onClick={() => setOpenFolder(null)}><ChevronLeft size={15} />Back</Btn></div>
      <div className="mb-5 flex items-center gap-2"><FolderOpen className="gold-text" /><h2 className="font-head text-lg font-bold text-white">Invoices</h2></div>
      <div className="grid gap-5 sm:grid-cols-2">
        <OwnerDocuments compact />
        <div className="grid gap-4">
          <InvoiceFolderCard icon={<FilePlus size={20} />} title="Custom Invoice" description="Create a new custom invoice" />
          <InvoiceFolderCard icon={<Folder size={20} />} title="Saved Custom Invoices" description="Saved custom invoices" />
        </div>
      </div>
    </section>}

    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card-surface rounded-sm p-5">
        <div className="mb-4 flex items-center gap-2"><Download className="gold-text" /><h2 className="font-head text-lg font-bold text-white">{t("full_backup_zip")}</h2></div>
        <p className="mb-4 text-sm text-muted-foreground">{t("full_backup_zip_hint")}</p>
        <div className="flex flex-wrap gap-2">
          <label className="w-full"><input type="checkbox" checked={both} onChange={e => { setBoth(e.target.checked); setOwnerPassword(""); }} /> Both companies · MTC + TSK</label>
          {both && <input type="password" autoComplete="current-password" className="rounded p-2 text-black" placeholder="Owner password" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)} />}
          <Btn disabled={busy} onClick={backup}><Download size={16} />{busy ? t("preparing") : t("full_backup_zip")}</Btn>
          <Btn disabled={busy} variant="dark" onClick={downloadPdf}><Download size={16} />{busy ? t("preparing") : "Download PDF Report"}</Btn>
        </div><Restore />
      </section>
    </div>

    <Modal open={!!snapshot} onClose={() => setSnapshot(null)} title={snapshot?.label || t("view_snapshot")} wide>
      {snapshot && <div>
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
function InvoiceFolderCard({ icon, title, description }) {
  return <div className="rounded-lg border border-border bg-white/[0.03] p-3 transition hover:border-[var(--gold)]/60">
    <div className="flex items-center gap-2"><div className="rounded-md bg-[var(--gold)]/10 p-1.5 text-[var(--gold)]">{icon}</div><div className="min-w-0"><div className="font-head text-sm font-bold text-white">{title}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{description}</div></div></div>
  </div>;
}
