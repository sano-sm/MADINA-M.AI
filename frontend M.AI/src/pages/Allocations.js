import React, { useEffect, useState, useCallback } from "react";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Field, Input, Empty, Badge, DataTable, Select } from "@/components/kit";
import { toast } from "sonner";
import { Trash2, Pencil, X } from "lucide-react";

export default function Allocations() {
  const { t } = useI18n();
  const [tab, setTab] = useState("scrap");
  return (
    <div>
      <PageHeader title={t("allocations")} />
      <div className="mb-5 flex flex-wrap gap-2">
        {["scrap", "shokubai", "small_sales"].map((x) => (
          <button key={x} data-testid={`alloc-tab-${x}`} onClick={() => setTab(x)}
            className={`rounded-sm border px-4 py-2 text-sm font-medium transition-colors ${tab === x ? "gold-gradient border-transparent text-black" : "border-border text-gray-300 hover:text-white"}`}>
            {x === "small_sales" ? "Small Sales" : t(x)}
          </button>))}
      </div>
      {tab === "scrap" ? <Scrap t={t} /> : tab === "shokubai" ? <Shokubai t={t} /> : <SmallSales />}
    </div>
  );
}

function Scrap({ t }) {
  const { money } = useSettings();
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ month: new Date().toISOString().slice(0, 7), total_amount: "" });
  const load = useCallback(() => { api.get("/scrap-allocations").then((r) => setRows(r.data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    try { await api.post("/scrap-allocations", { ...form, total_amount: +form.total_amount || 0 }); toast.success(t("allocate")); setForm({ ...form, total_amount: "" }); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  return (
    <div>
      {can("finance.edit") && (
        <div className="mb-4 flex flex-wrap items-end gap-3 card-surface rounded-sm p-4">
          <div className="w-full min-w-0 sm:w-44"><Field label={t("scrap_month")}><Input type="month" data-testid="scrap-month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} /></Field></div>
          <div className="w-full min-w-0 sm:w-40"><Field label={t("total_amount")}><Input type="number" data-testid="scrap-total" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} /></Field></div>
          <Btn data-testid="scrap-allocate" onClick={create}>{t("allocate")}</Btn>
        </div>
      )}
      <List rows={rows} money={money} t={t} kind="scrap" reload={load} canReverse={can("records.reverse")} />
    </div>
  );
}

function Shokubai({ t }) {
  const { money } = useSettings();
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ sale_date: new Date().toISOString().slice(0, 10), total_amount: "" });
  const load = useCallback(() => { api.get("/shokubai-allocations").then((r) => setRows(r.data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    try { await api.post("/shokubai-allocations", { ...form, total_amount: +form.total_amount || 0 }); toast.success(t("allocate")); setForm({ ...form, total_amount: "" }); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  return (
    <div>
      {can("finance.edit") && (
        <div className="mb-4 flex flex-wrap items-end gap-3 card-surface rounded-sm p-4">
          <div className="w-full min-w-0 sm:w-44"><Field label={t("cut_off_date")}><Input type="date" data-testid="shok-date" value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} /></Field></div>
          <div className="w-full min-w-0 sm:w-40"><Field label={t("total_amount")}><Input type="number" data-testid="shok-total" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} /></Field></div>
          <Btn data-testid="shok-allocate" onClick={create}>{t("allocate")}</Btn>
        </div>
      )}
      <List rows={rows} money={money} t={t} kind="shokubai" reload={load} canReverse={can("records.reverse")} />
    </div>
  );
}

function SmallSales() {
  const { money } = useSettings();
  const { can } = useAuth();
  const blank = () => ({ date: new Date().toISOString().slice(0, 10), item_name: "", sold_to: "", amount: "", method: "cash", note: "" });
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(blank());
  const [editingId, setEditingId] = useState(null);
  const load = useCallback(() => { api.get("/small-sales").then((r) => setRows(r.data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.item_name.trim()) return toast.error("Item Name is required");
    if (!(+form.amount > 0)) return toast.error("Amount must be greater than zero");
    const payload = { ...form, amount: +form.amount };
    try {
      if (editingId) await api.put(`/small-sales/${editingId}`, payload);
      else await api.post("/small-sales", payload);
      toast.success(editingId ? "Small Sale updated" : "Small Sale saved");
      setEditingId(null); setForm(blank()); load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const edit = (r) => {
    setEditingId(r.id);
    setForm({ date: (r.date || "").slice(0, 10), item_name: r.item_name || "", sold_to: r.sold_to || "", amount: String(r.amount ?? ""), method: r.method || "cash", note: r.note || "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancel = () => { setEditingId(null); setForm(blank()); };
  const del = async (id) => {
    if (!window.confirm("Delete this Small Sale? Cash/Bank and Summary will also be reversed.")) return;
    try { await api.delete(`/small-sales/${id}`); toast.success("Small Sale deleted"); if (editingId === id) cancel(); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const columns = [
    { label: "Date", render: (r) => (r.date || "").slice(0, 10) },
    { label: "Item", render: (r) => r.item_name || "—" },
    { label: "Sold To", render: (r) => r.sold_to || "—" },
    { label: "Payment", align: "center", render: (r) => <Badge>{r.method === "bank" ? "Bank" : "Cash"}</Badge> },
    { label: "Amount", align: "end", cell: "gold-text", render: (r) => money(r.amount) },
    { label: "Note", render: (r) => r.note || "—" },
    { label: "Edit", action: true, render: (r) => can("finance.edit") && <Btn variant="ghost" onClick={() => edit(r)}><Pencil size={16} /></Btn> },
    { label: "Delete", action: true, render: (r) => can("records.reverse") && <Btn variant="ghost" onClick={() => del(r.id)}><Trash2 size={16} className="text-red-400" /></Btn> },
  ];
  return <div>
    {can("finance.edit") && <div className="mb-4 flex flex-wrap items-end gap-3 card-surface rounded-sm p-4">
      <div className="w-44"><Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field></div>
      <div className="w-52"><Field label="Item Name"><Input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} placeholder="What was sold?" /></Field></div>
      <div className="w-52"><Field label="Sold To"><Input value={form.sold_to} onChange={(e) => setForm({ ...form, sold_to: e.target.value })} placeholder="Buyer / customer" /></Field></div>
      <div className="w-40"><Field label="Amount"><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field></div>
      <div className="w-36"><Field label="Payment"><Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank</option></Select></Field></div>
      <div className="min-w-52 flex-1"><Field label="Note"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional" /></Field></div>
      <Btn onClick={save}>{editingId ? "Update" : "Save"}</Btn>
      {editingId && <Btn variant="ghost" onClick={cancel}><X size={16} />Cancel</Btn>}
    </div>}
    <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} rowTestId={(r) => `small-sale-row-${r.id}`} empty="No Small Sales" />
  </div>;
}

function List({ rows, money, t, kind, reload, canReverse }) {
  const del = async (id) => { if (!window.confirm(t("reverse") + "?")) return; try { await api.delete(`/${kind === "scrap" ? "scrap" : "shokubai"}-allocations/${id}`); toast.success(t("reverse")); reload(); } catch (e) { toast.error(apiError(e)); } };
  const columns = [
    { label: kind === "scrap" ? t("scrap_month") : t("cut_off_date"), render: (r) => kind === "scrap" ? r.month : `${r.prev_cutoff} → ${r.new_cutoff}` },
    { label: t("total_amount"), align: "end", render: (r) => money(r.total_amount) },
    { label: t("vehicle_count"), align: "center", render: (r) => <Badge>{r.vehicle_count}</Badge> },
    { label: t("per_vehicle"), align: "end", cell: "gold-text", render: (r) => money(r.per_vehicle) },
    { label: t("reverse"), action: true, render: (r) => (canReverse && <Btn variant="ghost" data-testid={`reverse-${r.id}`} onClick={() => del(r.id)}><Trash2 size={16} className="text-red-400" /></Btn>) },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} rowTestId={(r) => `alloc-row-${r.id}`} empty={t("no_data")} />;
}
