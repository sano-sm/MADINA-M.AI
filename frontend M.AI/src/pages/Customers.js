import { TaxId, IssuePanel } from "@/components/TradingDocuments";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { api, apiError } from "@/lib/api";
import NameSuggestInput from "@/components/NameSuggestInput";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Empty, Badge, DataTable } from "@/components/kit";
import { toast } from "sonner";
import { Plus, Eye, Pencil, Trash2, ShieldAlert, Search } from "lucide-react";

export default function Customers() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("record");
    if (id) api.get("/customers/" + encodeURIComponent(id)).then(r => setDetail(r.data)).catch(e => toast.error(apiError(e)));
  }, []);
  const [selectedId, setSelectedId] = useState("");
  const [deleteForm, setDeleteForm] = useState(null);
  const pressTimer=useRef(null), pressStart=useRef(null), longPressed=useRef(false);
  const stopPress=()=>clearTimeout(pressTimer.current);
  useEffect(()=>()=>clearTimeout(pressTimer.current),[]);
  const pressProps=(id)=>({onPointerDown:e=>{longPressed.current=false;pressStart.current=[e.clientX,e.clientY];stopPress();if(editable)pressTimer.current=setTimeout(()=>{longPressed.current=true;setSelectedId(id)},550)},onPointerMove:e=>{if(pressStart.current&&Math.hypot(e.clientX-pressStart.current[0],e.clientY-pressStart.current[1])>10)stopPress()},onPointerUp:stopPress,onPointerCancel:stopPress,onPointerLeave:stopPress,onContextMenu:e=>e.preventDefault(),style:{WebkitTouchCallout:"none",userSelect:"none"}});

  const [paymentForm, setPaymentForm] = useState(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const paymentBusyRef = useRef(false);
  const [salesSearch, setSalesSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const editable = can("customers.edit");
  const canReceive = can("finance.edit");

  const deliveryKey = (saleType, saleId) => `${saleType}:${saleId}`;
  const deliveredSet = new Set(
    (detail?.delivery_statuses || []).filter((x) => x.delivered).map((x) => deliveryKey(x.sale_type, x.sale_id))
  );
  const isDelivered = (saleType, saleId) => deliveredSet.has(deliveryKey(saleType, saleId));

  const toggleDelivered = async (saleType, saleId) => {
    if (!detail) return;
    const delivered = !isDelivered(saleType, saleId);
    try {
      await api.put(`/customers/${detail.id}/delivery-status`, { sale_type: saleType, sale_id: saleId, delivered });
      const { data } = await api.get(`/customers/${detail.id}`);
      setDetail(data);
    } catch (e) { toast.error(apiError(e)); }
  };

  // Display-only FIFO allocation of the customer's account-level paid/advance
  // across individual sales. This does not post, move, or duplicate accounting entries.
  const salesForAllocation = detail ? [
    ...(detail.invoices || []).map((x) => ({ key: deliveryKey("invoice", x.id), date: x.sale_date || x.created_at || "", total: +x.total || 0, directPaid: +x.amount_paid || 0 })),
    ...(detail.vehicle_sales || []).map(x=>({key:deliveryKey("vehicle_sale",x.id),date:x.sale_date||"",total:+x.sale_price||0,directPaid:+x.amount_received||0})),
    ...(detail.tracked_sales || []).map((x) => ({ key: deliveryKey("tracked_sale", x.id), date: x.sale_date || "", total: +x.sale_price || 0, directPaid: +x.amount_received || 0 })),
    ...(detail.part_sales || []).map((x) => ({ key: deliveryKey("part_sale", x.id), date: x.date || "", total: +x.sale_price || 0, directPaid: +x.amount_received || 0 })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date))) : [];

  let accountPool = detail ? Math.max(0, (+detail.balance?.paid || 0) + (+detail.balance?.advance || 0) - salesForAllocation.reduce((n, x) => n + x.directPaid, 0)) : 0;
  const allocatedPaid = {};
  for (const x of salesForAllocation) {
    const remaining = Math.max(0, x.total - x.directPaid);
    const extra = Math.min(accountPool, remaining);
    allocatedPaid[x.key] = Math.min(x.total, x.directPaid + extra);
    accountPool -= extra;
  }
  const displayPaid = (saleType, saleId, fallback = 0) => allocatedPaid[deliveryKey(saleType, saleId)] ?? (+fallback || 0);
  const displayBalance = (saleType, saleId, total, fallback = 0) => Math.max(0, (+total || 0) - displayPaid(saleType, saleId, (+total || 0) - (+fallback || 0)));

  // Sales History search is display-only. It does not change accounting or delivery status.
  const salesNeedle = salesSearch.trim().toLowerCase();
  const matchesSalesSearch = (...values) => {
    if (!salesNeedle) return true;
    return values.flat(Infinity).filter((v) => v !== null && v !== undefined)
      .map((v) => String(v).toLowerCase()).join(" ").includes(salesNeedle);
  };
  const invoiceMatches = (i) => matchesSalesSearch(
    i.invoice_number, i.sale_date, i.created_at,
    (i.items || []).map((it) => [
      it.item_name, it.description, it.chassis_number, it.engine_number,
      it.part_name, it.category, it.part_number
    ])
  );
  const trackedMatches = (ts) => matchesSalesSearch(
    ts.name, ts.part_type, ts.engine_code, ts.engine_number,
    ts.chassis_number, ts.invoice_number, ts.sale_date
  );
  const shippingMatches = (sh) => matchesSalesSearch(sh.date, sh.container_number, sh.invoice_number, sh.note);
  const partSaleMatches = (ps) => matchesSalesSearch(
    ps.part_name, ps.category, ps.chassis_number, ps.engine_number,
    ps.part_number, ps.invoice_number, ps.date
  );

  const load = useCallback(() => { api.get("/customers").then((r) => setRows(r.data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (form.id) await api.put(`/customers/${form.id}`, form);
      else await api.post("/customers", form);
      toast.success(t("save")); setForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const saveRef = useRef(null);
  saveRef.current = save;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("voice") === "new" && editable && !form) {
      setForm({ name: "", phone: "", email: "", address: "" });
    }
  }, [editable, form]);
  useEffect(() => {
    const onVoice = (event) => {
      const text = String(event.detail?.command || "");
      if (!form || !/(customer|کسٹمر|گاہک|name|نام|phone|فون|email|ای میل|address|پتہ)/i.test(text)) return;
      const read = (labels) => {
        const match = text.match(new RegExp(`(?:${labels.join("|")})\\s*(?:is|ہے|:)?\\s*([^,;|]+?)(?=\\s+(?:name|نام|phone|فون|email|ای میل|address|پتہ)\\b|[,;|]|$)`, "i"));
        return match ? match[1].trim() : "";
      };
      const updates = {};
      const name = read(["customer name", "name", "کسٹمر کا نام", "نام"]); if (name) updates.name = name;
      const phone = read(["phone", "موبائل", "فون"]); if (phone) updates.phone = phone;
      const email = read(["email", "ای میل"]); if (email) updates.email = email;
      const address = read(["address", "پتہ"]); if (address) updates.address = address;
      if (Object.keys(updates).length) setForm((current) => ({ ...current, ...updates }));
      if (/\b(confirm|save|yes|okay|ok)\b|تصدیق|محفوظ|ہاں|ٹھیک ہے/i.test(text)) window.setTimeout(() => saveRef.current?.(), 0);
    };
    window.addEventListener("mai:voice-command", onVoice);
    return () => window.removeEventListener("mai:voice-command", onVoice);
  }, [form]);

  const selected = rows.find((c) => c.id === selectedId);
  const openDelete = () => {
    if (!selected) return;
    setDeleteForm({ customer: selected, password: "", stage: 1 });
  };
  const confirmDelete = async () => {
    if (!deleteForm?.password) { toast.error(t("password_required")); return; }
    try {
      await api.post(`/customers/${deleteForm.customer.id}/delete-secure`, { pin: deleteForm.password });
      toast.success(t("customer_deleted"));
      setDeleteForm(null); setSelectedId(""); load();
    } catch (e) { toast.error(apiError(e)); }
  };


  const openPayment = (invoice = null) => {
    if (!detail) return;
    setPaymentForm({
      customer_id: detail.id, customer_name: detail.name, invoice_id: invoice?.id || "",
      invoice_number: invoice?.invoice_number || "", date: new Date().toISOString().slice(0, 10),
      amount: invoice ? Math.max(0, +invoice.balance || 0) : Math.max(0, +detail.balance?.outstanding || 0),
      method: "bank", note: "", is_advance: false,
    });
  };
  const refreshCustomerPayment = async () => {
    const { data } = await api.get(`/customers/${detail.id}`); setDetail(data); load();
  };
  const savePayment = async () => {
    if (paymentBusyRef.current) return;
    if (!paymentForm || (+paymentForm.amount || 0) <= 0) { toast.error(t("required_fields")); return; }
    paymentBusyRef.current = true; setSavingPayment(true);
    try {
      if (paymentForm.id) {
        await api.put(`/payments/${paymentForm.id}`, {
          date: paymentForm.date, amount: +paymentForm.amount,
          method: paymentForm.method, note: paymentForm.note || "",
        });
      } else {
        await api.post("/payments", {
          customer_id: paymentForm.customer_id, invoice_id: paymentForm.invoice_id || null,
          date: paymentForm.date, amount: +paymentForm.amount, method: paymentForm.method,
          note: paymentForm.note, is_advance: !!paymentForm.is_advance,
        });
      }
      toast.success(t("save")); setPaymentForm(null);
      await refreshCustomerPayment();
    } catch (e) { toast.error(apiError(e)); }
    finally { paymentBusyRef.current = false; setSavingPayment(false); }
  };
  const deletePayment = async (p) => {
    if (!window.confirm(`Delete this customer payment (${money(p.amount)})? This changes the balance.`)) return;
    try { await api.delete(`/payments/${p.id}`); await refreshCustomerPayment(); toast.success(t("delete")); }
    catch (e) { toast.error(apiError(e)); }
  };

  const columns = [
    { label: t("name"), cell: "font-medium", render: (c) => c.name },
    { label: t("phone"), render: (c) => c.phone || "—" },
    { label: t("billed"), align: "end", render: (c) => money(c.balance.billed) },
    { label: t("paid"), align: "end", render: (c) => money(c.balance.paid) },
    { label: t("advance"), align: "end", render: (c) => money(c.balance.advance) },
    { label: t("outstanding"), align: "end", render: (c) => <Badge tone={c.balance.outstanding > 0 ? "red" : "green"}>{money(c.balance.outstanding)}</Badge> },
    { label: t("action"), action: true, render: (c) => (
      <Btn variant="ghost" data-testid={`view-customer-${c.id}`} onClick={async () => { const { data } = await api.get(`/customers/${c.id}`); setSalesSearch(""); setDetail(data); }}><Eye size={16} /></Btn>) },
  ];

  return (
    <div>
      <PageHeader title={t("customers")} actions={editable &&
        <Btn data-testid="add-customer-btn" onClick={() => setForm({ name: "", phone: "", email: "", address: "" })}><Plus size={16} />{t("add_customer")}</Btn>} />
      {editable && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-sm border border-border bg-[var(--surface-2)] p-3">
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t("select_customer_manage")}</div>
            <Select data-testid="customer-manage-select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">—</option>
              {rows.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}{c.created_at ? ` · ${c.created_at.slice(0, 16).replace("T", " ")}` : ""}</option>)}
            </Select>
          </div>
          <Btn variant="dark" disabled={!selected} onClick={() => selected && setForm({ name: "", phone: "", email: "", address: "", ...selected })}>
            <Pencil size={15} />{t("edit")}
          </Btn>
          <Btn variant="danger" disabled={!selected} data-testid="delete-customer-btn" onClick={openDelete}>
            <Trash2 size={15} />{t("delete_customer")}
          </Btn>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((c) => <button key={c.id} data-testid={`customer-card-${c.id}`} {...pressProps(c.id)} onClick={async () => { if(longPressed.current){longPressed.current=false;return;} const {data}=await api.get(`/customers/${c.id}`); setSalesSearch(""); setDetail(data); }} className="card-surface min-h-[70px] rounded-sm p-3 text-start hover:border-[var(--gold)]/50"><div className="font-semibold text-white">{c.name}{selectedId===c.id&&<span className="ml-2 text-green-400">✓</span>}</div></button>)}
        {!rows.length && <div className="text-sm text-muted-foreground">{t("no_data")}</div>}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t("edit") : t("add_customer")} testid="customer-modal">
        {form && (
          <div>
            <Field label={t("name")}><NameSuggestInput kind="customer" data-testid="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t("phone")}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={t("email")}><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <TaxId value={form} onChange={setForm} /><Field label={t("address")}><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <div className="mt-2 flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn disabled={saving} data-testid="save-customer" onClick={save}>{saving ? t("saving") : t("save")}</Btn></div>
          </div>
        )}
      </Modal>

      <Modal open={!!deleteForm} onClose={() => setDeleteForm(null)} title={t("delete_customer")} testid="delete-customer-modal">
        {deleteForm && deleteForm.stage === 1 && (
          <div>
            <div className="mb-4 flex gap-3 rounded-sm border border-red-500/30 bg-red-500/10 p-3 text-sm">
              <ShieldAlert className="mt-0.5 shrink-0 text-red-400" size={20} />
              <div>
                <div className="font-semibold text-white">{deleteForm.customer.name}</div>
                <div className="mt-1 text-red-200">{t("delete_customer_warning")}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t("delete_customer_history_block")}</div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Btn variant="dark" onClick={() => setDeleteForm(null)}>{t("cancel")}</Btn>
              <Btn variant="danger" onClick={() => setDeleteForm({ ...deleteForm, stage: 2 })}>{t("continue")}</Btn>
            </div>
          </div>
        )}
        {deleteForm && deleteForm.stage === 2 && (
          <div>
            <p className="mb-3 text-sm text-muted-foreground">Enter your Screen PIN to confirm.</p>
            <Field label="Screen PIN"><Input autoFocus inputMode="numeric" maxLength={8} type="password" data-testid="delete-customer-password" value={deleteForm.password}
              onChange={(e) => setDeleteForm({ ...deleteForm, password: e.target.value })} /></Field>
            <div className="flex justify-end gap-2">
              <Btn variant="dark" onClick={() => setDeleteForm({ ...deleteForm, stage: 1, password: "" })}>{t("back")}</Btn>
              <Btn variant="danger" data-testid="confirm-delete-customer" disabled={!deleteForm.password} onClick={confirmDelete}><Trash2 size={15} />{t("delete_customer")}</Btn>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name} testid="customer-detail" wide>
        {detail && (
          <div>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[["billed", detail.balance.billed], ["paid", detail.balance.paid], ["advance", detail.balance.advance], ["outstanding", detail.balance.outstanding]].map(([k, v]) => (
                <div key={k} className="card-surface rounded-sm p-3"><div className="text-xs text-muted-foreground">{t(k)}</div><div className="gold-text font-bold">{money(v)}</div></div>
              ))}
            </div>
            <div className="mb-3 grid gap-2" style={{gridTemplateColumns:canReceive?"repeat(2,minmax(0,1fr))":"minmax(0,1fr)"}}>
              <div className="customer-top-action"><IssuePanel kind="customer" party={detail} /></div>
              {canReceive && <div className="customer-top-action"><Btn variant="dark" data-testid="customer-receive-payment" onClick={() => openPayment()}>REC. Payment</Btn></div>}
            </div>
            <style>{".customer-top-action{min-width:0}.customer-top-action > button{width:100%;min-width:0;height:48px;box-sizing:border-box;padding:6px 4px;justify-content:center;text-align:center;white-space:normal;font-size:clamp(11px,3.5vw,14px);line-height:1.2}"}</style>
            <div className="mb-2 flex min-w-0 flex-col gap-1.5">
              <h4 className="font-head font-bold gold-text">{t("sales_history")}</h4>
              <div className="flex w-full min-w-0 items-center gap-2 rounded-sm border border-border bg-[var(--surface-2)] px-3 py-2">
                <Search size={14} className="shrink-0 text-muted-foreground" />
                <input
                  data-testid="customer-sales-search"
                  value={salesSearch}
                  onChange={(e) => setSalesSearch(e.target.value)}
                  placeholder="Engine No. / Chassis / Vehicle / Invoice"
                  className="w-full min-w-0 bg-transparent text-xs text-white outline-none placeholder:text-muted-foreground"
                />
                {salesSearch && <button type="button" onClick={() => setSalesSearch("")} className="text-xs text-muted-foreground hover:text-white">×</button>}
              </div>
            </div>
            {(detail.invoices.length || detail.vehicle_sales?.length || detail.tracked_sales?.length || detail.part_sales?.length || detail.shipping_costs?.length) ? (
              <div className="space-y-2">
                {detail.invoices.filter(invoiceMatches).map((i) => (
                  <div key={i.id} data-testid={`cust-invoice-${i.id}`} className="rounded-sm border border-border p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="whitespace-nowrap text-xs text-muted-foreground">{i.sale_date || i.created_at?.slice(0, 10)}</span>
                        <span className="truncate font-mono text-[var(--gold)]">{i.invoice_number}</span>
                      </div>
                      <div className="flex items-center gap-2 whitespace-nowrap sm:gap-3">
                        <span className="font-semibold">{money(i.total)}</span>
                        <span className="hidden text-xs text-emerald-400 sm:inline">{t("paid")}: {money(displayPaid("invoice", i.id, i.amount_paid))}</span>
                        <Badge tone={displayBalance("invoice", i.id, i.total, i.balance) > 0 ? "red" : "green"}>{money(displayBalance("invoice", i.id, i.total, i.balance))}</Badge>
                        {editable && <button type="button" title={isDelivered("invoice", i.id) ? "Delivered" : "Mark delivered"} onClick={() => toggleDelivered("invoice", i.id)} className={`flex h-6 w-6 items-center justify-center rounded border text-sm font-bold ${isDelivered("invoice", i.id) ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-border text-muted-foreground"}`}>{isDelivered("invoice", i.id) ? "✓" : ""}</button>}
                      </div>
                    </div>
                    <div className="mt-1 space-y-0.5 ps-1">
                      {(i.items || []).map((it, ix) => (
                        <div key={ix} className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span className="font-medium text-white">{it.item_name || it.description || "—"}</span>
                          {it.quantity > 1 && <span>×{it.quantity}</span>}
                          {it.chassis_number && <span>· {t("chassis_no")}: <span className="text-white/80">{it.chassis_number}</span></span>}
                          {it.engine_number && <span>· {t("engine_no")}: <span className="text-white/80">{it.engine_number}</span></span>}
                        </div>
                      ))}
                      <div className="text-[11px] text-emerald-400 sm:hidden">{t("paid")}: {money(displayPaid("invoice", i.id, i.amount_paid))}</div>
                    </div>
                    {canReceive && i.balance > 0 && <div className="mt-2 flex justify-end"><Btn variant="dark" data-testid={`receive-invoice-${i.id}`} onClick={() => openPayment(i)}>{t("receive_payment")}</Btn></div>}
                  </div>
                ))}
                {(detail.vehicle_sales || []).filter(v=>matchesSalesSearch(v.vehicle_name,v.chassis_number,v.engine_number,v.sale_date)).map(v=><div key={v.id} className="rounded-sm border border-border p-2 text-sm"><div className="flex justify-between gap-2"><b>{v.vehicle_name || v.chassis_number}</b><span>{money(v.sale_price)}</span></div><div className="text-xs text-muted-foreground">{v.sale_date} · {v.chassis_number}</div><div className="flex justify-between"><span>{t("paid")}: {money(displayPaid("vehicle_sale",v.id,v.amount_received||0))}</span><Badge tone={displayBalance("vehicle_sale",v.id,v.sale_price,v.balance_due||0)>0?"red":"green"}>{money(displayBalance("vehicle_sale",v.id,v.sale_price,v.balance_due||0))}</Badge></div></div>)}
                {(detail.tracked_sales || []).filter(trackedMatches).map((ts) => (
                  <div key={ts.id} data-testid={`cust-tracked-${ts.id}`} className="rounded-sm border border-border p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="whitespace-nowrap text-xs text-muted-foreground">{ts.sale_date || "—"}</span>
                        <span className="truncate font-medium text-white">{ts.name || (ts.part_type === "half_cut" ? "Half-cut" : "Engine")}</span>
                      </div>
                      <div className="flex items-center gap-2 whitespace-nowrap sm:gap-3">
                        <span className="font-semibold">{money(ts.sale_price)}</span>
                        <span className="hidden text-xs text-emerald-400 sm:inline">{t("paid")}: {money(displayPaid("tracked_sale", ts.id, ts.amount_received || 0))}</span>
                        <Badge tone={displayBalance("tracked_sale", ts.id, ts.sale_price, ts.balance_due || 0) > 0 ? "red" : "green"}>{money(displayBalance("tracked_sale", ts.id, ts.sale_price, ts.balance_due || 0))}</Badge>
                        {editable && <button type="button" title={isDelivered("tracked_sale", ts.id) ? "Delivered" : "Mark delivered"} onClick={() => toggleDelivered("tracked_sale", ts.id)} className={`flex h-6 w-6 items-center justify-center rounded border text-sm font-bold ${isDelivered("tracked_sale", ts.id) ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-border text-muted-foreground"}`}>{isDelivered("tracked_sale", ts.id) ? "✓" : ""}</button>}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 ps-1 text-xs text-muted-foreground">
                      <span>{ts.part_type === "half_cut" ? "Half-cut" : "Engine"}</span>
                      {ts.engine_number && <span>· {t("engine_no")}: <span className="text-white/80">{ts.engine_number}</span></span>}
                      {ts.chassis_number && <span>· {t("chassis_no")}: <span className="text-white/80">{ts.chassis_number}</span></span>}
                    </div>
                  </div>
                ))}
                {(detail.part_sales || []).filter(partSaleMatches).map((ps) => (
                  <div key={ps.id} className="rounded-sm border border-border p-2 text-sm">
                    <div className="flex items-center justify-between gap-2"><div className="min-w-0"><span className="text-xs text-muted-foreground">{ps.date || "—"}</span> · <span className="font-medium text-white">{ps.category === "half_cut" ? "Half Cut" : ps.category === "engine" ? "Engine" : "Parts"}: {ps.part_name || "—"}</span></div><div className="flex items-center gap-2"><span className="font-semibold">{money(ps.sale_price)}</span><Badge tone={displayBalance("part_sale", ps.id, ps.sale_price, ps.balance_due||0)>0?"red":"green"}>{money(displayBalance("part_sale", ps.id, ps.sale_price, ps.balance_due||0))}</Badge>{editable && <button type="button" title={isDelivered("part_sale", ps.id) ? "Delivered" : "Mark delivered"} onClick={() => toggleDelivered("part_sale", ps.id)} className={`flex h-6 w-6 items-center justify-center rounded border text-sm font-bold ${isDelivered("part_sale", ps.id) ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-border text-muted-foreground"}`}>{isDelivered("part_sale", ps.id) ? "✓" : ""}</button>}</div></div>
                    <div className="mt-1 text-xs text-muted-foreground">{ps.chassis_number && <>Chassis: <span className="text-white/80">{ps.chassis_number}</span> · </>}<span className="text-emerald-400">{t("paid")}: {money(displayPaid("part_sale", ps.id, ps.amount_received||0))}</span></div>
                  </div>
                ))}
                {(detail.shipping_costs || []).filter(shippingMatches).map((sh) => (
                  <div key={sh.id} className="rounded-sm border border-border p-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-white">Shipping Cost · {sh.date}</span><span className="font-semibold">{money(sh.amount)}</span></div>
                    <div className="mt-1 text-xs text-muted-foreground">Container: {sh.container_number} · Invoice/BL: {sh.invoice_number || "—"}</div>
                    {sh.note && <div className="text-xs text-muted-foreground">{sh.note}</div>}
                  </div>
                ))}
                {salesNeedle &&
                  !detail.invoices.some(invoiceMatches) &&
                  !(detail.vehicle_sales || []).some(v=>matchesSalesSearch(v.vehicle_name,v.chassis_number,v.engine_number,v.sale_date)) &&
                  !(detail.tracked_sales || []).some(trackedMatches) &&
                  !(detail.part_sales || []).some(partSaleMatches) &&
                  !(detail.shipping_costs || []).some(shippingMatches) && (
                    <div className="rounded-sm border border-border p-3 text-center text-sm text-muted-foreground">
                      No matching sale found
                    </div>
                  )}
              </div>
            ) : <div className="text-sm text-muted-foreground">{t("no_data")}</div>}
            <h4 className="mb-2 mt-4 font-head font-bold gold-text">{t("payments")}</h4>
            {detail.payments.length ? detail.payments.map((p) => {
              const inv = (detail.invoices || []).find((i) => i.id === p.invoice_id);
              return <div key={p.id} className="flex justify-between gap-3 border-b border-border py-1.5 text-sm">
                <span>{(p.date || p.created_at || "").slice(0, 10)} · {t(p.method || "cash")}{inv ? ` · ${inv.invoice_number}` : ""} {p.is_advance ? `(${t("advance")})` : ""}</span>
                <div className="flex flex-wrap items-center justify-end gap-2"><span>{money(p.amount)}</span>{canReceive && <>
                  <Btn variant="ghost" data-testid={`customer-edit-payment-${p.id}`} onClick={() => setPaymentForm({ ...p, customer_name: detail.name, invoice_number: inv?.invoice_number || "", amount: String(p.amount), date: (p.date || "").slice(0, 10) })}><Pencil size={14}/>{t("edit")}</Btn>
                  <Btn variant="ghost" data-testid={`customer-delete-payment-${p.id}`} onClick={() => deletePayment(p)}><Trash2 size={14} className="text-red-400"/>{t("delete")}</Btn>
                </>}</div>
              </div>;
            }) : <div className="text-sm text-muted-foreground">{t("no_data")}</div>}
          </div>
        )}
      </Modal>

      <Modal open={!!paymentForm} onClose={() => !savingPayment && setPaymentForm(null)} title={paymentForm?.id ? t("edit") : t("receive_payment")} testid="receive-payment-modal">
        {paymentForm && <div>
          <div className="mb-3 rounded-sm bg-white/5 p-3 text-sm"><span className="gold-text">{paymentForm.customer_name}</span>{paymentForm.invoice_number ? <span className="ms-2 font-mono text-muted-foreground">{paymentForm.invoice_number}</span> : null}</div>
          <Field label={t("payment_date")}><Input type="date" value={paymentForm.date} onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })} /></Field>
          <Field label={t("invoice_no")}><Select disabled={!!paymentForm.id} value={paymentForm.invoice_id || ""} onChange={(e) => {
            const inv = (detail?.invoices || []).find((i) => i.id === e.target.value);
            setPaymentForm({ ...paymentForm, invoice_id: e.target.value, invoice_number: inv?.invoice_number || "", amount: inv ? Math.max(0, +inv.balance || 0) : paymentForm.amount });
          }}><option value="">{t("customer_account_general")}</option>{(detail?.invoices || []).filter((i) => i.balance > 0).map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {money(i.balance)}</option>)}</Select></Field>
          <Field label={t("amount")}><Input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></Field>
          <Field label={t("payment_method")}><Select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>
          <Field label={t("notes")}><Input value={paymentForm.note} onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Btn variant="dark" disabled={savingPayment} onClick={() => setPaymentForm(null)}>{t("cancel")}</Btn><Btn disabled={savingPayment} onClick={savePayment}>{savingPayment ? "Saving..." : t("save")}</Btn></div>
        </div>}
      </Modal>
    </div>
  );
}
