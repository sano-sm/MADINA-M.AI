import { printWindow } from "@/lib/documentPreview";
import { PartyFields, IssuePanel } from "@/components/TradingDocuments";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { api, apiError } from "@/lib/api";
import NameSuggestInput from "@/components/NameSuggestInput";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Modal, Field, Input, Badge } from "@/components/kit";
import { toast } from "sonner";
import { Plus, Trash2, ChevronRight, Pencil } from "lucide-react";

export default function Brokers() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const editable = can("finance.edit");
  const [rows, setRows] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [fields, setFields] = useState({});
  const [phone, setPhone] = useState("");
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("record");
    if (id) api.get("/brokers/" + encodeURIComponent(id)).then(r => setDetail(r.data)).catch(e => toast.error(apiError(e)));
  }, []);

  const load = useCallback(() => {
    api.get("/brokers").then((r) => setRows(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (id) => {
    try { const { data } = await api.get(`/brokers/${id}`); setDetail(data); }
    catch (e) { toast.error(apiError(e)); }
  };

  const createBroker = async () => {
    try { await api.post("/brokers", { name, phone, ...fields }); setFields({}); setAddOpen(false); setName(""); setPhone(""); load(); toast.success(t("save")); }
    catch (e) { toast.error(apiError(e)); }
  };
  const createBrokerRef = useRef(null);
  createBrokerRef.current = createBroker;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("voice") === "new" && editable && !addOpen) setAddOpen(true);
  }, [editable, addOpen]);
  useEffect(() => {
    const onVoice = (event) => {
      const text = String(event.detail?.command || "");
      if (!addOpen || !/(broker|بروکر|name|نام|phone|فون|موبائل)/i.test(text)) return;
      const read = (labels) => {
        const match = text.match(new RegExp(`(?:${labels.join("|")})\\s*(?:is|ہے|:)?\\s*([^,;|]+?)(?=\\s+(?:name|نام|phone|فون|موبائل)\\b|[,;|]|$)`, "i"));
        return match ? match[1].trim() : "";
      };
      const nextName = read(["broker name", "name", "بروکر کا نام", "نام"]);
      const nextPhone = read(["phone", "موبائل", "فون"]);
      if (nextName) setName(nextName);
      if (nextPhone) setPhone(nextPhone);
      if (/\b(confirm|save|yes|okay|ok)\b|تصدیق|محفوظ|ہاں|ٹھیک ہے/i.test(text)) window.setTimeout(() => createBrokerRef.current?.(), 0);
    };
    window.addEventListener("mai:voice-command", onVoice);
    return () => window.removeEventListener("mai:voice-command", onVoice);
  }, [addOpen]);

  return (
    <div>
      <PageHeader title={t("brokers")} actions={editable &&
        <Btn data-testid="add-broker-btn" onClick={() => setAddOpen(true)}><Plus size={16} />{t("add_broker")}</Btn>} />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {rows.map((b) => (
          <button key={b.id} data-testid={`broker-card-${b.id}`} onClick={() => openDetail(b.id)}
            className="card-surface flex min-w-0 items-center justify-between gap-1 rounded-sm p-3 text-start hover:border-[var(--gold)]/50">
            <div className="min-w-0 flex-1">
              <div className="break-words font-semibold text-white" style={{overflowWrap:"anywhere"}}>{b.name}</div>
              <div className="mt-1 flex flex-wrap gap-1 text-xs">
                {b.account.payment_due > 0 && <Badge tone="red">{t("payment_due")}: {money(b.account.payment_due)}</Badge>}
                {b.account.advance > 0 && <Badge tone="green">{t("advance")}: {money(b.account.advance)}</Badge>}
                {b.account.pending_count > 0 && <Badge tone="gold">{b.account.pending_count} {t("pending")}</Badge>}
              </div>
            </div>
            <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
          </button>
        ))}
        {!rows.length && <div className="text-sm text-muted-foreground">{t("no_data")}</div>}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t("add_broker")} testid="broker-add-modal">
        <Field label={t("broker_name")}><NameSuggestInput kind="broker" data-testid="broker-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("phone")}><Input data-testid="broker-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <PartyFields value={fields} onChange={setFields} broker />
        <div className="mt-3 flex justify-end gap-2">
          <Btn variant="dark" onClick={() => setAddOpen(false)}>{t("cancel")}</Btn>
          <Btn data-testid="save-broker" onClick={createBroker}>{t("save")}</Btn>
        </div>
      </Modal>

      <BrokerDetail detail={detail} setDetail={setDetail} reload={() => { openDetailReload(detail, setDetail); load(); }} editable={editable} />
    </div>
  );
}

