import React, { useCallback, useEffect, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Badge, DataTable } from "@/components/kit";
import { toast } from "sonner";
import { Plus, ArrowRightLeft, Trash2, WalletCards } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);

export default function Funds() {
  const { t } = useI18n();
  const { money } = useSettings();
  const [data, setData] = useState({ summary: {}, entries: [] });
  const [manual, setManual] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const load = useCallback(() => api.get("/funds").then((r) => setData(r.data || { summary: {}, entries: [] })).catch((e) => toast.error(apiError(e))), []);
  useEffect(() => { load(); }, [load]);

  const s = data.summary || {};
  const addManual = async () => {
    if ((+manual.amount || 0) <= 0) { toast.error(t("required_fields")); return; }
    try { await api.post("/funds/manual", { ...manual, amount: +manual.amount || 0 }); toast.success(t("save")); setManual(null); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const doTransfer = async () => {
    if ((+transfer.amount || 0) <= 0 || transfer.from_method === transfer.to_method) { toast.error(t("invalid_transfer")); return; }
    try { await api.post("/funds/transfer", { ...transfer, amount: +transfer.amount || 0 }); toast.success(t("save")); setTransfer(null); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  const cards = [
    ["cash", t("cash"), s.cash || 0], ["bank", t("bank"), s.bank || 0], ["available", t("total_available"), s.available || 0],
    ["receivable", t("receivable"), s.receivable || 0], ["payable", t("payable"), s.payable || 0], ["net", t("net_position"), s.net_position || 0],
  ];

  const balanceCards = [
    ["broker_payable", "Broker Payable", "بروکر کو دینا باقی", s.broker_payable || 0, "red"],
    ["broker_advance", "Broker Advance", "بروکر کو ایڈوانس دیا", s.broker_advance ?? s.broker_receivable ?? 0, "gold"],
    ["customer_receivable", "Customer Receivable", "کسٹمر سے لینا باقی", s.customer_receivable || 0, "green"],
    ["customer_advance", "Customer Advance", "کسٹمر سے ایڈوانس ملا", s.customer_advance ?? s.customer_credit ?? 0, "gold"],
  ];

  const cols = [
    { label: t("date"), render: (e) => (e.date || e.created_at || "").slice(0, 10) },
    { label: t("type"), render: (e) => <Badge tone={e.direction === "in" ? "green" : "red"}>{e.direction === "in" ? t("money_in") : t("money_out")}</Badge> },
    { label: t("payment_method"), render: (e) => t(e.method || "cash") },
    { label: t("category"), render: (e) => t(`fund_${e.category}`) !== `fund_${e.category}` ? t(`fund_${e.category}`) : (e.category || "—") },
    { label: t("description"), render: (e) => e.description || "—" },
    { label: t("amount"), align: "end", render: (e) => <span className={e.direction === "in" ? "text-emerald-400" : "text-red-400"}>{e.direction === "in" ? "+" : "−"}{money(e.amount || 0)}</span> },
    { label: t("action"), action: true, render: (e) => e.source_type === "manual" && <Btn variant="ghost" onClick={async () => {
      if (!window.confirm("Delete?")) return;
      try { await api.delete(`/funds/manual/${e.id}`); load(); } catch (err) { toast.error(apiError(err)); }
    }}><Trash2 size={15} className="text-red-400" /></Btn> },
  ];

  return <div>
    <PageHeader title={t("cash_bank")} actions={<div className="flex gap-2"><Btn variant="dark" onClick={() => setTransfer({ date: today(), amount: "", from_method: "cash", to_method: "bank", note: "" })}><ArrowRightLeft size={16} />{t("transfer")}</Btn><Btn onClick={() => setManual({ date: today(), direction: "in", amount: "", method: "cash", category: "small_cash_sale", description: "" })}><Plus size={16} />{t("manual_entry")}</Btn></div>} />
    <div className="mb-4 rounded-sm border border-[var(--gold)]/20 bg-[var(--gold)]/5 p-3 text-xs text-muted-foreground">{t("funds_hint")}</div>
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map(([k, label, value]) => <div key={k} className="card-surface rounded-sm p-3"><div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><WalletCards size={13} />{label}</div><div className={`font-head text-base font-bold ${k === "payable" ? "text-red-400" : k === "receivable" ? "text-emerald-400" : "gold-text"}`}>{money(value)}</div></div>)}
    </div>

    <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {balanceCards.map(([k, label, urdu, value, tone]) => (
        <div key={k} className="card-surface rounded-sm border border-white/5 p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><WalletCards size={13} />{label}</div>
          <div className="text-[11px] text-muted-foreground">{urdu}</div>
          <div className={`mt-2 font-head text-lg font-bold ${tone === "red" ? "text-red-400" : tone === "green" ? "text-emerald-400" : "gold-text"}`}>{money(value)}</div>
        </div>
      ))}
    </div>

    <DataTable columns={cols} rows={data.entries || []} rowKey={(e) => e.id} empty={t("no_data")} />

    <Modal open={!!manual} onClose={() => setManual(null)} title={t("manual_entry")}>
      {manual && <div>
        <Field label={t("date")}><Input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} /></Field>
        <Field label={t("type")}><Select value={manual.direction} onChange={(e) => setManual({ ...manual, direction: e.target.value })}><option value="in">{t("money_in")}</option><option value="out">{t("money_out")}</option></Select></Field>
        <Field label={t("category")}><Select value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value })}>
          <option value="opening_balance">{t("opening_balance")}</option><option value="small_cash_sale">{t("small_cash_sale")}</option><option value="scrap_shokubai_total">{t("scrap_shokubai_total")}</option><option value="owner_capital">{t("owner_capital")}</option><option value="other_receipt">{t("other_receipt")}</option><option value="other_payment">{t("other_payment")}</option>
        </Select></Field>
        <Field label={t("payment_method")}><Select value={manual.method} onChange={(e) => setManual({ ...manual, method: e.target.value })}><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>
        <Field label={t("amount")}><Input type="number" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} /></Field>
        <Field label={t("description")}><Input value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setManual(null)}>{t("cancel")}</Btn><Btn onClick={addManual}>{t("save")}</Btn></div>
      </div>}
    </Modal>

    <Modal open={!!transfer} onClose={() => setTransfer(null)} title={t("transfer")}>
      {transfer && <div>
        <Field label={t("date")}><Input type="date" value={transfer.date} onChange={(e) => setTransfer({ ...transfer, date: e.target.value })} /></Field>
        <Field label={t("from_label")}><Select value={transfer.from_method} onChange={(e) => setTransfer({ ...transfer, from_method: e.target.value })}><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>
        <Field label={t("to_label")}><Select value={transfer.to_method} onChange={(e) => setTransfer({ ...transfer, to_method: e.target.value })}><option value="bank">{t("bank")}</option><option value="cash">{t("cash")}</option></Select></Field>
        <Field label={t("amount")}><Input type="number" value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })} /></Field>
        <Field label={t("notes")}><Input value={transfer.note} onChange={(e) => setTransfer({ ...transfer, note: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setTransfer(null)}>{t("cancel")}</Btn><Btn onClick={doTransfer}>{t("save")}</Btn></div>
      </div>}
    </Modal>
  </div>;
}
