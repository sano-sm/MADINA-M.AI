import { printWindow } from "@/lib/documentPreview";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Badge, Empty } from "@/components/kit";
import { toast } from "sonner";
import { Plus, Printer, Trash2, FileText, Wallet, Layers, ClipboardList, Pencil, CalendarDays, Lock, Unlock, FolderOpen, FolderClosed } from "lucide-react";

const TABS = [
  { key: "invoices", label: "container_invoice", icon: FileText },
  { key: "income", label: "income_tt", icon: Wallet },
  { key: "bl", label: "bl_amount", icon: ClipboardList },
  { key: "monthly", label: "monthly_summary", icon: CalendarDays },
  { key: "summary", label: "ct_summary", icon: Layers },
];

export default function ContainerTT() {
  const { t } = useI18n();
  const [tab, setTab] = useState("invoices");
  const { theme } = useSettings();
  // Folder appearance follows the website theme; existing records and calculations stay unchanged.
  const folderDesign = theme === "black" ? "b" : theme === "royal" ? "c" : "a";

  return (
    <div>
      <PageHeader title={t("container_tt")} />
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button key={x.key} data-testid={`ct-tab-${x.key}`} onClick={() => setTab(x.key)}
            className={`inline-flex items-center gap-2 rounded-sm border px-4 py-2 text-sm font-semibold transition-colors ${tab === x.key ? "gold-gradient border-transparent text-black" : "border-border bg-[var(--surface-2)] text-white hover:border-[var(--gold)]"}`}>
            <x.icon size={16} />{t(x.label)}
          </button>
        ))}
      </div>
      <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-4" data-testid="ct-themed-folders">
        {[
          { key: "invoices", label: "Container Invoice" },
          { key: "income", label: "TT Invoice" },
          { key: "bl", label: "BL Amount" },
        ].map((item) => (
          <button type="button" key={item.key} onClick={() => setTab(item.key)}
            data-testid={`ct-folder-${item.key}`}
            aria-pressed={tab === item.key}
            className={`ct-theme-folder ct-theme-folder--${folderDesign} ${tab === item.key ? "ct-theme-folder--active" : ""}`}>
            {tab === item.key ? <FolderOpen className="ct-theme-folder-icon" aria-hidden="true" /> : <FolderClosed className="ct-theme-folder-icon" aria-hidden="true" />}
            <span className="ct-theme-folder-label">{item.label}</span>
          </button>
        ))}
      </div>
      {tab === "invoices" && <InvoicesSection />}
      {tab === "income" && <IncomeSection />}
      {tab === "bl" && <BLAmountSection />}
      {tab === "monthly" && <MonthlySummarySection />}
      {tab === "summary" && <SummarySection />}
    </div>
  );
}

/* ------------------------- Container Invoices ------------------------- */
function InvoicesSection() {
  const { t } = useI18n();
  const { can } = useAuth();
  const editable = can("finance.edit");
  const [list, setList] = useState([]);
  const [selId, setSelId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try { const { data } = await api.get("/container-invoices"); setList(data); }
    catch (e) { /* transient handled by api */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openInvoice = useCallback(async (id) => {
    setSelId(id);
    try { const { data } = await api.get(`/container-invoices/${id}`); setDetail(data); }
    catch (e) { toast.error(apiError(e)); }
  }, []);

  const createNew = async () => {
    try {
      const { data } = await api.post("/container-invoices", { company_name: "", page_count: 1, items: [] });
      await load();
      openInvoice(data.id);
      toast.success(t("save"));
    } catch (e) { toast.error(apiError(e)); }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((i) =>
      [i.invoice_number, i.container_no, i.company_name, i.loading_date]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s)));
  }, [list, q]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {editable && <Btn data-testid="new-container-invoice-btn" onClick={createNew}><Plus size={16} />{t("new_container_invoice")}</Btn>}
        <Input data-testid="ci-search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t("search_container")} className="max-w-xs" />
      </div>

      {/* Compact invoice tabs/cards */}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-2">
        {filtered.map((i) => (
          <button key={i.id} data-testid={`ci-card-${i.id}`} onClick={() => openInvoice(i.id)}
            className={`shrink-0 rounded-sm border px-3 py-2 text-start text-xs transition-colors ${selId === i.id ? "border-[var(--gold)] bg-[var(--gold)]/10" : "border-border bg-[var(--surface-2)] hover:border-[var(--gold)]/50"}`}>
            <div className="font-mono font-semibold text-[var(--gold)]">{i.invoice_number || "—"}</div>
            <div className="max-w-[140px] truncate text-white">{i.company_name || t("company_name")}</div>
            <div className="text-muted-foreground">{i.container_no || "—"}</div>
          </button>
        ))}
        {!filtered.length && <div className="text-sm text-muted-foreground">{t("no_data")}</div>}
      </div>

      {detail ? (
        <InvoiceSheet key={detail.id} detail={detail} editable={editable}
          onSaved={() => load()} onDeleted={() => { setDetail(null); setSelId(null); load(); }} />
      ) : (
        <div className="card-surface rounded-sm"><Empty text={t("no_invoice_selected")} /></div>
      )}
    </div>
  );
}

const PER_PAGE = 60;
const HALF = 30;

