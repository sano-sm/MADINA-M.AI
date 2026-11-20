import { useAiPreferences } from "@/components/AiPreferences";
import { TaxId } from "@/components/TradingDocuments";
import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiError } from "@/lib/api";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Empty, Badge } from "@/components/kit";
import { toast } from "sonner";
import { Plus, Trash2, Building2, Users, Shield, Lock, Bot } from "lucide-react";

const TABS = [{ k: "company_profile", icon: Building2 }, { k: "users_roles", icon: Users }, { k: "manage_roles", icon: Shield }, { k: "security", icon: Lock }, { k: "ai_controls", icon: Bot }];

export default function Settings() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "company_profile");
  const manage = can("settings.manage");
  return (
    <div>
      <PageHeader title={t("settings")} />
      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button key={x.k} data-testid={`set-tab-${x.k}`} onClick={() => setTab(x.k)}
            className={`flex items-center gap-2 rounded-sm border px-4 py-2 text-sm font-medium transition-colors ${tab === x.k ? "gold-gradient border-transparent text-black" : "border-border text-gray-300 hover:text-white"}`}>
            <x.icon size={15} />{t(x.k)}
          </button>))}
      </div>
      {tab === "company_profile" && <Company t={t} manage={manage} />}
      {tab === "users_roles" && <UsersTab t={t} manage={manage} />}
      {tab === "manage_roles" && <RolesTab t={t} manage={manage} />}
      {tab === "security" && <SecurityTab t={t} manage={manage} />}
      {tab === "ai_controls" && (manage ? <AiControls /> : <div className="text-sm text-muted-foreground">Owner / settings manager permission required.</div>)}
    </div>
  );
}

function Company({ t, manage }) {
  const { settings, reload } = useSettings();
  const [form, setForm] = useState(null);
  useEffect(() => { if (settings) setForm(settings); }, [settings]);
  if (!form) return null;
  const save = async () => {
    try {
      const { id, ...payload } = form;
      await api.put("/settings", { ...payload, tax_rate: +payload.tax_rate });
      toast.success(t("save")); reload();
    } catch (e) { toast.error(apiError(e)); }
  };
  return (
    <div className="card-surface max-w-3xl rounded-sm p-5">
      <div className="mb-4 flex items-center gap-4">
        <img src={form.logo_url || "/logo.png"} alt="logo" className="h-20 w-20 rounded-sm object-cover" />
        {manage && (
          <label className="cursor-pointer" data-testid="company-logo-upload-label">
            <span className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-2 text-sm text-white hover:border-[var(--gold)]">{t("upload_logo")}</span>
            <input type="file" accept="image/*" className="hidden" data-testid="company-logo-upload"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 1500000) { toast.error("Image too large (max 1.5MB)"); return; }
                const reader = new FileReader();
                reader.onload = () => setForm({ ...form, logo_url: reader.result });
                reader.readAsDataURL(file);
              }} />
          </label>
        )}
      </div>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <Field label={t("name")}><Input data-testid="company-name" value={form.name} disabled={!manage} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={t("phone")}><Input value={form.phone} disabled={!manage} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label={t("email")}><Input value={form.email} disabled={!manage} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label={t("address")}><Input value={form.address} disabled={!manage} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <Field label={t("logo_url")}><Input data-testid="company-logo" value={form.logo_url} disabled={!manage} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} /></Field>
        <Field label={t("tax_rate")}><Input type="number" data-testid="company-tax" value={form.tax_rate} disabled={!manage} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} /></Field>
        <Field label={t("invoice_prefix")}><Input value={form.invoice_prefix} disabled={!manage} onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })} /></Field>
        <Field label={t("currency")}><Input value={form.currency} disabled={!manage} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></Field>
        <Field label={t("currency_symbol")}><Input value={form.currency_symbol} disabled={!manage} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} /></Field>
        <TaxId value={form} onChange={setForm} disabled={!manage} /><Field label={t("bank_details")}><Input data-testid="company-bank" value={form.bank_details || ""} disabled={!manage} onChange={(e) => setForm({ ...form, bank_details: e.target.value })} /></Field>
        <Field label={t("invoice_footer")}><Input data-testid="company-footer" value={form.invoice_footer || ""} disabled={!manage} onChange={(e) => setForm({ ...form, invoice_footer: e.target.value })} /></Field>
      </div>
      {manage && <div className="mt-2 flex justify-end"><Btn data-testid="save-company" onClick={save}>{t("save")}</Btn></div>}
    </div>
  );
}

