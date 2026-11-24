import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Badge, DataTable } from "@/components/kit";
import { toast } from "sonner";
import { Calculator, Users, Plus, Trash2, Wallet, Ship } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function ExpensesSalary() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const editable = can("finance.edit");
  const [tab, setTab] = useState("expenses");
  const [expenses, setExpenses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [shippingRows, setShippingRows] = useState([]);
  const [shippingSaving, setShippingSaving] = useState(false);
  const [expenseForm, setExpenseForm] = useState(null);
  const [shippingForm, setShippingForm] = useState(null);
  const [employeeForm, setEmployeeForm] = useState(null);
  const [salaryForm, setSalaryForm] = useState(null);
  const [salaryMonth, setSalaryMonth] = useState(thisMonth());

  const load = useCallback(async () => {
    try {
      const [er, emr, sr, cr, shr] = await Promise.all([api.get("/expenses"), api.get("/employees"), api.get("/salaries"), api.get("/customers"), api.get("/customer-shipping")]);
      setExpenses(er.data || []); setEmployees(emr.data || []); setSalaries(sr.data || []); setCustomers(cr.data || []); setShippingRows(shr.data || []);
    } catch (_) {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const generalExpenses = useMemo(() => expenses.filter((e) => e.category !== "shipping"), [expenses]);
  const shippingExpenses = useMemo(() => expenses.filter((e) => e.category === "shipping"), [expenses]);

  const saveExpense = async () => {
    if (!expenseForm.category || (+expenseForm.amount || 0) <= 0) { toast.error(t("required_fields")); return; }
    try {
      await api.post("/expenses", { ...expenseForm, amount: +expenseForm.amount || 0 });
      toast.success(t("save")); setExpenseForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const saveShipping = async () => {
    if (shippingSaving || !shippingForm?.customer_id || !shippingForm.date || !shippingForm.container_number?.trim() ||
        (+shippingForm.amount || 0) <= 0 || !["cash", "bank"].includes(shippingForm.method)) {
      toast.error(t("required_fields")); return;
    }
    setShippingSaving(true);
    try {
      const payload = { ...shippingForm, amount: +shippingForm.amount, container_number: shippingForm.container_number.trim() };
      if (shippingForm.id) await api.put(`/customer-shipping/${shippingForm.id}`, payload);
      else await api.post("/customer-shipping", payload);
      toast.success(t("save")); setShippingForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setShippingSaving(false); }
  };

  const removeShipping = async (id) => {
    if (!window.confirm("Delete customer shipping record?")) return;
    try { await api.delete(`/customer-shipping/${id}`); load(); } catch (e) { toast.error(apiError(e)); }
  };

  const saveEmployee = async () => {
    if (!employeeForm.name) { toast.error(t("required_fields")); return; }
    try {
      await api.post("/employees", { ...employeeForm, monthly_salary: +employeeForm.monthly_salary || 0 });
      toast.success(t("save")); setEmployeeForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const saveSalary = async () => {
    if (!salaryForm.employee_id || (+salaryForm.amount || 0) <= 0 || !salaryForm.month) { toast.error(t("required_fields")); return; }
    try {
      await api.post("/salaries", { ...salaryForm, amount: +salaryForm.amount || 0 });
      toast.success(t("save")); setSalaryForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  const removeExpense = async (id) => {
    if (!window.confirm("Delete?")) return;
    try { await api.delete(`/expenses/${id}`); load(); } catch (e) { toast.error(apiError(e)); }
  };

  const expenseCols = [
    { label: t("date"), render: (r) => (r.date || r.created_at || "").slice(0, 10) },
    { label: t("category"), render: (r) => t(`exp_${r.category}`) !== `exp_${r.category}` ? t(`exp_${r.category}`) : r.category },
    { label: t("description"), render: (r) => r.description || "—" },
    { label: t("payment_method"), render: (r) => t(r.method || "cash") },
    { label: t("amount"), align: "end", render: (r) => money(r.amount || 0) },
    { label: t("action"), action: true, render: (r) => editable && <Btn variant="ghost" onClick={() => removeExpense(r.id)}><Trash2 size={16} className="text-red-400" /></Btn> },
  ];

  const shippingCols = [
    { label: t("date"), render: (r) => r.date },
    { label: "Customer", render: (r) => customers.find((c) => c.id === r.customer_id)?.name || "—" },
    { label: "Container No.", render: (r) => r.container_number },
    { label: t("invoice_no"), render: (r) => r.invoice_number || "—" },
    { label: t("amount"), align: "end", render: (r) => money(r.amount || 0) },
    { label: t("payment_method"), render: (r) => t(r.method) },
    { label: t("notes"), render: (r) => r.note || "—" },
    { label: t("action"), action: true, render: (r) => editable && <div className="flex gap-1"><Btn variant="ghost" onClick={() => setShippingForm({ ...r })}>Edit</Btn><Btn variant="ghost" onClick={() => removeShipping(r.id)}><Trash2 size={16} className="text-red-400" /></Btn></div> },
  ];

  const paidByEmployee = useMemo(() => {
    const m = {};
    for (const s of salaries) if (s.month === salaryMonth) m[s.employee_id] = (m[s.employee_id] || 0) + (+s.amount || 0);
    return m;
  }, [salaries, salaryMonth]);

  return <div>
    <PageHeader title={t("expenses")} />
    <div className="mb-5 grid grid-cols-3 gap-3 sm:max-w-3xl">
      <button onClick={() => setTab("expenses")} aria-pressed={tab === "expenses"} style={tab === "expenses" ? { background: "linear-gradient(135deg, #b58a24, #f1d675, #b58a24)", color: "#101827" } : undefined} className={`card-surface flex min-w-0 flex-col items-center gap-1 rounded-sm border p-2 text-center sm:flex-row sm:gap-3 sm:p-4 sm:text-start ${tab === "expenses" ? "border-[var(--gold)] ring-2 ring-inset ring-[var(--gold)]" : "border-border"}`}>
        <Calculator className="gold-text" /><div><div className="font-bold">{t("expenses")}</div><div className="text-xs opacity-80 break-words">{t("business_expenses")}</div></div>
      </button>
      <button onClick={() => setTab("salary")} aria-pressed={tab === "salary"} style={tab === "salary" ? { background: "linear-gradient(135deg, #b58a24, #f1d675, #b58a24)", color: "#101827" } : undefined} className={`card-surface flex min-w-0 flex-col items-center gap-1 rounded-sm border p-2 text-center sm:flex-row sm:gap-3 sm:p-4 sm:text-start ${tab === "salary" ? "border-[var(--gold)] ring-2 ring-inset ring-[var(--gold)]" : "border-border"}`}>
        <Users className="gold-text" /><div><div className="font-bold">{t("salary")}</div><div className="text-xs opacity-80 break-words">{t("employee_salary")}</div></div>
      </button>
      <button onClick={() => setTab("shipping")} aria-pressed={tab === "shipping"} style={tab === "shipping" ? { background: "linear-gradient(135deg, #b58a24, #f1d675, #b58a24)", color: "#101827" } : undefined} className={`card-surface flex min-w-0 flex-col items-center gap-1 rounded-sm border p-2 text-center sm:flex-row sm:gap-3 sm:p-4 sm:text-start ${tab === "shipping" ? "border-[var(--gold)] ring-2 ring-inset ring-[var(--gold)]" : "border-border"}`}>
        <Ship className="gold-text" /><div><div className="font-bold">{t("shipping_cost")}</div><div className="text-xs opacity-80 break-words">{t("shipping_payments")}</div></div>
      </button>
    </div>

    {tab === "expenses" && <>
      {editable && <div className="mb-3"><Btn onClick={() => setExpenseForm({ date: today(), category: "diesel", amount: "", method: "cash", description: "" })}><Plus size={16} />{t("add_expense")}</Btn></div>}
      <DataTable columns={expenseCols} rows={generalExpenses} rowKey={(r) => r.id} empty={t("no_data")} />
    </>}

    {tab === "shipping" && <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">{t("shipping_cost_hint")}</div>
        {editable && <Btn onClick={() => setShippingForm({ date: today(), customer_id: "", container_number: "", invoice_number: "", amount: "", method: "bank", note: "" })}><Plus size={16} />{t("add_shipping_payment")}</Btn>}
      </div>
      <DataTable columns={shippingCols} rows={shippingRows} rowKey={(r) => r.id} empty={t("no_data")} />
        {shippingExpenses.length > 0 && <div className="mt-6"><h3 className="mb-2 font-semibold text-white">Previous Shipping Expenses (unchanged)</h3><p className="mb-2 text-xs text-muted-foreground">These older expense records are not customer-recoverable shipping. Their original accounting is preserved.</p><DataTable columns={expenseCols} rows={shippingExpenses} rowKey={(r) => r.id} empty={t("no_data")} /></div>}
    </>}

    {tab === "salary" && <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-sm border border-border bg-[var(--surface-2)] p-3">
        <Field label={t("month")}><Input type="month" value={salaryMonth} onChange={(e) => setSalaryMonth(e.target.value)} /></Field>
        {editable && <Btn variant="dark" onClick={() => setEmployeeForm({ name: "", position: "", monthly_salary: "" })}><Plus size={16} />{t("add_employee")}</Btn>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {employees.map((e) => {
          const paid = paidByEmployee[e.id] || 0;
          const expected = +e.monthly_salary || 0;
          const balance = Math.max(0, expected - paid);
          return <div key={e.id} className="card-surface rounded-sm p-4">
            <div className="flex items-start justify-between gap-3">
              <div><div className="font-semibold text-white">{e.name}</div><div className="text-xs text-muted-foreground">{e.position || "—"}</div></div>
              <Badge tone={balance <= 0 && expected > 0 ? "green" : "gold"}>{balance <= 0 && expected > 0 ? t("paid_status") : t("unpaid")}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Info label={t("monthly_salary")} value={money(expected)} />
              <Info label={t("paid")} value={money(paid)} />
              <Info label={t("balance_due")} value={money(balance)} />
            </div>
            {editable && <div className="mt-3 flex gap-2">
              <Btn onClick={() => setSalaryForm({ employee_id: e.id, employee_name: e.name, month: salaryMonth, date: today(), amount: balance || expected || "", method: "bank", note: "" })}><Wallet size={15} />{t("pay_salary")}</Btn>
              <Btn variant="ghost" onClick={async () => {
                if (!window.confirm("Delete employee?")) return;
                try { await api.delete(`/employees/${e.id}`); load(); } catch (err) { toast.error(apiError(err)); }
              }}><Trash2 size={15} className="text-red-400" /></Btn>
            </div>}
          </div>;
        })}
      </div>
      {!employees.length && <div className="py-8 text-center text-muted-foreground">{t("no_data")}</div>}
      <h3 className="mb-2 mt-6 font-head font-bold gold-text">{t("salary_history")}</h3>
      <DataTable columns={[
        { label: t("date"), render: (s) => (s.date || s.created_at || "").slice(0, 10) },
        { label: t("employee"), render: (s) => s.employee_name || "—" },
        { label: t("month"), render: (s) => s.month },
        { label: t("payment_method"), render: (s) => t(s.method || "cash") },
        { label: t("amount"), align: "end", render: (s) => money(s.amount || 0) },
      ]} rows={salaries} rowKey={(s) => s.id} empty={t("no_data")} />
    </>}

    <Modal open={!!expenseForm} onClose={() => setExpenseForm(null)} title={t("add_expense")}>
      {expenseForm && <div>
        <Field label={t("date")}><Input type="date" value={expenseForm.date} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} /></Field>
        <Field label={t("category")}><Select value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}>
          <option value="diesel">{t("exp_diesel")}</option><option value="transport">{t("exp_transport")}</option><option value="repairs">{t("exp_repairs")}</option><option value="rent">{t("rent")}</option><option value="other">{t("exp_other")}</option>
        </Select></Field>
        <Field label={t("amount")}><Input type="number" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></Field>
        <Field label={t("payment_method")}><Select value={expenseForm.method} onChange={(e) => setExpenseForm({ ...expenseForm, method: e.target.value })}><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>
        <Field label={t("description")}><Input value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setExpenseForm(null)}>{t("cancel")}</Btn><Btn onClick={saveExpense}>{t("save")}</Btn></div>
      </div>}
    </Modal>

    <Modal open={!!shippingForm} onClose={() => setShippingForm(null)} title="Customer Shipping Cost">
      {shippingForm && <div>
        <Field label="Customer / Company"><Select value={shippingForm.customer_id} onChange={(e) => setShippingForm({ ...shippingForm, customer_id: e.target.value })}>
          <option value="">Select customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select></Field>
        <Field label={t("payment_date")}><Input type="date" value={shippingForm.date} onChange={(e) => setShippingForm({ ...shippingForm, date: e.target.value })} /></Field>
        <Field label="Container No."><Input value={shippingForm.container_number} onChange={(e) => setShippingForm({ ...shippingForm, container_number: e.target.value })} /></Field>
        <Field label={t("invoice_no")}><Input value={shippingForm.invoice_number || ""} onChange={(e) => setShippingForm({ ...shippingForm, invoice_number: e.target.value })} /></Field>
        <Field label={t("amount")}><Input type="number" value={shippingForm.amount} onChange={(e) => setShippingForm({ ...shippingForm, amount: e.target.value })} /></Field>
        <Field label={t("payment_method")}><Select value={shippingForm.method} onChange={(e) => setShippingForm({ ...shippingForm, method: e.target.value })}><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>
        <Field label={t("notes")}><Input value={shippingForm.note || ""} onChange={(e) => setShippingForm({ ...shippingForm, note: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setShippingForm(null)}>{t("cancel")}</Btn><Btn disabled={shippingSaving} onClick={saveShipping}>{t("save")}</Btn></div>
      </div>}
    </Modal>

    <Modal open={!!employeeForm} onClose={() => setEmployeeForm(null)} title={t("add_employee")}>
      {employeeForm && <div>
        <Field label={t("name")}><Input value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })} /></Field>
        <Field label={t("position")}><Input value={employeeForm.position} onChange={(e) => setEmployeeForm({ ...employeeForm, position: e.target.value })} /></Field>
        <Field label={t("monthly_salary")}><Input type="number" value={employeeForm.monthly_salary} onChange={(e) => setEmployeeForm({ ...employeeForm, monthly_salary: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setEmployeeForm(null)}>{t("cancel")}</Btn><Btn onClick={saveEmployee}>{t("save")}</Btn></div>
      </div>}
    </Modal>

    <Modal open={!!salaryForm} onClose={() => setSalaryForm(null)} title={t("pay_salary")}>
      {salaryForm && <div>
        <div className="mb-3 font-semibold gold-text">{salaryForm.employee_name}</div>
        <Field label={t("month")}><Input type="month" value={salaryForm.month} onChange={(e) => setSalaryForm({ ...salaryForm, month: e.target.value })} /></Field>
        <Field label={t("payment_date")}><Input type="date" value={salaryForm.date} onChange={(e) => setSalaryForm({ ...salaryForm, date: e.target.value })} /></Field>
        <Field label={t("amount")}><Input type="number" value={salaryForm.amount} onChange={(e) => setSalaryForm({ ...salaryForm, amount: e.target.value })} /></Field>
        <Field label={t("payment_method")}><Select value={salaryForm.method} onChange={(e) => setSalaryForm({ ...salaryForm, method: e.target.value })}><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>
        <Field label={t("notes")}><Input value={salaryForm.note} onChange={(e) => setSalaryForm({ ...salaryForm, note: e.target.value })} /></Field>
        <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setSalaryForm(null)}>{t("cancel")}</Btn><Btn onClick={saveSalary}>{t("save")}</Btn></div>
      </div>}
    </Modal>
  </div>;
}

function Info({ label, value }) { return <div><div className="text-muted-foreground">{label}</div><div className="mt-1 font-semibold text-white">{value}</div></div>; }