function InvoiceSheet({ detail, editable, onSaved, onDeleted }) {
  const { t } = useI18n();
  const { money } = useSettings();
  const [hdr, setHdr] = useState({
    company_name: detail.company_name || "", loading_date: detail.loading_date || "",
    container_no: detail.container_no || "", invoice_number: detail.invoice_number || "",
    final_destination: detail.final_destination || "", bl_surrender_date: detail.bl_surrender_date || "",
  });
  const [pages, setPages] = useState(Math.max(1, detail.page_count || 1));
  // map: number -> { name, price }
  const [items, setItems] = useState(() => {
    const m = {};
    (detail.items || []).forEach((it) => { m[it.no] = { name: it.name || "", price: it.price ?? "" }; });
    return m;
  });

  const setCell = (no, key, val) => setItems((p) => ({ ...p, [no]: { ...(p[no] || { name: "", price: "" }), [key]: val } }));

  const total = useMemo(() =>
    Object.values(items).reduce((s, it) => s + (parseFloat(it.price) || 0), 0), [items]);

  const buildItems = () => {
    const out = [];
    Object.entries(items).forEach(([no, it]) => {
      const name = (it.name || "").trim();
      const price = parseFloat(it.price) || 0;
      if (name || price) out.push({ no: Number(no), name, price });
    });
    return out.sort((a, b) => a.no - b.no);
  };

  const save = async () => {
    try {
      await api.put(`/container-invoices/${detail.id}`, { ...hdr, page_count: pages, items: buildItems() });
      toast.success(t("save"));
      onSaved && onSaved();
    } catch (e) { toast.error(apiError(e)); }
  };

  const remove = async () => {
    if (!window.confirm(t("delete") + "?")) return;
    try { await api.delete(`/container-invoices/${detail.id}`); toast.success(t("delete")); onDeleted && onDeleted(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div>
      {/* Toolbar (not printed) */}
      <div className="ci-no-print mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-head text-lg font-bold gold-text">{t("invoice_total")}: {money(total)}</div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && <Btn data-testid="ci-add-page" variant="dark" onClick={() => setPages((p) => p + 1)}><Plus size={16} />{t("add_page")}</Btn>}
          <Btn data-testid="ci-print" variant="dark" onClick={() => window.print()}><Printer size={16} />{t("print")}</Btn>
          {editable && <Btn data-testid="ci-save" onClick={save}>{t("save")}</Btn>}
          {editable && <Btn data-testid="ci-delete" variant="danger" onClick={remove}><Trash2 size={16} /></Btn>}
        </div>
      </div>

      {/* Printable A4 paper */}
      <div id="ci-print-area">
        <div className="ci-paper mx-auto rounded-sm bg-white p-6 text-black shadow-xl">
          {/* Header */}
          <div className="mb-3 text-center">
            <input data-testid="ci-company-name" value={hdr.company_name} readOnly={!editable}
              onChange={(e) => setHdr({ ...hdr, company_name: e.target.value })}
              placeholder={t("company_name")}
              className="ci-head-input w-full text-center text-xl font-bold" style={{ borderBottom: "none" }} />
          </div>
          <div className="mb-4 flex flex-wrap justify-between gap-x-8 gap-y-1 border-y border-black/60 py-2 text-xs">
            <div className="space-y-1">
              <HeadField label={t("loading_date")} testid="ci-loading-date" type="date" value={hdr.loading_date} editable={editable} onChange={(v) => setHdr({ ...hdr, loading_date: v })} />
              <HeadField label={t("container_no")} testid="ci-container-no" value={hdr.container_no} editable={editable} onChange={(v) => setHdr({ ...hdr, container_no: v })} />
              <HeadField label={t("invoice_no")} testid="ci-invoice-no" value={hdr.invoice_number} editable={editable} onChange={(v) => setHdr({ ...hdr, invoice_number: v })} />
            </div>
            <div className="space-y-1">
              <HeadField label={t("final_destination")} testid="ci-destination" value={hdr.final_destination} editable={editable} onChange={(v) => setHdr({ ...hdr, final_destination: v })} />
              <HeadField label={t("bl_surrender_date")} testid="ci-bl-date" type="date" value={hdr.bl_surrender_date} editable={editable} onChange={(v) => setHdr({ ...hdr, bl_surrender_date: v })} />
            </div>
          </div>

          {/* Item pages */}
          {Array.from({ length: pages }).map((_, p) => (
            <ItemPage key={p} page={p} items={items} setCell={setCell} editable={editable} t={t} />
          ))}

          {/* Total */}
          <div className="mt-3 flex justify-end">
            <div className="flex items-center gap-4 border border-black px-4 py-1.5 text-sm font-bold">
              <span>{t("invoice_total")}</span>
              <span data-testid="ci-total">{money(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeadField({ label, value, onChange, editable, type = "text", testid }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 font-semibold">{label}:</span>
      <input data-testid={testid} type={type} value={value} readOnly={!editable}
        onChange={(e) => onChange(e.target.value)} className="ci-head-input min-w-[130px] flex-1" />
    </div>
  );
}

function ItemPage({ page, items, setCell, editable, t }) {
  const base = page * PER_PAGE;
  const rows = Array.from({ length: HALF }).map((_, r) => ({ left: base + r + 1, right: base + HALF + r + 1 }));
  return (
    <div className="mb-3">
      <table className="ci-table">
        <thead>
          <tr>
            <th style={{ width: "6%" }}>{t("no")}</th>
            <th style={{ width: "30%" }}>{t("item_name")}</th>
            <th style={{ width: "14%" }}>{t("price")}</th>
            <th style={{ width: "6%" }}>{t("no")}</th>
            <th style={{ width: "30%" }}>{t("item_name")}</th>
            <th style={{ width: "14%" }}>{t("price")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ left, right }) => (
            <tr key={left}>
              <Cell testid={`ci-no-${left}`} align="center">{left}</Cell>
              <InputCell no={left} field="name" items={items} setCell={setCell} editable={editable} />
              <InputCell no={left} field="price" items={items} setCell={setCell} editable={editable} numeric />
              <Cell testid={`ci-no-${right}`} align="center">{right}</Cell>
              <InputCell no={right} field="name" items={items} setCell={setCell} editable={editable} />
              <InputCell no={right} field="price" items={items} setCell={setCell} editable={editable} numeric />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ children, align = "start", testid }) {
  return <td data-testid={testid} className={`text-${align} px-1 py-0.5 text-xs`}>{children}</td>;
}

// Serial number of the cell directly BELOW (same column). Within a 60-slot page
// the left column is 1-30 and the right column is 31-60; at the bottom of a
// column we jump to the top of the SAME column on the next page (+31 slots).
function belowNo(n) {
  const pos = (n - 1) % 60;
  if (pos === 29 || pos === 59) return n + 31;
  return n + 1;
}

function focusCell(field, n) {
  const el = document.querySelector(`[data-testid="ci-${field}-${n}"]`);
  if (el) { el.focus(); if (el.select) el.select(); }
}

function InputCell({ no, field, items, setCell, editable, numeric }) {
  const val = items[no]?.[field] ?? "";
  return (
    <td>
      <input data-testid={`ci-${field}-${no}`} value={val} readOnly={!editable}
        onChange={(e) => setCell(no, field, e.target.value)}
        onKeyDown={(e) => {
          // Enter -> cell directly below in the same column (Excel/Numbers style).
          // Tab / Shift+Tab keep the browser default (next/previous editable cell).
          if (e.key === "Enter") { e.preventDefault(); focusCell(field, belowNo(no)); }
        }}
        inputMode={numeric ? "decimal" : "text"}
        className={`ci-cell-input ${numeric ? "text-end" : ""}`} />
    </td>
  );
}

/* ------------------------- Income TT ------------------------- */
function IncomeSection() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const editable = can("finance.edit");
  const [rows, setRows] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    try {
      const [tt, inv] = await Promise.all([api.get("/income-tt"), api.get("/container-invoices")]);
      setRows(tt.data); setInvoices(inv.data);
    } catch (e) { /* transient */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selectedInv = form && invoices.find((i) => i.invoice_number === form.invoice_number);

  const save = async () => {
    if (!form.invoice_number) { toast.error(t("select_invoice")); return; }
    try {
      const payload = {
        date: form.date, invoice_number: form.invoice_number,
        income_tt_amount: parseFloat(form.income_tt_amount) || 0,
      };
      if (form.id) await api.put(`/income-tt/${form.id}`, payload);
      else await api.post("/income-tt", payload);
      setForm(null); load(); toast.success(t("save"));
    } catch (e) { toast.error(apiError(e)); }
  };

  const remove = async (id) => {
    try { await api.delete(`/income-tt/${id}`); load(); toast.success(t("delete")); }
    catch (e) { toast.error(apiError(e)); }
  };

  const statusTone = { paid: "green", overpaid: "gold", partial: "gold", unpaid: "gray" };
  const statusLabel = { paid: t("paid_status"), overpaid: t("overpaid"), partial: t("partially_paid"), unpaid: t("unpaid") };

  return (
    <div>
      {editable && (
        <div className="mb-3">
          <Btn data-testid="add-tt-btn" onClick={() => setForm({ date: new Date().toISOString().slice(0, 10), invoice_number: "", income_tt_amount: "" })}>
            <Plus size={16} />{t("add_tt")}
          </Btn>
        </div>
      )}

      <div className="card-surface overflow-x-auto rounded-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-[var(--surface-2)] text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3 text-start">{t("date")}</th>
              <th className="p-3 text-start">{t("from_company")}</th>
              <th className="p-3 text-start">{t("container_no")}</th>
              <th className="p-3 text-start">{t("invoice_no")}</th>
              <th className="p-3 text-end">{t("cnr_amount")}</th>
              <th className="p-3 text-end">{t("income_tt_amount")}</th>
              <th className="p-3 text-end">{t("over_due")}</th>
              {editable && <th className="p-3 text-end">{t("action")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`tt-row-${r.id}`} className="border-b border-border hover:bg-white/5">
                <td className="p-3">{(r.date || "").slice(0, 10) || "—"}</td>
                <td className="p-3">{r.from || "—"}</td>
                <td className="p-3">{r.container_no || "—"}</td>
                <td className="p-3 font-mono text-[var(--gold)]">{r.invoice_number || "—"}</td>
                <td className="p-3 text-end">{money(r.cnr_amount || 0)}</td>
                <td className="p-3 text-end font-semibold">{money(r.income_tt_amount || 0)}</td>
                <td className="p-3 text-end">
                  <div className="flex items-center justify-end gap-2">
                    {r.due > 0 && <span className="text-red-400" data-testid={`tt-due-${r.id}`}>{t("total_due")}: {money(r.due)}</span>}
                    {r.over > 0 && <span className="text-sky-400" data-testid={`tt-over-${r.id}`}>{t("overpaid")}: {money(r.over)}</span>}
                    <Badge tone={statusTone[r.status] || "gray"}>{statusLabel[r.status] || r.status}</Badge>
                  </div>
                </td>
                {editable && (
                  <td className="p-3 text-end">
                    <div className="flex justify-end gap-1">
                      <Btn variant="ghost" data-testid={`tt-edit-${r.id}`} onClick={() => setForm({ id: r.id, date: (r.date || "").slice(0, 10), invoice_number: r.invoice_number || "", income_tt_amount: r.income_tt_amount ?? "" })}><Pencil size={16} /></Btn>
                      <Btn variant="ghost" data-testid={`tt-delete-${r.id}`} onClick={() => remove(r.id)}><Trash2 size={16} /></Btn>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={editable ? 8 : 7}><Empty text={t("no_data")} /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `${t("edit")} ${t("income_tt")}` : t("add_tt")} testid="tt-modal">
        {form && (
          <div>
            <Field label={t("select_invoice")}>
              <Select data-testid="tt-invoice-select" value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}>
                <option value="">—</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.invoice_number}>
                    {`${i.invoice_number || "(no number)"} · ${i.company_name || "—"}`}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedInv && (
              <div className="mb-3 grid grid-cols-3 gap-2 rounded-sm border border-border p-2 text-xs">
                <div><div className="text-muted-foreground">{t("from_company")}</div><div className="text-white">{selectedInv.company_name || "—"}</div></div>
                <div><div className="text-muted-foreground">{t("container_no")}</div><div className="text-white">{selectedInv.container_no || "—"}</div></div>
                <div><div className="text-muted-foreground">{t("cnr_amount")}</div><div data-testid="tt-cnr-preview" className="font-semibold gold-text">{money(selectedInv.total || 0)}</div></div>
              </div>
            )}
            <Field label={t("tt_date")}><Input data-testid="tt-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label={t("income_tt_amount")}><Input data-testid="tt-amount" type="number" value={form.income_tt_amount} onChange={(e) => setForm({ ...form, income_tt_amount: e.target.value })} /></Field>
            <div className="mt-2 flex justify-end gap-2">
              <Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn>
              <Btn data-testid="save-tt" onClick={save}>{t("save")}</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------- BL Amount (independent) ------------------------- */
function BLAmountSection() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const editable = can("finance.edit");
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);

  const load = useCallback(() => {
    api.get("/bl-amounts").then((r) => setRows(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const totalBL = rows.reduce((s, r) => s + Number(r.bl_amount || 0), 0);
  const totalPaid = rows.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
  const balance = totalBL - totalPaid;

  const openNew = () => setForm({
    date: new Date().toISOString().slice(0, 10), company_name: "", final_destination: "",
    container_no: "", invoice_number: "", bl_amount: "", paid_amount: "", paid_date: "", surrender_date: "",
  });

  const save = async () => {
    try {
      const payload = { ...form, bl_amount: Number(form.bl_amount || 0), paid_amount: Number(form.paid_amount || 0) };
      if (form.id) await api.put(`/bl-amounts/${form.id}`, payload);
      else await api.post("/bl-amounts", payload);
      toast.success(t("save")); setForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const remove = async (r) => {
    if (!window.confirm(`${t("delete")} ${r.invoice_number || r.container_no || t("bl_amount")}?`)) return;
    try { await api.delete(`/bl-amounts/${r.id}`); toast.success(t("delete")); load(); }
    catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card-surface rounded-sm border border-white/5 p-4">
          <div className="text-xs text-muted-foreground">{t("total_bl_amount")}</div>
          <div className="mt-1 font-head text-xl font-bold gold-text">{money(totalBL)}</div>
        </div>
        <div className="card-surface rounded-sm border border-white/5 p-4">
          <div className="text-xs text-muted-foreground">{t("total_paid_amount")}</div>
          <div className="mt-1 font-head text-xl font-bold text-emerald-400">{money(totalPaid)}</div>
        </div>
        <div className="card-surface rounded-sm border border-white/5 p-4">
          <div className="text-xs text-muted-foreground">{t("balance")}</div>
          <div className={`mt-1 font-head text-xl font-bold ${balance > 0 ? "text-red-400" : "text-emerald-400"}`}>{money(balance)}</div>
        </div>
      </div>

      {editable && <div className="mb-3"><Btn data-testid="add-bl-amount" onClick={openNew}><Plus size={16} />{t("add_bl_entry")}</Btn></div>}

      <div className="card-surface overflow-x-auto rounded-sm">
        <table className="w-full min-w-[920px] text-xs sm:text-sm">
          <thead className="border-b border-border bg-[var(--surface-2)] uppercase text-muted-foreground">
            <tr className="whitespace-nowrap">
              <th className="p-2 text-start">Date</th>
              <th className="p-2 text-start">Co.</th>
              <th className="p-2 text-start">Final Dest.</th>
              <th className="p-2 text-start">Cont. No.</th>
              <th className="p-2 text-start">Inv. No.</th>
              <th className="p-2 text-end">BL Amt.</th>
              <th className="p-2 text-end">Paid Amt.</th>
              <th className="p-2 text-start">Paid Dt.</th>
              <th className="p-2 text-start">Surr. Dt.</th>
              {editable && <th className="p-2 text-end">{t("action")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`bl-row-${r.id}`} className="border-b border-border hover:bg-white/5">
                <td className="whitespace-nowrap p-2">{(r.date || "").slice(0, 10) || "—"}</td>
                <td className="p-2">{r.company_name || "—"}</td>
                <td className="p-2">{r.final_destination || "—"}</td>
                <td className="whitespace-nowrap p-2 font-mono">{r.container_no || "—"}</td>
                <td className="whitespace-nowrap p-2 font-mono text-[var(--gold)]">{r.invoice_number || "—"}</td>
                <td className="whitespace-nowrap p-2 text-end">{money(r.bl_amount || 0)}</td>
                <td className="whitespace-nowrap p-2 text-end">{money(r.paid_amount || 0)}</td>
                <td className="whitespace-nowrap p-2">{(r.paid_date || "").slice(0, 10) || "—"}</td>
                <td className="whitespace-nowrap p-2">{(r.surrender_date || "").slice(0, 10) || "—"}</td>
                {editable && <td className="whitespace-nowrap p-2 text-end">
                  <Btn variant="ghost" onClick={() => setForm({ ...r })}><Pencil size={15} /></Btn>
                  <Btn variant="ghost" onClick={() => remove(r)}><Trash2 size={15} className="text-red-400" /></Btn>
                </td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={editable ? 10 : 9}><Empty text={t("no_data")} /></td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `${t("edit")} ${t("bl_amount")}` : t("add_bl_entry")} testid="bl-modal" wide>
        {form && <div>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <Field label={t("date")}><Input type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label={t("company_name")}><Input value={form.company_name || ""} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
            <Field label={t("final_destination")}><Input value={form.final_destination || ""} onChange={(e) => setForm({ ...form, final_destination: e.target.value })} /></Field>
            <Field label={t("container_no")}><Input value={form.container_no || ""} onChange={(e) => setForm({ ...form, container_no: e.target.value })} /></Field>
            <Field label={t("invoice_no")}><Input value={form.invoice_number || ""} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></Field>
            <Field label={t("bl_amount")}><Input type="number" value={form.bl_amount ?? ""} onChange={(e) => setForm({ ...form, bl_amount: e.target.value })} /></Field>
            <Field label={t("paid_amount")}><Input type="number" value={form.paid_amount ?? ""} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} /></Field>
            <Field label={t("paid_date")}><Input type="date" value={form.paid_date || ""} onChange={(e) => setForm({ ...form, paid_date: e.target.value })} /></Field>
            <Field label={t("surrender_date")}><Input type="date" value={form.surrender_date || ""} onChange={(e) => setForm({ ...form, surrender_date: e.target.value })} /></Field>
          </div>
          <div className="mt-2 flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn data-testid="save-bl" onClick={save}>{t("save")}</Btn></div>
        </div>}
      </Modal>
    </div>
  );
}

/* ------------------------- Monthly Summary ------------------------- */
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_FIELDS = [
  ["buying", "buying"],
  ["export_sales", "export_sales"],
  ["local_sales", "local_sales"],
  ["tt_received", "tt_received"],
  ["shipping_cost", "shipping_cost"],
  ["salary", "salary"],
  ["rent_expenses", "rent_expenses"],
];

function MonthlySummarySection() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const { company } = useCompany();
  const editable = can("finance.edit");
  const [years, setYears] = useState([]);
  const [year, setYear] = useState(null);
  const [data, setData] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [month, setMonth] = useState(null);
  const [form, setForm] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [loading, setLoading] = useState(false);

  const monthName = useCallback((m) => t(MONTH_KEYS[(Number(m) || 1) - 1]), [t]);

  const loadYears = useCallback(async (preferred) => {
    const { data: y } = await api.get("/monthly-summary/years");
    setYears(y.years || []);
    const next = preferred ?? year ?? y.current_fiscal_year_start;
    setYear(next);
    return next;
  }, [year]);

  const loadData = useCallback(async (fy) => {
    if (fy == null) return;
    setLoading(true);
    try {
      const [cur, prev] = await Promise.all([
        api.get(`/monthly-summary/${fy}`),
        api.get(`/monthly-summary/${fy - 1}`).catch(() => ({ data: null })),
      ]);
      setData(cur.data);
      setPrevious(prev.data?.has_data ? prev.data : null);
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const foundCurrent = (cur.data.months || []).find((r) => r.month === currentMonth && r.calendar_year === now.getFullYear());
      const keep = (cur.data.months || []).find((r) => r.month === month);
      const selected = keep || foundCurrent || (cur.data.months || [])[0] || null;
      setMonth(selected?.month ?? null);
      setForm(selected ? rowToForm(selected) : null);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    const requested = Number(new URLSearchParams(window.location.search).get("year"));
    const preferred = Number.isFinite(requested) && requested >= 2000 ? requested : undefined;
    loadYears(preferred).then((fy) => loadData(fy)).catch((e) => toast.error(apiError(e)));
    // Company changes trigger a full app reload, so this is intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data || month == null) return;
    const r = data.months.find((x) => x.month === month);
    if (r) setForm(rowToForm(r));
  }, [month, data]);

  const selected = useMemo(() => data?.months?.find((r) => r.month === month) || null, [data, month]);
  const previousSelected = useMemo(() => previous?.months?.find((r) => r.month === month) || null, [previous, month]);
  const preview = useMemo(() => calcForm(form), [form]);

  const changeYear = async (value) => {
    const fy = Number(value);
    setYear(fy);
    setMonth(null);
    setForm(null);
    await loadData(fy);
  };

  const saveMonth = async () => {
    if (!form || month == null || year == null) return;
    try {
      const payload = {};
      MONTH_FIELDS.forEach(([key]) => { payload[key] = Number(form[key] || 0); });
      payload.opening_stock = Number(form.opening_stock || 0);
      payload.closing_stock = Number(form.closing_stock || 0);
      await api.put(`/monthly-summary/${year}/${month}`, payload);
      toast.success(t("save"));
      await loadData(year);
      await loadYears(year);
    } catch (e) { toast.error(apiError(e)); }
  };

  const createNextYear = async () => {
    const next = Math.max(year ?? 0, ...(years.map((x) => Number(x.fiscal_year_start) || 0))) + 1;
    try {
      await api.post(`/monthly-summary/years/${next}`);
      await loadYears(next);
      await loadData(next);
      toast.success(`${t("new_fiscal_year")}: ${next}-${String(next + 1).slice(-2)}`);
    } catch (e) { toast.error(apiError(e)); }
  };

  const closeOrReopen = async () => {
    if (!data || year == null) return;
    const action = data.closed ? "reopen" : "close";
    const msg = data.closed
      ? `${t("reopen_year")} ${data.label}?`
      : `${t("close_year")} ${data.label}?`;
    if (!window.confirm(msg)) return;
    try {
      await api.post(`/monthly-summary/${year}/${action}`);
      await loadData(year);
      await loadYears(year);
      toast.success(data.closed ? t("year_open") : t("year_closed"));
    } catch (e) { toast.error(apiError(e)); }
  };

  const printSummary = (scope) => {
    if (!data) return;
    const rows = scope === "month" && selected ? [selected] : data.months;
    const title = scope === "month" && selected
      ? `${company} · ${monthName(selected.month)} ${selected.calendar_year}`
      : `${company} · ${t("fiscal_year")} ${data.label}`;
    const annual = data.annual || {};
    const htmlRows = rows.map((r) => `
      <tr>
        <td>${monthName(r.month)} ${r.calendar_year}</td>
        <td>${money(r.opening_stock)}</td><td>${money(r.buying)}</td><td>${money(r.export_sales)}</td><td>${money(r.local_sales)}</td>
        <td>${money(r.tt_received)}</td><td>${money(r.shipping_cost)}</td><td>${money(r.salary)}</td>
        <td>${money(r.rent_expenses)}</td><td>${money(r.closing_stock)}</td><td>${money(r.cogs)}</td>
        <td>${money(r.provisional_profit)}</td><td>${Number(r.profit_margin_pct || 0).toFixed(2)}%</td>
      </tr>`).join("");
    const tt = annual.tt_position || {};
    const ttText = tt.status === "outstanding" ? `${t("tt_outstanding")}: ${money(tt.amount || 0)}`
      : tt.status === "over" ? `${t("tt_over_received")}: ${money(tt.amount || 0)}` : t("tt_matched");
    const w = printWindow();
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{font-size:20px}h2{font-size:15px;margin-top:20px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #bbb;padding:6px;text-align:right}th:first-child,td:first-child{text-align:left}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.box{border:1px solid #aaa;padding:8px}.muted{font-size:10px;color:#555}@media print{button{display:none}}</style>
      </head><body><h1>${title}</h1><div class="muted">${t("provisional_profit_loss")} · ${t("tt_position")}</div>
      <table><thead><tr><th>${t("month")}</th><th>${t("opening_stock")}</th><th>${t("buying")}</th><th>${t("export_sales")}</th><th>${t("local_sales")}</th><th>${t("tt_received")}</th><th>${t("shipping_cost")}</th><th>${t("salary")}</th><th>${t("rent_expenses")}</th><th>${t("closing_stock")}</th><th>${t("cogs")}</th><th>${t("profit_loss")}</th><th>${t("profit_margin")}</th></tr></thead><tbody>${htmlRows}</tbody></table>
      ${scope === "year" ? `<h2>${t("annual_summary")}</h2><div class="summary"><div class="box">${t("opening_stock")}<br><b>${money(annual.opening_stock || 0)}</b></div><div class="box">${t("closing_stock")}<br><b>${money(annual.closing_stock || 0)}</b></div><div class="box">${t("cogs")}<br><b>${money(annual.cogs || 0)}</b></div><div class="box">${t("total_sales")}<br><b>${money(annual.total_sales || 0)}</b></div><div class="box">${t("total_cost")}<br><b>${money(annual.total_cost || 0)}</b></div><div class="box">${t("provisional_profit_loss")}<br><b>${money(annual.provisional_profit || 0)}</b></div><div class="box">${t("profit_margin")}<br><b>${Number(annual.profit_margin_pct || 0).toFixed(2)}%</b></div><div class="box">${t("tt_position")}<br><b>${ttText}</b></div></div>` : ""}
      <script>window.onload=()=>{window.print();}</script></body></html>`);
    w.document.close();
  };

  const ttLabel = (pos) => {
    if (!pos) return t("tt_matched");
    if (pos.status === "outstanding") return `${t("tt_outstanding")}: ${money(pos.amount || 0)}`;
    if (pos.status === "over") return `${t("tt_over_received")}: ${money(pos.amount || 0)}`;
    return t("tt_matched");
  };

  if (!data || year == null) {
    return <div className="card-surface rounded-sm p-8 text-center text-muted-foreground">{loading ? "…" : t("no_data")}</div>;
  }

  const annualCards = [
    ["opening_stock", data.annual.opening_stock], ["buying", data.annual.buying], ["export_sales", data.annual.export_sales],
    ["local_sales", data.annual.local_sales], ["tt_received", data.annual.tt_received], ["shipping_cost", data.annual.shipping_cost],
    ["salary", data.annual.salary], ["rent_expenses", data.annual.rent_expenses], ["closing_stock", data.annual.closing_stock],
    ["cogs", data.annual.cogs], ["total_sales", data.annual.total_sales], ["total_cost", data.annual.total_cost],
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[170px]">
            <div className="mb-1 text-xs text-muted-foreground">{t("fiscal_year")}</div>
            <Select value={year} onChange={(e) => changeYear(e.target.value)}>
              {years.map((y) => <option key={y.fiscal_year_start} value={y.fiscal_year_start}>{y.label}{y.closed ? ` · ${t("year_closed")}` : ""}</option>)}
              {!years.some((y) => Number(y.fiscal_year_start) === Number(year)) && <option value={year}>{data.label}</option>}
            </Select>
          </div>
          <div className="rounded-sm border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-3 py-2 text-sm font-bold text-[var(--gold)]">
            {company} · {company === "MTC" ? `${t("jul")} → ${t("jun")}` : `${t("jun")} → ${t("may")}`}
          </div>
          <Badge tone={data.closed ? "gray" : "green"}>{data.closed ? t("year_closed") : t("year_open")}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="dark" onClick={() => printSummary("month")} disabled={!selected}><Printer size={16} />{t("print_pdf_month")}</Btn>
          <Btn variant="dark" onClick={() => printSummary("year")}><Printer size={16} />{t("print_pdf_year")}</Btn>
          {editable && <Btn variant="dark" onClick={createNextYear}><Plus size={16} />{t("new_fiscal_year")}</Btn>}
          {editable && <Btn variant={data.closed ? "gold" : "dark"} onClick={closeOrReopen}>
            {data.closed ? <Unlock size={16} /> : <Lock size={16} />}{data.closed ? t("reopen_year") : t("close_year")}
          </Btn>}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {data.months.map((r) => {
          const active = r.month === month;
          const profitPositive = Number(r.provisional_profit || 0) >= 0;
          return (
            <button key={`${r.calendar_year}-${r.month}`} onClick={() => setMonth(r.month)}
              className={`rounded-sm border p-3 text-start transition-colors ${active ? "border-[var(--gold)] bg-[var(--gold)]/10" : "border-border bg-[var(--surface-2)] hover:border-[var(--gold)]/50"}`}>
              <div className="text-xs text-muted-foreground">{r.calendar_year}</div>
              <div className="font-semibold text-white">{monthName(r.month)}</div>
              <div className={`mt-1 text-sm font-bold ${profitPositive ? "text-emerald-400" : "text-red-400"}`}>{money(r.provisional_profit || 0)}</div>
              <div className="text-[11px] text-muted-foreground">{t("profit_margin")}: {Number(r.profit_margin_pct || 0).toFixed(2)}%</div>
            </button>
          );
        })}
      </div>

      {selected && form && (
        <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_.8fr]">
          <div className="card-surface rounded-sm border border-white/5 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t("monthly_totals")}</div>
                <div className="font-head text-xl font-bold text-white">{monthName(selected.month)} {selected.calendar_year}</div>
              </div>
              {data.closed && <div className="text-xs text-amber-300">{t("closed_year_edit_hint")}</div>}
            </div>
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t("opening_stock")}>
                <Input type="number" min="0" step="0.01" value={form.opening_stock}
                  disabled={!editable || data.closed || !selected.opening_stock_manual}
                  onChange={(e) => setForm({ ...form, opening_stock: e.target.value })} />
                {!selected.opening_stock_manual && <div className="mt-1 text-[11px] text-muted-foreground">{t("auto_from_previous_month")}</div>}
              </Field>
              {MONTH_FIELDS.map(([key, label]) => (
                <Field key={key} label={t(label)}>
                  <Input type="number" min="0" step="0.01" value={form[key]} disabled={!editable || data.closed}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                </Field>
              ))}
              <Field label={t("closing_stock")}>
                <Input type="number" min="0" step="0.01" value={form.closing_stock} disabled={!editable || data.closed}
                  onChange={(e) => setForm({ ...form, closing_stock: e.target.value })} />
              </Field>
            </div>
            {editable && !data.closed && <div className="flex justify-end"><Btn onClick={saveMonth}>{t("save_month")}</Btn></div>}
          </div>

          <div className="space-y-3">
            <ResultCard label={t("total_sales")} value={money(preview.total_sales)} />
            <ResultCard label={t("cogs")} value={money(preview.cogs)} />
            <ResultCard label={t("total_cost")} value={money(preview.total_cost)} />
            <ResultCard label={t("provisional_profit_loss")} value={money(preview.provisional_profit)} positive={preview.provisional_profit >= 0} />
            <ResultCard label={t("profit_margin")} value={`${preview.profit_margin_pct.toFixed(2)}%`} positive={preview.provisional_profit >= 0} />
            <ResultCard label={`${t("tt_position")} · YTD`} value={ttLabel(selected.tt_ytd)} />
          </div>
        </div>
      )}

      <div className="mb-6 card-surface rounded-sm border border-white/5 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="font-head text-lg font-bold gold-text">{t("annual_summary")} · {data.label}</div>
          <Btn variant="ghost" onClick={() => setShowCompare((v) => !v)}>{t("compare_previous_year")}</Btn>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {annualCards.map(([label, value]) => <SmallStat key={label} label={t(label)} value={money(value || 0)} />)}
          <SmallStat label={t("provisional_profit_loss")} value={money(data.annual.provisional_profit || 0)} strong positive={Number(data.annual.provisional_profit || 0) >= 0} />
          <SmallStat label={t("profit_margin")} value={`${Number(data.annual.profit_margin_pct || 0).toFixed(2)}%`} strong positive={Number(data.annual.provisional_profit || 0) >= 0} />
          <SmallStat label={t("tt_position")} value={ttLabel(data.annual.tt_position)} strong />
        </div>
      </div>

      {showCompare && selected && (
        <div className="card-surface overflow-x-auto rounded-sm border border-white/5 p-4">
          <div className="mb-3 font-head text-lg font-bold text-white">{t("compare_previous_year")} · {monthName(selected.month)}</div>
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr><th className="p-2 text-start"></th><th className="p-2 text-end">{t("buying")}</th><th className="p-2 text-end">{t("total_sales")}</th><th className="p-2 text-end">{t("provisional_profit_loss")}</th><th className="p-2 text-end">{t("profit_margin")}</th></tr>
            </thead>
            <tbody>
              <CompareRow label={`${t("current_year")} · ${selected.calendar_year}`} row={selected} money={money} />
              <CompareRow label={`${t("previous_year")} · ${previousSelected?.calendar_year || "—"}`} row={previousSelected} money={money} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function rowToForm(r) {
  const out = { opening_stock: r?.opening_stock ?? 0, closing_stock: r?.closing_stock ?? 0 };
  MONTH_FIELDS.forEach(([key]) => { out[key] = r?.[key] ?? 0; });
  return out;
}

function calcForm(form) {
  const v = { opening_stock: Number(form?.opening_stock || 0), closing_stock: Number(form?.closing_stock || 0) };
  MONTH_FIELDS.forEach(([key]) => { v[key] = Number(form?.[key] || 0); });
  const total_sales = v.export_sales + v.local_sales;
  const cogs = v.opening_stock + v.buying - v.closing_stock;
  const total_cost = cogs + v.shipping_cost + v.salary + v.rent_expenses;
  const provisional_profit = total_sales - total_cost;
  const profit_margin_pct = total_sales ? provisional_profit / total_sales * 100 : 0;
  return { ...v, cogs, total_sales, total_cost, provisional_profit, profit_margin_pct };
}

function ResultCard({ label, value, positive }) {
  const cls = positive === undefined ? "gold-text" : positive ? "text-emerald-400" : "text-red-400";
  return <div className="card-surface rounded-sm border border-white/5 p-4"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 font-head text-xl font-bold ${cls}`}>{value}</div></div>;
}

function SmallStat({ label, value, strong, positive }) {
  const cls = positive === undefined ? (strong ? "text-white" : "gold-text") : positive ? "text-emerald-400" : "text-red-400";
  return <div className="rounded-sm border border-border bg-[var(--surface-2)] p-3"><div className="text-[11px] text-muted-foreground">{label}</div><div className={`mt-1 text-sm ${strong ? "font-bold" : "font-semibold"} ${cls}`}>{value}</div></div>;
}

function CompareRow({ label, row, money }) {
  if (!row) return <tr className="border-b border-border"><td className="p-2">{label}</td><td className="p-2 text-end" colSpan={4}>—</td></tr>;
  return (
    <tr className="border-b border-border">
      <td className="p-2 font-semibold text-white">{label}</td>
      <td className="p-2 text-end">{money(row.buying || 0)}</td>
      <td className="p-2 text-end">{money(row.total_sales || 0)}</td>
      <td className={`p-2 text-end font-semibold ${Number(row.provisional_profit || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{money(row.provisional_profit || 0)}</td>
      <td className="p-2 text-end">{Number(row.profit_margin_pct || 0).toFixed(2)}%</td>
    </tr>
  );
}

/* ------------------------- Summary ------------------------- */
function SummarySection() {
  const { t } = useI18n();
  const { money } = useSettings();
  const [s, setS] = useState(null);

  useEffect(() => {
    api.get("/container-tt/summary").then((r) => setS(r.data)).catch(() => {});
  }, []);

  const cards = [
    { label: t("total_container_invoice"), value: s?.total_invoice_amount, color: "#D4AF37", testid: "sum-invoice" },
    { label: t("total_income_tt"), value: s?.total_tt_received, color: "#34d399", testid: "sum-tt" },
    { label: "Amount to Receive / لینا باقی", value: s?.amount_to_receive ?? s?.total_due, color: "#f87171", testid: "sum-due" },
    { label: "Extra Received / اضافی وصولی", value: s?.extra_received ?? s?.total_over, color: "#38bdf8", testid: "sum-over" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {cards.map((c) => (
        <div key={c.testid} data-testid={c.testid} className="card-surface rounded-sm border border-white/5 p-6">
          <div className="text-sm text-muted-foreground">{c.label}</div>
          <div className="mt-2 font-head text-3xl font-black" style={{ color: c.color }}>{money(c.value || 0)}</div>
        </div>
      ))}
    </div>
  );
}