function UsersTab({ t, manage }) {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(null);
  const load = useCallback(() => { api.get("/users").then((r) => setRows(r.data)); api.get("/roles").then((r) => setRoles(r.data)); }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    try {
      if (form.id) await api.put(`/users/${form.id}`, { name: form.name, role: form.role, active: form.active, password: form.password || undefined });
      else await api.post("/users", form);
      toast.success(t("save")); setForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };
  return (
    <div>
      {manage && <div className="mb-3"><Btn data-testid="add-user-btn" onClick={() => setForm({ name: "", email: "", password: "", role: roles[0]?.name || "Manager" })}><Plus size={16} />{t("add_user")}</Btn></div>}
      <div className="card-surface overflow-x-auto rounded-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-[var(--surface-2)] text-xs uppercase text-muted-foreground"><tr>{[t("name"), t("email"), t("role"), t("active"), ""].map((h, i) => <th key={i} className="p-3 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} data-testid={`user-row-${u.id}`} className="border-b border-border hover:bg-white/5">
              <td className="p-3">{u.name}</td><td className="p-3">{u.email}</td>
              <td className="p-3"><Badge>{u.role}</Badge></td>
              <td className="p-3">{u.active ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>}</td>
              <td className="p-3">{manage && <div className="flex gap-1"><Btn variant="ghost" onClick={() => setForm({ ...u, password: "" })}>{t("edit")}</Btn><Btn variant="ghost" onClick={async () => { if (window.confirm("Delete?")) { try { await api.delete(`/users/${u.id}`); load(); } catch (e) { toast.error(apiError(e)); } } }}><Trash2 size={16} className="text-red-400" /></Btn></div>}</td>
            </tr>))}</tbody>
        </table>
        {rows.length === 0 && <Empty text={t("no_data")} />}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t("edit") : t("add_user")} testid="user-modal">
        {form && (<div>
          <Field label={t("name")}><Input data-testid="user-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          {!form.id && <Field label={t("email")}><Input data-testid="user-email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>}
          <Field label={form.id ? `${t("password")} (optional)` : t("password")}><Input type="password" data-testid="user-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label={t("role")}><Select data-testid="user-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}</Select></Field>
          {form.id && <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />{t("active")}</label>}
          <div className="flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn data-testid="save-user" onClick={save}>{t("save")}</Btn></div>
        </div>)}
      </Modal>
    </div>
  );
}

function RolesTab({ t, manage }) {
  const [roles, setRoles] = useState([]);
  const [perms, setPerms] = useState([]);
  const [form, setForm] = useState(null);
  const load = useCallback(() => { api.get("/roles").then((r) => setRoles(r.data)); api.get("/permissions").then((r) => setPerms(r.data)); }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    try {
      if (form.id) await api.put(`/roles/${form.id}`, { name: form.name, permissions: form.permissions });
      else await api.post("/roles", { name: form.name, permissions: form.permissions });
      toast.success(t("save")); setForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const toggle = (p) => setForm((f) => ({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p] }));
  return (
    <div>
      {manage && <div className="mb-3"><Btn data-testid="add-role-btn" onClick={() => setForm({ name: "", permissions: [] })}><Plus size={16} />{t("add_role")}</Btn></div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((r) => (
          <div key={r.id} data-testid={`role-card-${r.id}`} className="card-surface rounded-sm p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-head font-bold gold-text">{r.name}</span>
              {r.is_system ? <Badge tone="gray">system</Badge> : manage && <div className="flex gap-1"><Btn variant="ghost" onClick={() => setForm(r)}>{t("edit")}</Btn><Btn variant="ghost" onClick={async () => { try { await api.delete(`/roles/${r.id}`); load(); } catch (e) { toast.error(apiError(e)); } }}><Trash2 size={15} className="text-red-400" /></Btn></div>}
            </div>
            <div className="flex flex-wrap gap-1">{r.permissions.map((p) => <span key={p} className="rounded-sm bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">{p}</span>)}</div>
          </div>
        ))}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t("edit") : t("add_role")} testid="role-modal" wide>
        {form && (<div>
          <Field label={t("name")}><Input data-testid="role-name" value={form.name} disabled={form.is_system} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="mb-2 text-xs text-muted-foreground">{t("permissions")}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {perms.map((p) => (
              <label key={p} className="flex items-center gap-2 rounded-sm border border-border p-2 text-xs">
                <input type="checkbox" data-testid={`perm-${p}`} checked={form.permissions.includes(p)} onChange={() => toggle(p)} />{p}
              </label>))}
          </div>
          <div className="mt-3 flex justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn><Btn data-testid="save-role" onClick={save}>{t("save")}</Btn></div>
        </div>)}
      </Modal>
    </div>
  );
}

