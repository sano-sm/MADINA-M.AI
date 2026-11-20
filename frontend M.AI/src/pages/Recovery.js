import React, { useCallback, useEffect, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Badge, DataTable } from "@/components/kit";
import { toast } from "sonner";
import { Search } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);

export default function Recovery() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const canSell = can("vehicles.edit") || can("finance.edit") || can("parts.edit");
  const [source, setSource] = useState("vehicle"); // vehicle | purchased
  const [type, setType] = useState("engine");      // engine | half_cut | parts
  const [q, setQ] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [stock, setStock] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sale, setSale] = useState(null);
  const [saleHistory, setSaleHistory] = useState([]);
  const [editSale, setEditSale] = useState(null);

  const load = useCallback(async () => {
    try {
      if (source === "vehicle") {
        const { data } = await api.get(`/recovery/vehicles?type=${encodeURIComponent(type)}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
        const rows = data || [];
        const activeRows = rows.filter((v) => {
          if ((type === "engine" || type === "half_cut") && v.engine_halfcut_sold) return false;
          if (type === "parts" && (v.recovery_status === "completed" || v.recovery_status === "complete" || v.recovery_status === "recovered")) return false;
          return true;
        });
        setVehicles(activeRows); setStock([]);
        if (type === "engine" || type === "half_cut") { const h=await api.get("/part-sales"); setSaleHistory((h.data||[]).filter(x=>x.category===type)); } else setSaleHistory([]);
      } else if (type === "parts") {
        const { data } = await api.get(`/parts${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        setStock((data || []).filter((x) => !x.source_vehicle_id && (+x.quantity || 0) > 0)); setVehicles([]);
      } else {
        const { data } = await api.get(`/tracked-parts?type=${type}`);
        const s = q.trim().toLowerCase();
        setStock((data || []).filter((x) => x.source === "direct" && x.status === "available" && (!s || `${x.name || ""} ${x.supplier || ""} ${x.engine_code || ""} ${x.engine_number || ""}`.toLowerCase().includes(s)))); setVehicles([]);
      }
    } catch (_) { setVehicles([]); setStock([]); }
  }, [source, type, q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data || [])).catch(() => {}); }, []);

  const openVehicleSale = (v) => setSale({ mode: "vehicle", source_vehicle_id: v.id, vehicle_name: v.vehicle_name, chassis_number: v.chassis_number,
    date: today(), part_name: "", customer_id: "", sale_price: "", amount_received: "", method: "bank" });
  const openPurchasedSale = (r) => setSale({ mode: "purchased", item: r, date: today(), customer_id: "", sale_price: r.sale_price || "", quantity: 1, amount_received: "", method: "bank" });

  const doSale = async () => {
    const price = +sale.sale_price || 0;
    const received = +sale.amount_received || 0;
    if (!sale.customer_id || price <= 0) { toast.error(t("required_fields")); return; }
    if (received < 0 || received > price * (+sale.quantity || 1)) { toast.error(t("invalid_payment_amount")); return; }
    try {
      if (sale.mode === "vehicle") {
        await api.post("/part-sales", {
          source_vehicle_id: sale.source_vehicle_id, category: type, date: sale.date,
          part_name: sale.part_name || t(type), customer_id: sale.customer_id,
          sale_price: price, amount_received: received,
          method: received > 0 ? sale.method : null,
        });
      } else if (type === "engine" || type === "half_cut") {
        await api.post(`/tracked-parts/${sale.item.id}/sell`, {
          sale_date: sale.date, customer_id: sale.customer_id, sale_price: price,
          amount_received: received, method: received > 0 ? sale.method : null,
        });
      } else {
        const qty = Math.max(1, Math.min(+sale.quantity || 1, +sale.item.quantity || 1));
        const total = price * qty;
        if (received > total) { toast.error(t("invalid_payment_amount")); return; }
        await api.post("/invoices", {
          customer_id: sale.customer_id, sale_date: sale.date, amount_paid: received,
          payment_method: received > 0 ? sale.method : null,
          notes: t("purchased_parts_sales"),
          items: [{ description: sale.item.name, quantity: qty, unit_price: price, item_type: "part", ref_id: sale.item.id }],
        });
      }
      toast.success(t("sold")); setSale(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const vcolumns = [
    { label: t("vehicle_name"), render: (v) => v.vehicle_name || "—" },
    { label: t("chassis"), cell: "font-mono text-[var(--gold)]", render: (v) => v.chassis_number },
    { label: t("dismantle_date"), render: (v) => (v.dismantle_date || "").slice(0, 10) },
    { label: t("purchase_price"), align: "end", render: (v) => money(v.purchase_price) },
    { label: t("recovered"), align: "end", cell: "text-emerald-400", render: (v) => money(v.total_recovered) },
    { label: t("remaining_cost"), align: "end", cell: "text-red-400", render: (v) => money(v.remaining_to_recover) },
    { label: t("action"), action: true, render: (v) => canSell && <Btn onClick={() => openVehicleSale(v)}>{t("sell")} {t(type)}</Btn> },
  ];
  const scols = [
    { label: t("name"), render: (r) => r.name || r.engine_code || "—" },
    ...(type === "parts" ? [{ label: t("quantity"), render: (r) => <Badge tone="green">{r.quantity}</Badge> }] : []),
    { label: t("from_label"), render: (r) => r.supplier || "—" },
    { label: t("purchase_price"), align: "end", render: (r) => money(type === "parts" ? (r.unit_cost || 0) : (r.purchase_price || 0)) },
    { label: t("action"), action: true, render: (r) => canSell && <Btn onClick={() => openPurchasedSale(r)}>{t("sell")}</Btn> },
  ];

  const title = t("parts_sales");
  const sourceTitle = source === "vehicle" ? t("vehicle_parts_sales") : t("purchased_parts_sales");
  return <div>
    <PageHeader title={title} />
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      {[["vehicle", t("vehicle_parts_sales")], ["purchased", t("purchased_parts_sales")]].map(([k, label]) =>
        <button key={k} onClick={() => { setSource(k); setQ(""); setSale(null); }} className={`min-h-[72px] rounded-sm border p-3 text-start text-sm font-bold ${source === k ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]" : "border-border card-surface text-white"}`}>{label}</button>)}
    </div>
    <div className="mb-4 flex flex-wrap gap-2">
      {[["engine", t("engine")], ["half_cut", t("half_cut")], ["parts", t("parts_short")]].map(([k, label]) =>
        <button key={k} onClick={() => { setType(k); setQ(""); setSale(null); }} className={`rounded-sm border px-5 py-2 text-sm font-medium ${type === k ? "gold-gradient border-transparent text-black" : "border-border text-gray-300 hover:text-white"}`}>{label}</button>)}
    </div>
    <div className="mb-2 text-xs text-muted-foreground">{sourceTitle}</div>
    <div className="mb-4 flex max-w-md items-center gap-2 card-surface rounded-sm px-3 py-2">
      <Search size={16} className="text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={source === "vehicle" ? t("search_vehicle") : t("search")} className="w-full bg-transparent text-sm text-white outline-none" />
    </div>
    <DataTable columns={source === "vehicle" ? vcolumns : scols} rows={source === "vehicle" ? vehicles : stock} rowKey={(r) => r.id} empty={t("no_data")} />
    {source === "vehicle" && (type === "engine" || type === "half_cut") && saleHistory.length > 0 && <div className="mt-5"><div className="mb-2 text-sm font-bold gold-text">Sale History</div>{saleHistory.map(h=><div key={h.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm"><span>{h.date} · {h.vehicle_name} · {h.chassis_number} · {money(h.sale_price)}</span>{can("records.reverse") && <div className="flex gap-1"><Btn variant="ghost" onClick={()=>setEditSale({...h,sale_price:String(h.sale_price||""),amount_received:String(h.amount_received||"")})}>Edit</Btn><Btn variant="ghost" onClick={async()=>{if(!window.confirm("Reset this sale?"))return;await api.delete(`/part-sales/${h.id}`);load();}}>Reset</Btn></div>}</div>)}</div>}

    <Modal open={!!editSale} onClose={()=>setEditSale(null)} title="Edit Sale">{editSale && <div><Field label={t("sale_price")}><Input type="number" value={editSale.sale_price} onChange={e=>setEditSale({...editSale,sale_price:e.target.value})}/></Field><Field label={t("amount_received")}><Input type="number" value={editSale.amount_received} onChange={e=>setEditSale({...editSale,amount_received:e.target.value})}/></Field><div className="flex justify-end gap-2"><Btn variant="dark" onClick={()=>setEditSale(null)}>{t("cancel")}</Btn><Btn onClick={async()=>{await api.put(`/part-sales/${editSale.id}`,{source_vehicle_id:editSale.source_vehicle_id,category:editSale.category,date:editSale.date,part_name:editSale.part_name,customer_id:editSale.customer_id,sale_price:+editSale.sale_price||0,amount_received:+editSale.amount_received||0});setEditSale(null);load();}}>{t("save")}</Btn></div></div>}</Modal>

    <Modal open={!!sale} onClose={() => setSale(null)} title={`${t("sell")} · ${sourceTitle}`} wide>
      {sale && <div>
        <div className="mb-3 rounded-sm bg-white/5 p-3 text-sm">
          <div className="font-semibold gold-text">{sale.mode === "vehicle" ? (sale.vehicle_name || sale.chassis_number) : (sale.item.name || sale.item.engine_code || t(type))}</div>
          {sale.mode === "vehicle" && <div className="font-mono text-xs text-muted-foreground">{sale.chassis_number}</div>}
        </div>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <Field label={t("date")}><Input type="date" value={sale.date} onChange={(e) => setSale({ ...sale, date: e.target.value })} /></Field>
          <Field label={t("customer")}><Select value={sale.customer_id} onChange={(e) => setSale({ ...sale, customer_id: e.target.value })}><option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          {sale.mode === "vehicle" && <Field label={type === "engine" ? t("engine_name_code") : type === "half_cut" ? t("hcut_desc") : t("part_desc")}><Input value={sale.part_name} onChange={(e) => setSale({ ...sale, part_name: e.target.value })} /></Field>}
          {sale.mode === "purchased" && type === "parts" && <Field label={t("quantity")}><Input type="number" min="1" max={sale.item.quantity} value={sale.quantity} onChange={(e) => setSale({ ...sale, quantity: e.target.value })} /></Field>}
          <Field label={t("sale_price")}><Input type="number" value={sale.sale_price} onChange={(e) => setSale({ ...sale, sale_price: e.target.value })} /></Field>
          <Field label={t("amount_received")}><Input type="number" value={sale.amount_received} onChange={(e) => setSale({ ...sale, amount_received: e.target.value })} /></Field>
          <Field label={t("payment_method")}><Select disabled={(+sale.amount_received || 0) <= 0} value={sale.method} onChange={(e) => setSale({ ...sale, method: e.target.value })}><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>
        </div>
        <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setSale(null)}>{t("cancel")}</Btn><Btn onClick={doSale}>{t("save")}</Btn></div>
      </div>}
    </Modal>
  </div>;
}
