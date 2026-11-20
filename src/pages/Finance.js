import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiError, downloadUrl } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Empty, Badge, DataTable } from "@/components/kit";
import { toast } from "sonner";
import { Plus, Trash2, Download, FileText, CreditCard, Receipt, Users } from "lucide-react";

const TABS = [
  { k: "invoices", icon: FileText },
  { k: "expenses", icon: Receipt },
];

export default function Finance() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "invoices");
  const editable = can("finance.edit");

  return (
    <div>
      <PageHeader title={t("finance")} />
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button key={x.k} data-testid={`fin-tab-${x.k}`} onClick={() => setTab(x.k)}
            className={`flex items-center gap-2 rounded-sm border px-4 py-2 text-sm font-medium transition-colors ${tab === x.k ? "gold-gradient border-transparent text-black" : "border-border text-gray-300 hover:text-white"}`}>
            <x.icon size={15} />{t(x.k)}
          </button>
        ))}
      </div>
      {tab === "invoices" && <Invoices t={t} money={money} editable={editable} />}
      {tab === "expenses" && <Expenses t={t} money={money} editable={editable} />}
    </div>
  );
}

function Invoices({ t, money, editable }) {
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [parts, setParts] = useState([]);
  const [tracked, setTracked] = useState([]);
  const [form, setForm] = useState(null);
  const load = useCallback(() => { api.get("/invoices").then((r) => setRows(r.data)); }, []);
  const loadInv = useCallback(() => {
    api.get("/vehicles?status=in_stock").then((r) => setVehicles(r.data));
    api.get("/parts").then((r) => setParts(r.data.filter((p) => p.quantity > 0)));
    api.get("/tracked-parts").then((r) => setTracked(r.data.filter((x) => x.status === "available")));
  }, []);
  useEffect(() => { load(); api.get("/customers").then((r) => setCustomers(r.data)); loadInv(); }, [load, loadInv]);

  const openNew = () => { loadInv(); setForm({ customer_id: "", amount_paid: 0, notes: "",
    sale_date: new Date().toISOString().slice(0, 10),
    items: [{ description: "", quantity: 1, unit_price: 0, item_type: "custom", ref_id: null }] }); };

  const pickRef = (i, item_type, ref_id) => {
    const items = [...form.items];
    let patch = ref_id
      ? { item_type, ref_id }
      : { item_type, ref_id: null, description: "", quantity: 1, unit_price: 0, search: "" };
    if (item_type === "vehicle" && ref_id) {
      const v = vehicles.find((x) => x.id === ref_id);
      if (v) patch = { ...patch, description: v.vehicle_name || `${v.make || ""} ${v.model || ""}`.trim() || v.chassis_number, quantity: 1, unit_price: v.purchase_price };
    } else if (item_type === "part" && ref_id) {
      const p = parts.find((x) => x.id === ref_id);
      if (p) patch = { ...patch, description: p.name + (p.part_number ? ` [${p.part_number}]` : ""), unit_price: p.sale_price };
    } else if ((item_type === "engine" || item_type === "half_cut") && ref_id) {
      const tp = tracked.find((x) => x.id === ref_id);
      if (tp) patch = { ...patch, description: tp.name || tp.engine_code || tp.vehicle_name || (item_type === "half_cut" ? "Half Cut" : "Engine"), quantity: 1, unit_price: 0 };
    }
    items[i] = { ...items[i], ...patch };
    setForm({ ...form, items });
  };
  const save = async () => {
    try {
      await api.post("/invoices", { ...form, amount_paid: +form.amount_paid || 0,
        items: form.items.filter((i) => i.description).map((i) => ({ ...i, quantity: +i.quantity, unit_price: +i.unit_price })) });
      toast.success(t("save")); setForm(null); load(); loadInv();
    } catch (e) { toast.error(apiError(e)); }
  };
  const subtotal = form ? form.items.reduce((s, i) => s + (+i.quantity || 0) * (+i.unit_price || 0), 0) : 0;

  const columns = [
    { label: t("invoice_no"), cell: "font-mono text-[var(--gold)]", render: (r) => r.invoice_number },
    { label: t("customer"), render: (r) => r.customer_name },
    { label: t("total"), align: "end", render: (r) => money(r.total) },
    { label: t("paid"), align: "end", render: (r) => <Badge tone={r.amount_paid >= r.total ? "green" : "red"}>{money(r.amount_paid)}</Badge> },
    { label: t("date"), render: (r) => r.created_at.slice(0, 10) },
    { label: t("action"), action: true, render: (r) => (
      <div className="flex gap-1">
        <a href={downloadUrl(`/invoices/${r.id}/pdf`)} target="_blank" rel="noreferrer" data-testid={`invoice-pdf-${r.id}`}><Btn variant="ghost"><Download size={16} /></Btn></a>
        {editable && <Btn variant="ghost" data-testid={`void-invoice-${r.id}`} onClick={async () => { if (window.confirm(t("confirm_void"))) { try { await api.delete(`/invoices/${r.id}`); toast.success(t("void")); load(); loadInv(); } catch (e) { toast.error(apiError(e)); } } }}><Trash2 size={16} className="text-red-400" /></Btn>}
      </div>) },
  ];

  return (
    <div>
      {editable && <div className="mb-3"><Btn data-testid="create-invoice-btn" onClick={openNew}><Plus size={16} />{t("create_invoice")}</Btn></div>}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} rowTestId={(r) => `invoice-row-${r.id}`} empty={t("no_data")} />
      <Modal open={!!form} onClose={() => setForm(null)} title={t("create_invoice")} testid="invoice-modal" wide>
        {form && (
          <div>
            <Field label={t("customer")}>
              <Select data-testid="inv-customer" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                <option value="">—</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            {form.items.map((it, i) => {
              const search = (it.search || "").trim().toLowerCase();
              const match = (text) => !search || String(text || "").toLowerCase().includes(search);
              const fv = vehicles.filter((v) => match(`${v.vehicle_name || ""} ${v.make || ""} ${v.model || ""} ${v.chassis_number || ""}`));
              const fp = parts.filter((p) => match(`${p.name || ""} ${p.part_number || ""} ${p.category || ""}`));
              const ft = tracked.filter((x) => x.part_type === it.item_type && match(`${x.name || ""} ${x.engine_code || ""} ${x.engine_number || ""} ${x.chassis_number || ""} ${x.vehicle_name || ""}`));
              return (
              <div key={i} className="mb-2 rounded-sm border border-border p-2">
                <div className="mb-2 grid grid-cols-12 gap-2">
                  <div className="col-span-4">
                    <Select data-testid={`inv-type-${i}`} value={it.item_type}
                      onChange={(e) => pickRef(i, e.target.value, null)}>
                      <option value="custom">{t("custom_item")}</option>
                      <option value="vehicle">{t("vehicles")}</option>
                      <option value="part">{t("parts")}</option>
                      <option value="engine">{t("engine")}</option>
                      <option value="half_cut">{t("half_cut")}</option>
                    </Select>
                  </div>
                  <div className="col-span-8">
                    {it.item_type !== "custom" ? (
                      <div className="space-y-2">
                        <Input data-testid={`inv-search-${i}`} placeholder={`${t("search")}...`} value={it.search || ""}
                          onChange={(e) => updItem(form, setForm, i, "search", e.target.value)} />
                        {it.item_type === "vehicle" ? (
                          <Select data-testid={`inv-ref-${i}`} value={it.ref_id || ""} onChange={(e) => pickRef(i, "vehicle", e.target.value)}>
                            <option value="">{t("select_item")}</option>
                            {fv.map((v) => <option key={v.id} value={v.id}>{v.vehicle_name || `${v.make || ""} ${v.model || ""}`.trim() || "Vehicle"} — {v.chassis_number}</option>)}
                          </Select>
                        ) : it.item_type === "part" ? (
                          <Select data-testid={`inv-ref-${i}`} value={it.ref_id || ""} onChange={(e) => pickRef(i, "part", e.target.value)}>
                            <option value="">{t("select_item")}</option>
                            {fp.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.quantity})</option>)}
                          </Select>
                        ) : (
                          <Select data-testid={`inv-ref-${i}`} value={it.ref_id || ""} onChange={(e) => pickRef(i, it.item_type, e.target.value)}>
                            <option value="">{t("select_item")}</option>
                            {ft.map((x) => <option key={x.id} value={x.id}>{x.name || x.engine_code || x.vehicle_name || (x.part_type === "half_cut" ? "Half Cut" : "Engine")}{x.chassis_number ? ` — ${x.chassis_number}` : ""}</option>)}
                          </Select>
                        )}
                      </div>
                    ) : (
                      <Input placeholder={t("description")} data-testid={`inv-desc-${i}`} value={it.description} onChange={(e) => updItem(form, setForm, i, "description", e.target.value)} />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-2">
                  <Input className="col-span-6" placeholder={t("description")} value={it.description} onChange={(e) => updItem(form, setForm, i, "description", e.target.value)} />
                  <Input className="col-span-2" type="number" placeholder={t("quantity")} value={it.quantity} onChange={(e) => updItem(form, setForm, i, "quantity", e.target.value)} />
                  <Input className="col-span-4" type="number" placeholder={t("sale_price")} value={it.unit_price} onChange={(e) => updItem(form, setForm, i, "unit_price", e.target.value)} />
                </div>
              </div>
              );
            })}
            <Btn variant="dark" onClick={() => setForm({ ...form, items: [...form.items, { description: "", quantity: 1, unit_price: 0, item_type: "custom", ref_id: null }] })}><Plus size={14} />{t("add_item")}</Btn>
            <div className="mt-3 flex items-center justify-between text-sm"><span className="text-muted-foreground">{t("total_incl_tax")}</span><span className="gold-text font-bold">{money(subtotal)}</span></div>
            <p className="mt-1 text-xs text-muted-foreground">{t("prices_incl_tax")}</p>
            <Field label={t("sale_date")}><Input type="date" data-testid="inv-sale-date" value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} /></Field>
            <Field label={t("paid")}><Input type="number" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} /></Field>
            <div className="mt-2 flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn data-testid="save-invoice" onClick={save}>{t("save")}</Btn></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Payments({ t, money, editable }) {
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState(null);
  const load = useCallback(() => { api.get("/payments").then((r) => setRows(r.data)); }, []);
  useEffect(() => { load(); api.get("/customers").then((r) => setCustomers(r.data)); }, [load]);
  const save = async () => {
    try { await api.post("/payments", { ...form, amount: +form.amount }); toast.success(t("save")); setForm(null); load(); }
    catch (e) { toast.error(apiError(e)); }
  };
  const columns = [
    { label: t("customer"), render: (r) => r.customer_name },
    { label: t("amount"), align: "end", render: (r) => money(r.amount) },
    { label: t("method"), render: (r) => r.method },
    { label: t("advance"), render: (r) => r.is_advance ? <Badge>Yes</Badge> : "—" },
    { label: t("date"), render: (r) => r.created_at.slice(0, 10) },
    { label: t("action"), action: true, render: (r) => (editable && <Btn variant="ghost" data-testid={`void-payment-${r.id}`} onClick={async () => { if (window.confirm(t("confirm_void"))) { try { await api.delete(`/payments/${r.id}`); toast.success(t("void")); load(); } catch (e) { toast.error(apiError(e)); } } }}><Trash2 size={16} className="text-red-400" /></Btn>) },
  ];
  return (
    <div>
      {editable && <div className="mb-3"><Btn data-testid="record-payment-btn" onClick={() => setForm({ customer_id: "", amount: 0, method: "cash", is_advance: false, note: "" })}><Plus size={16} />{t("record_payment")}</Btn></div>}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={t("no_data")} />
      <Modal open={!!form} onClose={() => setForm(null)} title={t("record_payment")} testid="payment-modal">
        {form && (<div>
          <Field label={t("customer")}><Select data-testid="pay-customer" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}><option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label={t("amount")}><Input type="number" data-testid="pay-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label={t("method")}><Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option></Select></Field>
          <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_advance} onChange={(e) => setForm({ ...form, is_advance: e.target.checked })} />{t("is_advance")}</label>
          <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn data-testid="save-payment" onClick={save}>{t("save")}</Btn></div>
        </div>)}
      </Modal>
    </div>
  );
}

