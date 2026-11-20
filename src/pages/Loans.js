import React, { useEffect, useState, useCallback } from "react";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader, Btn, Modal, Field, Input, Badge } from "@/components/kit";
import { toast } from "sonner";
import { Plus, ChevronRight, Pencil, Trash2 } from "lucide-react";

const TYPES = [["borrowed","Received"],["repayment","Paid"]];
const direction = (type) => ["borrowed", "received_back"].includes(type) ? "borrowed" : "repayment";

export default function Loans() {
  const { t } = useI18n();
  const { money } = useSettings();
  const [rows, setRows] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [detail, setDetail] = useState(null);
  const [entry, setEntry] = useState(null);

  const load = useCallback(() => { api.get("/loans").then((r) => setRows(r.data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => { const { data } = await api.get(`/loans/${id}`); setDetail(data); };
  const reloadDetail = () => { if (detail) api.get(`/loans/${detail.id}`).then((r) => setDetail(r.data)).catch(() => {}); load(); };

  const createLoan = async () => {
    try { await api.post("/loans", { name }); setAddOpen(false); setName(""); load(); toast.success(t("save")); }
    catch (e) { toast.error(apiError(e)); }
  };
  const saveEntry = async () => {
    try {
      const payload = {
        entry_type: entry.entry_type,
        date: entry.date,
        amount: +entry.amount || 0,
        method: entry.method || "cash",
        note: entry.note || "",
      };
      if (entry.id) await api.put(`/loan-entries/${entry.id}`, payload);
      else await api.post(`/loans/${detail.id}/entries`, payload);
      setEntry(null); reloadDetail(); toast.success(t("save"));
    } catch (e) { toast.error(apiError(e)); }
  };

  const deleteEntry = async (e) => {
    if (!window.confirm(`${t("delete")}?`)) return;
    try {
      await api.delete(`/loan-entries/${e.id}`);
      reloadDetail();
      toast.success(t("delete"));
    } catch (err) { toast.error(apiError(err)); }
  };

  const dir = (b) => <Badge tone={b.net < 0 ? "red" : "green"}>بقایا {b.net > 0 ? "+" : ""}{money(b.net)}</Badge>;

  return (
    <div>
      <PageHeader title={t("loans")} actions={
        <Btn data-testid="add-loan-btn" onClick={() => setAddOpen(true)}><Plus size={16} />{t("add_loan")}</Btn>} />

      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((l) => (
          <button key={l.id} data-testid={`loan-card-${l.id}`} onClick={() => openDetail(l.id)}
            className="card-surface flex items-center justify-between rounded-sm p-4 text-start hover:border-[var(--gold)]/50">
            <div><div className="font-semibold text-white">{l.name}</div><div className="mt-1">{dir(l.balance)}</div></div>
            <ChevronRight size={18} className="text-muted-foreground" />
          </button>
        ))}
        {!rows.length && <div className="text-sm text-muted-foreground">{t("no_data")}</div>}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t("add_loan")} testid="loan-add-modal">
        <Field label={t("name")}><Input data-testid="loan-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="mt-3 flex justify-end gap-2"><Btn variant="dark" onClick={() => setAddOpen(false)}>{t("cancel")}</Btn><Btn data-testid="save-loan" onClick={createLoan}>{t("save")}</Btn></div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name} testid="loan-detail" wide>
        {detail && (<div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <Info l="Received · وصول" v={money(detail.balance.received_total)} cls="text-red-400" />
            <Info l="Paid · ادا کیا" v={money(detail.balance.paid_total)} cls="text-emerald-400" />
            <Info l="Balance · بقایا" v={(detail.balance.net > 0 ? "+" : "") + money(detail.balance.net)} />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <h4 className="font-head font-bold gold-text">{t("history")}</h4>
            <Btn variant="ghost" data-testid="loan-add-entry" onClick={() => setEntry({ entry_type: "borrowed", amount: "", method: "cash", note: "", date: new Date().toISOString().slice(0, 10) })}><Plus size={16} />{t("add")}</Btn>
          </div>
          {detail.entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 border-b border-border py-1.5 text-sm">
              <span className="min-w-0 flex-1">{(e.date || "").slice(0, 10)} · {(TYPES.find(([x])=>x===direction(e.entry_type))||[])[1] || t(e.entry_type)}{e.note ? <span className="block text-xs text-muted-foreground">{e.note}</span> : null}</span>
              <span className="whitespace-nowrap text-white">{money(e.amount)}</span>
              <div className="flex shrink-0 gap-1">
                <Btn variant="ghost" data-testid={`edit-loan-entry-${e.id}`} onClick={() => setEntry({ ...e, date: (e.date || "").slice(0, 10), amount: String(e.amount ?? "") })}>
                  <Pencil size={14} className="text-sky-300" />
                </Btn>
                <Btn variant="ghost" data-testid={`delete-loan-entry-${e.id}`} onClick={() => deleteEntry(e)}>
                  <Trash2 size={14} className="text-red-400" />
                </Btn>
              </div>
            </div>
          ))}
        </div>)}
      </Modal>

      <Modal open={!!entry} onClose={() => setEntry(null)} title={entry?.id ? t("edit") : t("add")} testid="loan-entry-modal">
        {entry && (<div>
          <Field label={t("entry_type")}>
            <select data-testid="le-type" value={direction(entry.entry_type)} onChange={(e) => setEntry({ ...entry, entry_type: e.target.value })}
              className="w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none">
              {TYPES.map(([x,label]) => <option key={x} value={x}>{label}</option>)}
            </select>
          </Field>
          <Field label={t("date")}><Input type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></Field>
          <Field label={t("amount")}><Input type="number" data-testid="le-amount" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} /></Field>
          <Field label="Note / Description"><Input value={entry.note || ""} onChange={(e) => setEntry({ ...entry, note: e.target.value })} /></Field>
          <div className="mt-2 flex justify-end gap-2"><Btn variant="dark" onClick={() => setEntry(null)}>{t("cancel")}</Btn><Btn data-testid="save-le" onClick={saveEntry}>{t("save")}</Btn></div>
        </div>)}
      </Modal>
    </div>
  );
}

function Info({ l, v, cls = "text-white" }) {
  return <div><div className="text-xs text-muted-foreground">{l}</div><div className={`font-semibold ${cls}`}>{v}</div></div>;
}