function SecurityTab({ t, manage }) {
  const { setPin } = useAuth();
  const [pin, setP] = useState("");
  const [confirm, setC] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!/^\d{4}$/.test(pin)) return toast.error(t("pin_rule"));
    if (pin !== confirm) return toast.error(t("pin_mismatch"));
    setSaving(true);
    try { await setPin(pin); toast.success(t("pin_updated")); setP(""); setC(""); }
    catch (e) { toast.error(apiError(e)); } finally { setSaving(false); }
  };
  if (!manage) return <div className="text-sm text-muted-foreground">{t("no_permission")}</div>;
  return (
    <div className="card-surface max-w-md space-y-4 rounded-sm p-5">
      <div className="flex items-center gap-2"><Lock size={16} className="gold-text" /><span className="font-head font-bold gold-text">{t("app_pin")}</span></div>
      <p className="text-sm text-muted-foreground">{t("change_pin_hint")}</p>
      <Field label={t("new_pin")}><Input data-testid="set-new-pin" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setP(e.target.value.replace(/\D/g, ""))} /></Field>
      <Field label={t("confirm_pin")}><Input data-testid="set-confirm-pin" type="password" inputMode="numeric" maxLength={4} value={confirm} onChange={(e) => setC(e.target.value.replace(/\D/g, ""))} /></Field>
      <div className="flex justify-end"><Btn data-testid="save-pin-btn" disabled={saving} onClick={save}>{t("change_pin")}</Btn></div>
    </div>
  );
}

function AiControls() {
  const { prefs, change } = useAiPreferences();
  const controls = [
    ["master", "Master AI", "Hide or show all AI controls"],
    ["agent", "AI — External Agent", "Small AI microphone beside MTC logo; external provider not yet connected"],
    ["voice", "MAI — Madina Assistant", "Small MAI microphone beside MTC logo; local search/navigation"],
    ["camera", "AI Camera", "Small camera beside Owner icon"],
  ];
  return <div className="card-surface max-w-xl rounded-xl p-5">
    <h2 className="mb-2 text-lg font-semibold text-white">AI Controls</h2>
    <p className="mb-4 text-xs text-muted-foreground">MAI supports browser speech recognition for record search and section navigation in Urdu and English. External AI automation, write actions, and automatic camera OCR remain disabled until separately integrated.</p>
    {controls.map(([key, title, desc]) => <label key={key} className="flex items-center justify-between gap-3 border-b border-white/10 py-3">
      <span><span className="block text-sm text-white">{title}</span><span className="text-xs text-muted-foreground">{desc}</span></span>
      <input type="checkbox" data-testid={`ai-toggle-${key}`} checked={prefs[key]} onChange={e => change(key,e.target.checked)} className="h-5 w-5 accent-yellow-500" />
    </label>)}
    <div className="mt-5 rounded-lg border border-white/10 p-3 text-sm text-white"><b>AI Connection</b><p className="mt-2 text-xs text-muted-foreground">Not connected. ChatGPT subscriptions do not provide an API key. A secure server-side integration, provider selection, permission checks and billing safeguards are required. Do not paste an API key into this browser or source code.</p><p className="mt-2 text-xs text-amber-300">MAI search/navigation works independently of an external AI subscription where browser speech recognition is supported.</p></div>
    <AiAgentConnection />
  </div>;
}

