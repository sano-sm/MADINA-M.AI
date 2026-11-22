import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Badge, DataTable } from "@/components/kit";
import { toast } from "sonner";
import { Search, Plus, Trash2, Pencil } from "lucide-react";
import { PurchaseBox } from "@/components/PurchaseBox";

const today = () => new Date().toISOString().slice(0, 10);
const emptyPart = { purchase_date: "", name: "", quantity: 1, unit_cost: 0, sale_price: 0, supplier: "", part_number: "", category: "", location: "", payment_method: "bank", purchase_company: "MTC" };
const emptyTracked = (type) => ({ date: today(), part_type: type, name: "", supplier: "", purchase_price: "", payment_method: "bank", purchase_company: "MTC" });

export default function Parts() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const editable = can("parts.edit");
  const [tab, setTab] = useState("parts");
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null);

  const load = useCallback(() => {
    if (tab === "parts") {
      api.get(`/parts${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => setRows((r.data || []).filter((x) => !x.source_vehicle_id))).catch(() => setRows([]));
    } else {
      api.get(`/tracked-parts?type=${tab}`).then((r) => {
        const s = (q || "").trim().toLowerCase();
        setRows((r.data || []).filter((x) => x.source === "direct" && (!s || `${x.name || ""} ${x.supplier || ""} ${x.engine_code || ""} ${x.engine_number || ""}`.toLowerCase().includes(s))));
      }).catch(() => setRows([]));
    }
  }, [tab, q]);
  useEffect(() => { load(); }, [load]);

  const openAdd = () => setForm(tab === "parts" ? { ...emptyPart, purchase_date: today(), purchase_company: "MTC" } : emptyTracked(tab));
  const openEdit = (r) => {
    if (tab === "parts") setForm({ ...emptyPart, ...r, purchase_date: (r.purchase_date || r.created_at || "").slice(0, 10), payment_method: r.payment_method || "", purchase_company: r.purchase_company || "MTC" });
    else setForm({ ...emptyTracked(tab), ...r, date: (r.date || r.purchase_date || r.created_at || "").slice(0, 10), payment_method: r.payment_method || "", purchase_company: r.purchase_company || "MTC" });
  };

  const save = async () => {
    try {
      if (tab === "parts") {
        const payload = { ...form, quantity: +form.quantity || 0, unit_cost: +form.unit_cost || 0, sale_price: +form.sale_price || 0, purchase_company: form.purchase_company || "MTC" };
        if (!payload.name || payload.quantity <= 0) { toast.error(t("required_fields")); return; }
        if (form.id) await api.put(`/parts/${form.id}`, payload); else await api.post("/parts", payload);
      } else {
        const payload = { date: form.date, part_type: tab, name: form.name, supplier: form.supplier,
          purchase_price: +form.purchase_price || 0, payment_method: form.payment_method || null,
          purchase_company: form.purchase_company || "MTC" };
        if (!payload.name) { toast.error(t("required_fields")); return; }
        if (form.id) await api.put(`/tracked-parts/${form.id}`, payload); else await api.post("/tracked-parts", payload);
      }
      toast.success(t("save")); setForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const saveRef = useRef(null);
  saveRef.current = save;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("voice") === "new" && editable && !form) {
      setTab("parts"); setForm({ ...emptyPart, purchase_date: today(), purchase_company: "MTC" });
    }
  }, [editable, form]);
  useEffect(() => {
    const onVoice = (event) => {
      const text = String(event.detail?.command || "");
      if (!form || !/(part|parts|پارٹ|پارٹس|پرزہ|name|نام|quantity|مقدار|cost|قیمت|supplier|سپلائر|category|زمرہ|location|جگہ)/i.test(text)) return;
      const read = (labels) => {
        const match = text.match(new RegExp(`(?:${labels.join("|")})\\s*(?:is|ہے|:)?\\s*([^,;|]+?)(?=\\s+(?:name|نام|quantity|مقدار|cost|قیمت|supplier|سپلائر|category|زمرہ|location|جگہ)\\b|[,;|]|$)`, "i"));
        return match ? match[1].trim() : "";
      };
      const updates = {};
      const name = read(["part name", "name", "پارٹ کا نام", "نام"]); if (name) updates.name = name;
      const quantity = read(["quantity", "مقدار"]); if (quantity) updates.quantity = quantity.replace(/[^0-9.]/g, "");
      const unitCost = read(["unit cost", "cost", "خرید قیمت", "قیمت"]); if (unitCost) updates.unit_cost = unitCost.replace(/[^0-9.]/g, "");
      const supplier = read(["supplier", "from", "سپلائر"]); if (supplier) updates.supplier = supplier;
      const category = read(["category", "زمرہ"]); if (category) updates.category = category;
      const location = read(["location", "جگہ"]); if (location) updates.location = location;
      const number = read(["part number", "number", "پارٹ نمبر"]); if (number) updates.part_number = number;
      if (Object.keys(updates).length) setForm((current) => ({ ...current, ...updates }));
      if (/\b(confirm|save|yes|okay|ok)\b|تصدیق|محفوظ|ہاں|ٹھیک ہے/i.test(text)) window.setTimeout(() => saveRef.current?.(), 0);
    };
    window.addEventListener("mai:voice-command", onVoice);
    return () => window.removeEventListener("mai:voice-command", onVoice);
  }, [form]);

  const delPart = async (id) => {
    if (!window.confirm("Delete?")) return;
    try { await api.delete(`/parts/${id}`); load(); } catch (e) { toast.error(apiError(e)); }
  };

  const companyBadge = (r) => <span title="Purchase company" className="inline-flex min-w-[34px] justify-center rounded border border-[var(--gold)]/35 bg-[var(--gold)]/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[var(--gold)]">{r.purchase_company || "MTC"}</span>;

  const partCols = [
    { label: t("date"), render: (p) => (p.purchase_date || p.created_at || "").slice(0, 10) },
    { label: t("part_name"), render: (p) => p.name },
    { label: t("quantity"), render: (p) => <Badge tone={p.quantity > 0 ? "green" : "red"}>{p.quantity}</Badge> },
    { label: t("unit_cost"), align: "end", render: (p) => money(p.unit_cost) },
    { label: t("sale_price"), align: "end", render: (p) => money(p.sale_price) },
    { label: t("from_label"), render: (p) => p.supplier || "—" },
    { label: "", render: companyBadge },
    { label: t("action"), action: true, render: (p) => editable && <div className="flex gap-1"><Btn variant="ghost" onClick={() => openEdit(p)}><Pencil size={15} /></Btn><Btn variant="ghost" onClick={() => delPart(p.id)}><Trash2 size={16} className="text-red-400" /></Btn></div> },
  ];
  const trackedCols = [
    { label: t("date"), render: (r) => (r.date || r.purchase_date || r.created_at || "").slice(0, 10) },
    { label: t("name"), render: (r) => r.name || r.engine_code || "—" },
    { label: t("from_label"), render: (r) => r.supplier || "—" },
    { label: t("purchase_price"), align: "end", render: (r) => money(r.purchase_price || 0) },
    { label: t("status"), render: (r) => <Badge tone={r.status === "sold" ? "red" : "green"}>{r.status === "sold" ? t("sold") : t("available")}</Badge> },
    { label: "", render: companyBadge },
    { label: t("action"), action: true, render: (r) => editable && <Btn variant="ghost" onClick={() => openEdit(r)}><Pencil size={15} /></Btn> },
  ];

  const CompanySelector = () => <div className="mb-3 flex items-center gap-2">
    <span className="text-xs text-muted-foreground">Company</span>
    {["MTC", "TSK"].map((code) => <button key={code} type="button"
      onClick={() => setForm({ ...form, purchase_company: code })}
      className={`rounded border px-2.5 py-1 text-xs font-bold ${((form.purchase_company || "MTC") === code) ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]" : "border-border text-muted-foreground"}`}>
      {((form.purchase_company || "MTC") === code) ? "✓ " : ""}{code}
    </button>)}
  </div>;

  return <div>
    <PageHeader title={t("parts_inventory")} actions={editable && <Btn onClick={openAdd}><Plus size={16} />{tab === "parts" ? t("add_part") : t("add_engine_halfcut")}</Btn>} />
    <PurchaseBox kind="parts" />
    <div className="mb-4 flex flex-wrap gap-2">
      {[["parts", t("parts_short")], ["engine", t("engine")], ["half_cut", t("half_cut")]].map(([k, label]) => <button key={k} onClick={() => { setTab(k); setQ(""); setForm(null); }} className={`rounded-sm border px-5 py-2 text-sm font-medium ${tab === k ? "gold-gradient border-transparent text-black" : "border-border text-gray-300 hover:text-white"}`}>{label}</button>)}
    </div>
    <div className="mb-4 flex max-w-md items-center gap-2 card-surface rounded-sm px-3 py-2">
      <Search size={16} className="text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="w-full bg-transparent text-sm text-white outline-none" />
    </div>
    <DataTable columns={tab === "parts" ? partCols : trackedCols} rows={rows} rowKey={(r) => r.id} empty={t("no_data")} />

    <Modal open={!!form} onClose={() => setForm(null)} title={tab === "parts" ? (form?.id ? t("edit") : t("add_part")) : (form?.id ? t("edit_engine_halfcut") : t("add_engine_halfcut"))} wide>
      {form && tab === "parts" && <div>
        <CompanySelector />
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <Field label={t("date")}><Input type="date" value={form.purchase_date || ""} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></Field>
          <Field label={t("part_name")}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t("quantity")}><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
          <Field label={t("unit_cost")}><Input type="number" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></Field>
          <Field label={t("sale_price")}><Input type="number" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} /></Field>
          <Field label={t("from_label")}><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
          <PaymentMethod t={t} value={form.payment_method || ""} onChange={(payment_method) => setForm({ ...form, payment_method })} />
          <Field label={t("part_number")}><Input value={form.part_number || ""} onChange={(e) => setForm({ ...form, part_number: e.target.value })} /></Field>
          <Field label={t("category")}><Input value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
          <Field label={t("location")}><Input value={form.location || ""} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn onClick={save}>{t("save")}</Btn></div>
      </div>}
      {form && tab !== "parts" && <div>
        <CompanySelector />
        <Field label={t("date")}><Input type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label={tab === "engine" ? t("engine_name_code") : t("hcut_desc")}><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={t("from_label")}><Input value={form.supplier || ""} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
        <Field label={t("purchase_price")}><Input type="number" value={form.purchase_price || ""} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} /></Field>
        <PaymentMethod t={t} value={form.payment_method || ""} onChange={(payment_method) => setForm({ ...form, payment_method })} />
        <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn onClick={save}>{t("save")}</Btn></div>
      </div>}
    </Modal>
  </div>;
}

function PaymentMethod({ t, value, onChange }) {
  return <Field label={t("payment_method")}><Select value={value} onChange={(e) => onChange(e.target.value)}><option value="">{t("not_recorded")}</option><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>;
}