function Expenses({ t, money, editable }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const load = useCallback(() => { api.get("/expenses").then((r) => setRows(r.data)); }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => { try { await api.post("/expenses", { ...form, amount: +form.amount }); toast.success(t("save")); setForm(null); load(); } catch (e) { toast.error(apiError(e)); } };
  const columns = [
    { label: t("category"), render: (r) => r.category },
    { label: t("amount"), align: "end", cell: "text-red-400", render: (r) => money(r.amount) },
    { label: t("description"), render: (r) => r.description },
    { label: t("date"), render: (r) => (r.date || "").slice(0, 10) },
    { label: t("action"), action: true, render: (r) => (editable && <Btn variant="ghost" onClick={async () => { await api.delete(`/expenses/${r.id}`); load(); }}><Trash2 size={16} className="text-red-400" /></Btn>) },
  ];
  return (
    <div>
      {editable && <div className="mb-3"><Btn data-testid="add-expense-btn" onClick={() => setForm({ category: "", amount: 0, description: "" })}><Plus size={16} />{t("add_expense")}</Btn></div>}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={t("no_data")} />
      <Modal open={!!form} onClose={() => setForm(null)} title={t("add_expense")} testid="expense-modal">
        {form && (<div>
          <Field label={t("category")}><Select data-testid="exp-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">—</option>
            <option value="Salary">{t("exp_salary")}</option>
            <option value="Diesel / Fuel">{t("exp_diesel")}</option>
            <option value="Transport">{t("exp_transport")}</option>
            <option value="Repairs">{t("exp_repairs")}</option>
            <option value="Other Expense">{t("exp_other")}</option>
          </Select></Field>
          <Field label={t("amount")}><Input type="number" data-testid="exp-amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label={t("description")}><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn data-testid="save-expense" onClick={save}>{t("save")}</Btn></div>
        </div>)}
      </Modal>
    </div>
  );
}

function Employees({ t, money, editable }) {
  const [rows, setRows] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [form, setForm] = useState(null);
  const [payForm, setPayForm] = useState(null);
  const load = useCallback(() => { api.get("/employees").then((r) => setRows(r.data)); api.get("/salaries").then((r) => setSalaries(r.data)); }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      {editable && <div className="mb-3 flex gap-2"><Btn data-testid="add-employee-btn" onClick={() => setForm({ name: "", position: "", monthly_salary: 0, phone: "" })}><Plus size={16} />{t("add_employee")}</Btn></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-surface overflow-x-auto rounded-sm">
          <div className="border-b border-border p-3 font-head font-bold gold-text">{t("employees")}</div>
          <table className="w-full text-sm">
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b border-border hover:bg-white/5">
                <td className="p-3">{r.name}<div className="text-xs text-muted-foreground">{r.position}</div></td>
                <td className="p-3 text-end">{money(r.monthly_salary)}</td>
                <td className="p-3 text-end">{editable && <><Btn variant="ghost" data-testid={`pay-salary-${r.id}`} onClick={() => setPayForm({ employee_id: r.id, amount: r.monthly_salary, month: new Date().toISOString().slice(0, 7), note: "" })}>{t("pay_salary")}</Btn><Btn variant="ghost" onClick={async () => { await api.delete(`/employees/${r.id}`); load(); }}><Trash2 size={16} className="text-red-400" /></Btn></>}</td>
              </tr>))}</tbody>
          </table>
          {rows.length === 0 && <Empty text={t("no_data")} />}
        </div>
        <div className="card-surface overflow-x-auto rounded-sm">
          <div className="border-b border-border p-3 font-head font-bold gold-text">{t("salaries")}</div>
          <table className="w-full text-sm">
            <tbody>{salaries.map((s) => (
              <tr key={s.id} className="border-b border-border"><td className="p-3">{s.employee_name}</td><td className="p-3">{s.month}</td><td className="p-3 text-end text-red-400">{money(s.amount)}</td></tr>))}</tbody>
          </table>
          {salaries.length === 0 && <Empty text={t("no_data")} />}
        </div>
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={t("add_employee")} testid="employee-modal">
        {form && (<div>
          <Field label={t("name")}><Input data-testid="emp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t("position")}><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></Field>
          <Field label={t("monthly_salary")}><Input type="number" data-testid="emp-salary" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} /></Field>
          <Field label={t("phone")}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn data-testid="save-employee" onClick={async () => { try { await api.post("/employees", { ...form, monthly_salary: +form.monthly_salary }); toast.success(t("save")); setForm(null); load(); } catch (e) { toast.error(apiError(e)); } }}>{t("save")}</Btn></div>
        </div>)}
      </Modal>
      <Modal open={!!payForm} onClose={() => setPayForm(null)} title={t("pay_salary")} testid="salary-modal">
        {payForm && (<div>
          <Field label={t("amount")}><Input type="number" data-testid="sal-amount" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
          <Field label={t("month")}><Input value={payForm.month} onChange={(e) => setPayForm({ ...payForm, month: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setPayForm(null)}>{t("cancel")}</Btn><Btn data-testid="save-salary" onClick={async () => { try { await api.post("/salaries", { ...payForm, amount: +payForm.amount }); toast.success(t("save")); setPayForm(null); load(); } catch (e) { toast.error(apiError(e)); } }}>{t("save")}</Btn></div>
        </div>)}
      </Modal>
    </div>
  );
}

function updItem(form, setForm, i, key, val) {
  const items = [...form.items]; items[i] = { ...items[i], [key]: val }; setForm({ ...form, items });
}