function AiAgentConnection() {
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState("");
  const load = useCallback(() => { api.get("/ai-agents").then((response) => setAgents(response.data || [])).catch((error) => setStatus(apiError(error))); }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    if (!form?.name?.trim() || !form?.endpoint_url?.trim()) { setStatus("AI Agent نام اور HTTPS URL درج کریں۔"); return; }
    try {
      const payload = { ...form, name: form.name.trim(), endpoint_url: form.endpoint_url.trim() };
      if (form.id) await api.put(`/ai-agents/${form.id}`, payload); else await api.post("/ai-agents", payload);
      setForm(null); setStatus("AI Agent محفوظ ہو گیا۔"); load();
    } catch (error) { setStatus(apiError(error)); }
  };
  const test = async (agent) => {
    setStatus("Connection چیک ہو رہا ہے…");
    try { const response = await api.post(`/ai-agents/${agent.id}/test`); setStatus(response.data.ok ? "Connection دستیاب ہے۔" : `Connection نے status ${response.data.status || "error"} دیا۔`); }
    catch (error) { setStatus(apiError(error)); }
  };
  const toggle = async (agent) => { try { await api.put(`/ai-agents/${agent.id}`, { enabled: !agent.enabled }); load(); } catch (error) { setStatus(apiError(error)); } };
  const remove = async (agent) => { if (!window.confirm(`${agent.name} حذف کریں؟`)) return; try { await api.delete(`/ai-agents/${agent.id}`); load(); } catch (error) { setStatus(apiError(error)); } };
  return <div className="mt-5 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm text-white">
    <h3 className="font-semibold text-yellow-300">AI Agent Connection</h3>
    <p className="mt-1 text-xs text-muted-foreground">ہر AI Agent کا HTTPS URL، protocol اور server-side auth environment variable یہاں محفوظ کریں۔ ایک سے زیادہ agents شامل کیے جا سکتے ہیں۔</p>
    <div className="my-3 space-y-2">{agents.map((agent) => <div key={agent.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 p-2"><div><b>{agent.name}</b><div className="text-xs text-gray-400">{agent.endpoint_url}</div><span className={agent.enabled ? "text-xs text-emerald-300" : "text-xs text-gray-500"}>{agent.enabled ? "On" : "Off"}</span></div><div className="flex flex-wrap gap-1"><Btn variant="dark" onClick={() => toggle(agent)}>{agent.enabled ? "Off" : "On"}</Btn><Btn variant="dark" onClick={() => test(agent)}>Test</Btn><Btn variant="dark" onClick={() => setForm(agent)}>Edit</Btn><Btn variant="ghost" onClick={() => remove(agent)}>Delete</Btn></div></div>)}</div>
    {form ? <>
      <Field label="AI Agent نام"><Input data-testid="ai-agent-name" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثلاً: My AI Agent" /></Field>
      <Field label="AI Agent HTTPS URL"><Input data-testid="ai-agent-url" value={form.endpoint_url || ""} onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })} placeholder="https://example.com/ai-agent" /></Field>
      <Field label="Auth environment variable"><Input data-testid="ai-agent-auth-env" value={form.auth_env || ""} onChange={(e) => setForm({ ...form, auth_env: e.target.value })} placeholder="مثلاً: OPENAI_API_KEY" /></Field>
      <div className="flex flex-wrap justify-end gap-2"><Btn variant="dark" onClick={() => setForm(null)}>Cancel</Btn><Btn data-testid="save-ai-agent" onClick={save}>Save Agent</Btn></div>
    </> : <Btn data-testid="add-ai-agent" onClick={() => setForm({ name: "", endpoint_url: "", enabled: true, protocol: "generic_json", auth_env: "", capabilities: [] })}>Add AI Agent</Btn>}
    {status && <p role="status" className="mt-2 text-xs text-amber-300">{status}</p>}
  </div>;
}