function openDetailReload(detail, setDetail) {
  if (detail) api.get(`/brokers/${detail.id}`).then((r) => setDetail(r.data)).catch(() => {});
}

function BrokerDetail({ detail, setDetail, reload, editable }) {
  const { t } = useI18n();
  const { money } = useSettings();
  const [veh, setVeh] = useState(null);
  const [pay, setPay] = useState(null);
  const [savingPay, setSavingPay] = useState(false);
  const [brokerEdit, setBrokerEdit] = useState(null);
  const [brokers, setBrokers] = useState([]);
  useEffect(() => { if (detail) api.get("/brokers").then(r=>setBrokers(r.data||[])).catch(()=>{}); }, [detail?.id]);

  if (!detail) return null;
  const a = detail.account;

  // Display only: keep direct vehicle payments, then apply broker-level payments oldest first.
  const vehiclesForAllocation = [...(detail.vehicles || [])].sort((x,y) =>
    String(x.purchase_date || "").localeCompare(String(y.purchase_date || "")) ||
    String(x.id || "").localeCompare(String(y.id || ""))
  );
  const directPaidTotal = vehiclesForAllocation.reduce((n,v) =>
    n + Math.min(+v.purchase_price || 0, Math.max(0, +v.paid_amount || 0)), 0);
  let brokerPaymentPool = Math.max(0, (+a.total_paid || 0) - directPaidTotal);
  const allocatedVehiclePaid = {};
  for (const v of vehiclesForAllocation) {
    const price = Math.max(0, +v.purchase_price || 0);
    const direct = Math.min(price, Math.max(0, +v.paid_amount || 0));
    const extra = Math.min(brokerPaymentPool, Math.max(0, price - direct));
    allocatedVehiclePaid[v.id] = direct + extra;
    brokerPaymentPool -= extra;
  }
  const vehicleDisplayPaid = (v) => allocatedVehiclePaid[v.id] ?? Math.min(+v.purchase_price || 0, +v.paid_amount || 0);
  const vehicleDisplayBalance = (v) => Math.max(0, (+v.purchase_price || 0) - vehicleDisplayPaid(v));

  const addVehicle = async () => {
    try { const payload={ ...veh, purchase_price: +veh.purchase_price || 0, paid_amount: +veh.paid_amount || 0 }; if (veh.id) await api.put(`/broker-vehicles/${veh.id}`, payload); else await api.post(`/brokers/${detail.id}/vehicles`, payload); setVeh(null); reload(); toast.success(t("save")); }
    catch (e) { toast.error(apiError(e)); }
  };
  const receive = async (bvid) => {
    try { await api.put(`/broker-vehicles/${bvid}/receive`, { received_date: new Date().toISOString().slice(0, 10) }); reload(); toast.success(t("received")); }
    catch (e) { toast.error(apiError(e)); }
  };
  const addPay = async () => {
    if (savingPay || !pay || !(+pay.amount > 0)) return;
    setSavingPay(true);
    try {
      const data = { date: pay.date, amount: +pay.amount, method: pay.method, note: pay.note || "" };
      if (pay.id) await api.put(`/broker-payments/${pay.id}`, data);
      else await api.post(`/brokers/${detail.id}/payments`, data);
      setPay(null); reload(); toast.success(t("save"));
    } catch (e) { toast.error(apiError(e)); }
    finally { setSavingPay(false); }
  };
  const deletePay = async (payment) => {
    if (!window.confirm(`Delete this broker payment (${money(payment.amount)})? This changes the balance.`)) return;
    try { await api.delete(`/broker-payments/${payment.id}`); reload(); toast.success(t("delete")); }
    catch (e) { toast.error(apiError(e)); }
  };

  const printBrokerVehicles = () => {
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const rows = (detail.vehicles || []).map((v) => `
      <tr>
        <td>${esc((v.purchase_date || "").slice(0, 10) || "—")}</td>
        <td>${esc(v.vehicle_name || "—")}</td>
        <td>${esc(v.chassis_number || "—")}</td>
        <td style="text-align:right">${esc(money(v.purchase_price || 0))}</td>
        <td style="text-align:right">${esc(money(vehicleDisplayPaid(v)))}</td>
        <td style="text-align:right">${esc(money(vehicleDisplayBalance(v)))}</td>
        <td>${esc(t(v.status))}</td>
      </tr>`).join("");
    const w = printWindow();
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(detail.name)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{font-size:20px;margin:0 0 4px}.meta{font-size:11px;color:#555;margin-bottom:14px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}.box{border:1px solid #bbb;padding:8px;font-size:11px}.box b{display:block;margin-top:3px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#f2f2f2}@media print{button{display:none}}</style>
      </head><body><h1>${esc(detail.name)}</h1><div class="meta">${esc(t("brokers"))} · ${(detail.vehicles || []).length} ${esc(t("vehicles"))}</div>
      <div class="summary"><div class="box">${esc(t("total_purchase"))}<b>${esc(money(a.total_purchase || 0))}</b></div><div class="box">${esc(t("amount_received"))}<b>${esc(money(a.total_paid || 0))}</b></div><div class="box">${esc(t("payment_due"))}<b>${esc(money(a.payment_due || 0))}</b></div><div class="box">${esc(t("advance"))}<b>${esc(money(a.advance || 0))}</b></div></div>
      <table><thead><tr><th>${esc(t("date"))}</th><th>${esc(t("vehicle_name"))}</th><th>${esc(t("chassis"))}</th><th>${esc(t("purchase_price"))}</th><th>${esc(t("paid"))}</th><th>${esc(t("balance"))}</th><th>${esc(t("status"))}</th></tr></thead><tbody>${rows || `<tr><td colspan="7">${esc(t("no_data"))}</td></tr>`}</tbody></table>
      <script>window.onload=()=>window.print();</script></body></html>`);
    w.document.close();
  };

  return (
    <Modal open={!!detail} onClose={() => setDetail(null)} title={detail.name} testid="broker-detail" wide>
      {editable && <div className="mb-2 flex justify-end"><Btn variant="ghost" onClick={()=>setBrokerEdit({...detail})}><Pencil size={15}/>{t("edit")}</Btn></div>}
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        <Info l={t("total_purchase")} v={money(a.total_purchase)} />
        <Info l={t("amount_received")} v={money(a.total_paid)} />
        <Info l={t("payment_due")} v={money(a.payment_due)} cls="text-red-400" />
        <Info l={t("advance")} v={money(a.advance)} cls="text-emerald-400" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-sm border border-border p-3">
        <Info l="Total Cars" v={(detail.vehicles || []).length} />
        <Info l="Pending Cars" v={a.pending_count || 0} cls="gold-text" />
      </div>
      <div className="mt-3" style={{display:"grid",gridTemplateColumns:editable?"repeat(3,minmax(0,1fr))":"minmax(0,1fr)",gap:6}}>
        <div className="broker-action"><IssuePanel kind="broker" party={detail} fullReport={printBrokerVehicles} /></div>
        {editable && <div className="broker-action"><Btn variant="dark" data-testid="broker-add-vehicle" onClick={() => setVeh({ vehicle_name: "", purchase_price: "", paid_amount: "", payment_method: "bank", chassis_number: "", purchase_date: new Date().toISOString().slice(0, 10) })}><Plus size={16} />{t("vehicles") === "Vehicles" ? "Add Vehicle" : `${t("add")} ${t("vehicles")}`}</Btn></div>}
        {editable && <div className="broker-action"><Btn variant="dark" data-testid="broker-add-payment" onClick={() => setPay({ amount: "", method: "cash", note: "", date: new Date().toISOString().slice(0, 10) })}><Plus size={16} />{t("add_payment") === "add_payment" ? "Add Payment" : t("add_payment")}</Btn></div>}
      </div>
      <style>{".broker-action{min-width:0}.broker-action > button{width:100%;min-width:0;min-height:56px;height:100%;padding:8px 3px;white-space:normal;overflow-wrap:anywhere;justify-content:center;text-align:center;font-size:12px;line-height:1.25}.broker-action > button svg{flex-shrink:0}"}</style>
      <h4 className="mt-4 font-head font-bold gold-text">{t("vehicles")} · {a.pending_count} {t("pending")} / {a.received_count} {t("received")}</h4>
      {detail.vehicles.map((v) => (
        <div key={v.id} data-testid={`bv-${v.id}`} className="mt-2 rounded-sm border border-border p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">{v.vehicle_name}</span>
            <Badge tone={v.status === "received" ? "green" : "gold"}>{t(v.status)}</Badge>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground sm:grid-cols-4">
            <span>{(v.purchase_date || "").slice(0, 10)}</span>
            <span>{money(v.purchase_price)}</span>
            <span className={vehicleDisplayBalance(v) <= 0 ? "text-emerald-400" : ""}>{t("paid")}: {money(vehicleDisplayPaid(v))}</span>
            <span>{v.chassis_number || "—"}</span>
            <span className={vehicleDisplayBalance(v) > 0 ? "text-red-400" : "text-emerald-400"}>{t("balance")}: {money(vehicleDisplayBalance(v))}</span>
          </div>
          {editable && <div className="mt-2 flex gap-1">
            {v.status === "pending" && <Btn variant="ghost" data-testid={`bv-receive-${v.id}`} onClick={() => receive(v.id)}>{t("mark_received")}</Btn>}
            <Btn variant="ghost" onClick={()=>setVeh({...v, broker_id:v.broker_id||detail.id, purchase_date:(v.purchase_date||"").slice(0,10), purchase_price:String(v.purchase_price??""), paid_amount:String(v.paid_amount??"")})}><Pencil size={14}/>{t("edit")}</Btn>
            <Btn variant="ghost" onClick={async()=>{if(!window.confirm(`${t("delete")}?`))return; await api.delete(`/broker-vehicles/${v.id}`); reload();}}><Trash2 size={14} className="text-red-400"/></Btn>
          </div>}
        </div>
      ))}

      <div className="mt-4 flex items-center justify-between">
        <h4 className="font-head font-bold gold-text">{t("payments")}</h4>
      </div>
      {detail.payments.map((p) => (
        <div key={p.id} className="flex justify-between border-b border-border py-1.5 text-sm">
          <span>{(p.date || "").slice(0, 10)} · {p.method}</span>
          <div className="flex flex-wrap items-center justify-end gap-2"><span className="text-white">{money(p.amount)}</span>
            {editable && <><Btn variant="ghost" data-testid={`broker-edit-payment-${p.id}`} onClick={() => setPay({ ...p, date: (p.date || "").slice(0, 10), amount: String(p.amount) })}><Pencil size={14}/>{t("edit")}</Btn>
            <Btn variant="ghost" data-testid={`broker-delete-payment-${p.id}`} onClick={() => deletePay(p)}><Trash2 size={14} className="text-red-400"/>{t("delete")}</Btn></>}
          </div>
        </div>
      ))}

      <Modal open={!!veh} onClose={() => setVeh(null)} title={t("add")} testid="bv-add-modal">
        {veh && (<div>
          <Field label={t("date")}><Input type="date" value={veh.purchase_date} onChange={(e) => setVeh({ ...veh, purchase_date: e.target.value })} /></Field>
          <Field label={t("vehicle_name")}><NameSuggestInput kind="vehicle" data-testid="bv-name" value={veh.vehicle_name} onChange={(e) => setVeh({ ...veh, vehicle_name: e.target.value })} /></Field>
          <Field label={t("purchase_price")}><Input type="number" data-testid="bv-price" value={veh.purchase_price} onChange={(e) => setVeh({ ...veh, purchase_price: e.target.value })} /></Field>
          <Field label={t("paid")}><Input type="number" value={veh.paid_amount} onChange={(e) => setVeh({ ...veh, paid_amount: e.target.value })} /></Field>
          <Field label={t("payment_method")}><select value={veh.payment_method || "bank"} onChange={(e) => setVeh({ ...veh, payment_method: e.target.value })} disabled={(+veh.paid_amount || 0) <= 0} className="w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none"><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></select></Field>
          <Field label={t("chassis")}><Input value={veh.chassis_number} onChange={(e) => setVeh({ ...veh, chassis_number: e.target.value })} /></Field>
          {veh.id && <Field label="Broker"><select value={veh.broker_id||detail.id} onChange={(e)=>setVeh({...veh,broker_id:e.target.value})} className="w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2 text-sm text-white">{brokers.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
          <div className="mt-2 flex justify-end gap-2"><Btn variant="dark" onClick={() => setVeh(null)}>{t("cancel")}</Btn><Btn data-testid="save-bv" onClick={addVehicle}>{t("save")}</Btn></div>
        </div>)}
      </Modal>

      <Modal open={!!brokerEdit} onClose={()=>setBrokerEdit(null)} title={t("edit")}>
        {brokerEdit && <div><Field label={t("broker_name")}><Input value={brokerEdit.name} onChange={e=>setBrokerEdit({...brokerEdit,name:e.target.value})}/></Field><Field label={t("phone")}><Input value={brokerEdit.phone} onChange={e=>setBrokerEdit({...brokerEdit,phone:e.target.value})}/></Field><PartyFields value={brokerEdit} onChange={setBrokerEdit} broker /><div className="flex justify-end gap-2"><Btn variant="dark" onClick={()=>setBrokerEdit(null)}>{t("cancel")}</Btn><Btn onClick={async()=>{await api.put(`/brokers/${detail.id}`,brokerEdit);setBrokerEdit(null);reload();}}>{t("save")}</Btn></div></div>}
      </Modal>

      <Modal open={!!pay} onClose={() => !savingPay && setPay(null)} title={pay?.id ? t("edit") : t("add_payment")} testid="bp-add-modal">
        {pay && (<div>
          <Field label={t("date")}><Input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
          <Field label={t("amount")}><Input type="number" data-testid="bp-amount" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
          <Field label={t("method")}>
            <select data-testid="bp-method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}
              className="w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none">
              <option value="cash">Cash</option><option value="bank">Bank</option>
            </select>
          </Field>
          <Field label={t("notes")}><Input value={pay.note || ""} onChange={e => setPay({...pay, note: e.target.value})}/></Field>
          <div className="mt-2 flex justify-end gap-2"><Btn variant="dark" disabled={savingPay} onClick={() => setPay(null)}>{t("cancel")}</Btn><Btn disabled={savingPay} data-testid="save-bp" onClick={addPay}>{savingPay ? "Saving..." : t("save")}</Btn></div>
        </div>)}
      </Modal>
    </Modal>
  );
}

function Info({ l, v, cls = "text-white" }) {
  return <div><div className="text-xs text-muted-foreground">{l}</div><div className={`font-semibold ${cls}`}>{v}</div></div>;
}
