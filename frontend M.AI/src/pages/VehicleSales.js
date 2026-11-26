import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiError, downloadUrl } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Badge, DataTable } from "@/components/kit";
import { toast } from "sonner";
import { Plus, Download, Trash2 } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);

export default function VehicleSales() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const editable = can("finance.edit");
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState(null);
  const [vehicleSearch, setVehicleSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const [ir, cr, vr, sr] = await Promise.all([
        api.get("/invoices"),
        api.get("/customers"),
        api.get("/vehicles?status=in_stock"),
        api.get("/vehicles?status=sold_complete"),
      ]);
      setRows([...((ir.data || []).filter((i) => (i.items || []).some((x) => x.item_type === "vehicle"))), ...(sr.data || []).filter(v=>!v.invoice_id).map(v=>({id:"direct-"+v.id,direct:true,invoice_number:"Direct",sale_date:v.sale_date,customer_name:(cr.data||[]).find(c=>c.id===v.customer_id)?.name,items:[{item_type:"vehicle",description:v.vehicle_name||v.chassis_number}],total:v.sale_price,amount_paid:v.amount_received}))].sort((a,b)=>String(b.sale_date||b.created_at||"").localeCompare(String(a.sale_date||a.created_at||""))));
      setCustomers(cr.data || []);
      setVehicles(vr.data || []);
    } catch (_) {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const vehicleName = useCallback((v) => v?.vehicle_name || `${v?.make || ""} ${v?.model || ""}`.trim() || "Vehicle", []);
  const vehicleLabel = useCallback((v) => {
    if (!v) return "";
    return `${vehicleName(v)} — ${v.chassis_number || "No Chassis"} — ${v.supplier || "No Company"}`;
  }, [vehicleName]);

  const selectedVehicle = useMemo(() => vehicles.find((v) => v.id === form?.vehicle_id), [vehicles, form?.vehicle_id]);
  const filteredVehicles = useMemo(() => {
    const q = vehicleSearch.trim().toLowerCase();
    if (!q) return [];
    return vehicles.filter((v) => {
      const haystack = [
        v.vehicle_name, v.make, v.model, v.chassis_number, v.supplier,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    }).slice(0, 50);
  }, [vehicles, vehicleSearch]);

  const openNew = () => {
    setVehicleSearch("");
    setForm({
      customer_id: "", vehicle_id: "", sale_date: today(), sale_price: "",
      amount_paid: "", payment_method: "bank", notes: "",
    });
  };

  const pickVehicle = (id) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    setVehicleSearch(vehicleLabel(v));
    setForm((f) => ({ ...f, vehicle_id: id, sale_price: v.sale_price || "" }));
  };

  const save = async () => {
    if (!form.customer_id || !form.vehicle_id) { toast.error(t("required_fields")); return; }
    const salePrice = +form.sale_price || 0;
    const paid = +form.amount_paid || 0;
    if (salePrice <= 0) { toast.error(t("sale_price_required")); return; }
    if (paid < 0 || paid > salePrice) { toast.error(t("invalid_payment_amount")); return; }
    try {
      const v = selectedVehicle;
      await api.post("/invoices", {
        customer_id: form.customer_id,
        sale_date: form.sale_date,
        amount_paid: paid,
        payment_method: paid > 0 ? form.payment_method : null,
        notes: form.notes,
        items: [{
          description: v?.vehicle_name || `${v?.make || ""} ${v?.model || ""}`.trim() || v?.chassis_number || "Vehicle",
          quantity: 1,
          unit_price: salePrice,
          item_type: "vehicle",
          ref_id: form.vehicle_id,
        }],
      });
      toast.success(t("save")); setForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const columns = [
    { label: t("invoice_no"), cell: "font-mono text-[var(--gold)]", render: (r) => r.invoice_number },
    { label: t("date"), render: (r) => (r.sale_date || r.created_at || "").slice(0, 10) },
    { label: t("customer"), render: (r) => r.customer_name || "—" },
    { label: t("vehicle_name"), render: (r) => (r.items || []).find((x) => x.item_type === "vehicle")?.description || "—" },
    { label: t("total"), align: "end", render: (r) => money(r.total || 0) },
    { label: t("paid"), align: "end", render: (r) => money(r.amount_paid || 0) },
    { label: t("balance_due"), align: "end", render: (r) => {
      const b = Math.max(0, (r.total || 0) - (r.amount_paid || 0));
      return <Badge tone={b > 0 ? "red" : "green"}>{money(b)}</Badge>;
    }},
    { label: t("action"), action: true, render: (r) => (
      <div className="flex gap-1">
        {!r.direct && <a href={downloadUrl(`/invoices/${r.id}/pdf`)} target="_blank" rel="noreferrer"><Btn variant="ghost"><Download size={16} /></Btn></a>}
        {editable && !r.direct && <Btn variant="ghost" onClick={async () => {
          if (!window.confirm(t("confirm_void"))) return;
          try { await api.delete(`/invoices/${r.id}`); toast.success(t("void")); load(); }
          catch (e) { toast.error(apiError(e)); }
        }}><Trash2 size={16} className="text-red-400" /></Btn>}
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title={t("vehicle_sales")} actions={editable && <Btn onClick={openNew}><Plus size={16} />{t("new_vehicle_sale")}</Btn>} />
      <div className="mb-4 rounded-sm border border-[var(--gold)]/20 bg-[var(--gold)]/5 p-3 text-xs text-muted-foreground">
        {t("vehicle_sales_hint")}
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={t("no_data")} />

      <Modal open={!!form} onClose={() => setForm(null)} title={t("new_vehicle_sale")} testid="vehicle-sale-modal" wide>
        {form && <div>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            <Field label={t("sale_date")}><Input type="date" value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} /></Field>
            <Field label={t("customer")}>
              <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label={`${t("vehicle_name")} / ${t("chassis")} / ${t("company_name")}`}>
              <Input
                data-testid="vehicle-sale-search"
                value={vehicleSearch}
                onChange={(e) => {
                  setVehicleSearch(e.target.value);
                  setForm((f) => ({ ...f, vehicle_id: "", sale_price: "" }));
                }}
                placeholder={`${t("vehicle_name")} / ${t("chassis")} / ${t("company_name")}`}
                autoComplete="off"
              />
              {vehicleSearch.trim() && !form.vehicle_id && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-sm border border-border bg-[var(--surface-2)]">
                  {filteredVehicles.length ? filteredVehicles.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => pickVehicle(v.id)}
                      className="block w-full border-b border-border/60 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-white/5"
                    >
                      <div className="font-semibold text-white">{vehicleName(v)}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono text-[var(--gold)]">{v.chassis_number || "—"}</span>
                        <span className="mx-2">·</span>
                        <span>{v.supplier || "—"}</span>
                      </div>
                    </button>
                  )) : (
                    <div className="px-3 py-3 text-sm text-muted-foreground">{t("no_data")}</div>
                  )}
                </div>
              )}
            </Field>
            <Field label={t("sale_price")}><Input type="number" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} /></Field>
            <Field label={t("amount_received")}><Input type="number" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} /></Field>
            <Field label={t("payment_method")}>
              <Select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} disabled={(+form.amount_paid || 0) <= 0}>
                <option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option>
              </Select>
            </Field>
          </div>
          <Field label={t("notes")}><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          {selectedVehicle && <div className="mb-3 rounded-sm bg-white/5 p-3 text-xs text-muted-foreground">
            <div className="mb-1 font-semibold text-white">{vehicleName(selectedVehicle)}</div>
            {t("purchase_price")}: <span className="text-white">{money(selectedVehicle.purchase_price || 0)}</span>
            <span className="mx-2">·</span>{t("chassis")}: <span className="font-mono text-white">{selectedVehicle.chassis_number || "—"}</span>
            <span className="mx-2">·</span>{t("company_name")}: <span className="text-white">{selectedVehicle.supplier || "—"}</span>
          </div>}
          <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn onClick={save}>{t("save")}</Btn></div>
        </div>}
      </Modal>
    </div>
  );
}
