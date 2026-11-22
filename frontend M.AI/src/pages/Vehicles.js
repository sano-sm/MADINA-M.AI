import { printWindow } from "@/lib/documentPreview";
import React, { useEffect, useState, useCallback, useRef } from "react";
import { api, apiError } from "@/lib/api";
import NameSuggestInput from "@/components/NameSuggestInput";
import { useI18n } from "@/context/I18nContext";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, Btn, Modal, Field, Input, Select, Empty, Badge, DataTable } from "@/components/kit";
import { toast } from "sonner";
import { Search, Plus, Trash2, Eye, Wrench, DollarSign, Pencil, Printer } from "lucide-react";
import { PurchaseBox } from "@/components/PurchaseBox";

const empty = { chassis_number: "", vehicle_name: "", make: "", model: "", engine_name: "", engine_code: "", engine_number: "", year: "", color: "", mileage: "",
  purchase_price: "", purchase_date: "", supplier: "", notes: "", payment_method: "", purchase_company: "MTC" };

function voiceVehicleFields(text) {
  const value = String(text || "");
  const read = (patterns) => {
    const labels = patterns.join("|");
    const match = value.match(new RegExp(`(?:${labels})\\s*(?:is|ہے|:)?\\s*([^,;|]+?)(?=\\s+(?:name|نام|make|میک|model|ماڈل|chassis|چیسس|engine|انجن|year|سال|color|رنگ|mileage|میلیج|price|قیمت|date|تاریخ|broker|بروکر|supplier|سپلائر)\\b|[,;|]|$)`, "i"));
    return match ? match[1].trim() : "";
  };
  const out = {};
  const name = read(["vehicle name", "car name", "گاڑی کا نام", "گاڑی"]); if (name) out.vehicle_name = name;
  const make = read(["make", "میک"]); if (make) out.make = make;
  const model = read(["model", "ماڈل"]); if (model) out.model = model;
  const chassis = read(["chassis number", "chassis", "چیسس نمبر", "چیسس"]); if (chassis) out.chassis_number = chassis.replace(/\s+/g, "");
  const engine = read(["engine number", "engine", "انجن نمبر", "انجن"]); if (engine) out.engine_number = engine.replace(/\s+/g, "");
  const year = read(["year", "سال"]); if (/^\d{4}$/.test(year)) out.year = year;
  const color = read(["color", "رنگ"]); if (color) out.color = color;
  const mileage = read(["mileage", "میلیج"]); if (mileage) out.mileage = mileage.replace(/[^0-9]/g, "");
  const price = read(["purchase price", "price", "قیمت خرید", "قیمت"]);
  const naturalPrice = value.match(/(?:اتنے کا لیا|اتنے میں لیا|for)\s*(?:is|ہے|:)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i)?.[1] || "";
  if (price || naturalPrice) out.purchase_price = (price || naturalPrice).replace(/[^0-9.]/g, "");
  const date = read(["purchase date", "date", "خریداری کی تاریخ", "تاریخ"]); if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out.purchase_date = date;
  const supplier = read(["broker", "supplier", "بروکر", "سپلائر"]); if (supplier) out.supplier = supplier.replace(/^(کی جگہ|کا نام|name)\s*/i, "").trim();
  return out;
}

export default function Vehicles() {
  const { t } = useI18n();
  const { money } = useSettings();
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const listRequest = useRef(0);
  const [stockGroup, setStockGroup] = useState("in_stock");
  const [q, setQ] = useState("");
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("record");
    if (id) api.get("/vehicles/" + encodeURIComponent(id)).then(r => setDetail(r.data)).catch(e => toast.error(apiError(e)));
  }, []);
  const [gallery, setGallery] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoKind, setPhotoKind] = useState("vehicle");
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const photoUrlsRef = useRef({});
  const photoInputRef = useRef(null);
  const [dismantle, setDismantle] = useState(null);
  const [sellVeh, setSellVeh] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [pendingBV, setPendingBV] = useState([]);
  const [entryYear, setEntryYearState] = useState(() => {
    const saved = Number(localStorage.getItem("mtc_vehicle_entry_year"));
    return saved >= 2000 && saved <= 2100 ? saved : new Date().getFullYear();
  });
  const editable = can("vehicles.edit");

  const [catalogChoices, setCatalogChoices] = useState([]);
  const [catalogHint, setCatalogHint] = useState("");
  const lookupVehicle = async (raw, base) => {
    const value = String(raw || "").trim();
    if (value.length < 3) return;
    try {
      const {data} = await api.get("/vehicle-catalog/search", {params:{q:value}});
      const normalized = x => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const qcode = normalized(value);
      const eligible = data.filter(r => { const code = normalized(r.model_code); return code && (qcode === code || qcode.startsWith(code)); });
      const bestLength = Math.max(0,...eligible.map(r=>normalized(r.model_code).length));
      const best = eligible.filter(r=>normalized(r.model_code).length===bestLength);
      if (!best.length) {setCatalogHint("No catalog match; manual entry remains available.");setCatalogChoices([]);return;}
      const unique = [...new Map(best.map(r=>[`${r.make}|${r.vehicle_name}|${r.model_code}|${r.engine_code}`,r])).values()];
      if (unique.length===1) {applyCatalogChoice(unique[0]);setCatalogChoices([]);setCatalogHint("Model reference matched. Check before saving.");}
      else {setCatalogChoices(unique);setCatalogHint("Multiple model/engine matches — select the correct one.");}
    } catch {setCatalogHint("Catalog lookup unavailable; manual entry remains available.");}
  };
  const applyCatalogChoice = r => {
    setForm(prev => prev ? {...prev, make:prev.make || r.make, vehicle_name:prev.vehicle_name || r.vehicle_name,
      model:prev.model || r.model_code, engine_code:prev.engine_code || r.engine_code} : prev);
    setCatalogChoices([]);
  };
  const openAdd = () => {
    api.get("/broker-vehicles/pending").then((r) => setPendingBV(r.data)).catch(() => setPendingBV([]));
    const today = new Date();
    const md = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    setCatalogChoices([]); setCatalogHint("");
    setForm({ ...empty, purchase_date: `${entryYear}-${md}`, payment_method: "bank", purchase_company: "MTC" });
  };
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("voice") === "new" && editable && !form) openAdd();
    // Voice navigation intentionally opens the normal, permission-checked form; it never bypasses save confirmation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);
  const openEdit = (v) => { setCatalogChoices([]); setCatalogHint(""); setForm({ ...empty, ...v, purchase_date: (v.purchase_date || "").slice(0, 10), payment_method: v.payment_method || "", purchase_company: v.purchase_company || "MTC" }); };
  const setEntryYear = (y) => {
    const n = Number(y);
    if (!Number.isFinite(n) || n < 2000 || n > 2100) return;
    setEntryYearState(n);
    localStorage.setItem("mtc_vehicle_entry_year", String(n));
  };
  const pickPending = (id) => {
    if (!id) { setForm({ ...form, broker_vehicle_id: null }); return; }
    const bv = pendingBV.find((x) => x.id === id);
    if (!bv) return;
    setForm({ ...form, broker_vehicle_id: id, vehicle_name: bv.vehicle_name || form.vehicle_name,
      chassis_number: bv.chassis_number || form.chassis_number, purchase_price: bv.purchase_price || form.purchase_price,
      supplier: bv.broker_name || form.supplier, purchase_date: (bv.purchase_date || form.purchase_date || "").slice(0, 10),
      payment_method: "" });
  };

  const load = useCallback(() => {
    const request = ++listRequest.current;
    api.get("/vehicles", {params: {q, status: stockGroup || undefined}}).then((r) => { if(request === listRequest.current) setRows(r.data); }).catch(() => {});
  }, [q, stockGroup]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {}); }, []);

  const save = async (formOverride = form) => {
    try {
      const payload = { ...formOverride, year: formOverride.year ? +formOverride.year : null,
        mileage: formOverride.mileage ? +formOverride.mileage : null, purchase_price: +formOverride.purchase_price || 0 };
      if (formOverride.id) await api.put(`/vehicles/${formOverride.id}`, payload);
      else await api.post("/vehicles", payload);
      toast.success(t("save")); setForm(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };
  const saveRef = useRef(null);
  saveRef.current = save;
  useEffect(() => {
    const onVoice = (event) => {
      const text = event.detail?.command || "";
      if (!form || !/(vehicle|گاڑی|chassis|چیسس|engine|انجن|model|ماڈل|price|قیمت|broker|بروکر|year|سال)/i.test(text)) return;
      const fields = voiceVehicleFields(text);
      const nextForm = { ...form, ...fields };
      if (Object.keys(fields).length) setForm(nextForm);
      const lookupValue = fields.chassis_number || fields.model;
      if (lookupValue) lookupVehicle(lookupValue, nextForm);
      const spokenSupplier = fields.supplier || "";
      const pending = pendingBV.find((item) => {
        const haystack = `${item.broker_name || ""} ${item.vehicle_name || ""} ${item.chassis_number || ""}`.toLowerCase();
        return spokenSupplier && haystack.includes(spokenSupplier.toLowerCase());
      });
      if (pending) pickPending(pending.id);
      if (/\b(confirm|save|yes|okay|ok)\b|تصدیق|محفوظ|ہاں|ٹھیک ہے/i.test(text)) window.setTimeout(() => saveRef.current?.(nextForm), 0);
    };
    window.addEventListener("mai:voice-command", onVoice);
    return () => window.removeEventListener("mai:voice-command", onVoice);
  }, [form]);

  const del = async (id) => { if (!window.confirm("Delete?")) return;
    await api.delete(`/vehicles/${id}`); toast.success("Deleted"); load(); };

  const openDetail = async (id) => {
    const { data } = await api.get(`/vehicles/${id}`); setDetail(data);
  };

  const clearPhotoUrls = () => {
    Object.values(photoUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    photoUrlsRef.current = {};
    setPhotoUrls({});
  };
  useEffect(() => () => Object.values(photoUrlsRef.current).forEach((url) => URL.revokeObjectURL(url)), []);

  const loadPhotos = async (id) => {
    setPhotoLoading(true);
    try { const { data } = await api.get(`/vehicles/${id}/photos`); setPhotos(data); }
    catch (e) { toast.error(apiError(e)); }
    finally { setPhotoLoading(false); }
  };
  const openPhotos = (v) => {
    clearPhotoUrls(); setPhotos([]); setSelectedPhoto(null); setGallery(v);
    loadPhotos(v.id);
  };
  const closePhotos = () => { setSelectedPhoto(null); setGallery(null); setPhotos([]); clearPhotoUrls(); };
  const fetchPhoto = async (p, full = false) => {
    if (!gallery) return;
    const key = `${p.id}-${full ? "full" : "thumb"}`;
    if (photoUrlsRef.current[key]) return;
    try {
      const { data } = await api.get(`/vehicles/${gallery.id}/photos/${p.id}/image${full ? "" : "?thumb=true"}`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      photoUrlsRef.current[key] = url;
      setPhotoUrls({ ...photoUrlsRef.current });
    } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => {
    if (!gallery) return;
    photos.forEach((p) => { if (!photoUrlsRef.current[`${p.id}-thumb`]) fetchPhoto(p); });
  }, [gallery, photos]);
  const openLargePhoto = (p) => { setSelectedPhoto(p); fetchPhoto(p, true); };

  const compressPhoto = async (file, kind) => {
    const bitmap = await createImageBitmap(file);
    try {
      const maxSide = kind === "chassis" ? 2800 : 1800;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const target = kind === "chassis" ? 1024 * 1024 : 500 * 1024;
      let blob;
      for (const quality of [0.9, 0.82, 0.74, 0.66]) {
        blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (!blob) throw new Error("Image compression failed");
        if (blob.size <= target) break;
      }
      return blob;
    } finally { bitmap.close(); }
  };
  const uploadPhotos = async (files) => {
    if (!gallery || !files.length) return;
    if (photos.length + files.length > 20) { toast.error("Maximum 20 photos per vehicle"); return; }
    setPhotoUploading(true);
    try {
      for (const file of files) {
        const blob = await compressPhoto(file, photoKind);
        await api.post(`/vehicles/${gallery.id}/photos`, blob, {
          headers: { "Content-Type": "image/jpeg", "X-Photo-Type": photoKind },
          timeout: 120000,
        });
      }
      clearPhotoUrls();
      await loadPhotos(gallery.id);
      toast.success("Photos saved");
    } catch (e) { toast.error(apiError(e)); await loadPhotos(gallery.id); }
    finally { setPhotoUploading(false); if (photoInputRef.current) photoInputRef.current.value = ""; }
  };
  const removePhoto = async (p) => {
    if (!gallery || !window.confirm("Delete this photo?")) return;
    try {
      await api.delete(`/vehicles/${gallery.id}/photos/${p.id}`);
      if (selectedPhoto?.id === p.id) setSelectedPhoto(null);
      clearPhotoUrls(); await loadPhotos(gallery.id);
      toast.success("Photo deleted");
    } catch (e) { toast.error(apiError(e)); }
  };

  const recoveryComplete = async (id) => {
    try {
      await api.post(`/vehicles/${id}/recovery-complete`);
      const { data } = await api.get(`/vehicles/${id}`); setDetail(data); load();
      toast.success(t("recovery_completed"));
    } catch (e) { toast.error(apiError(e)); }
  };

  const statusTone = { in_stock: "gold", sold: "green", sold_complete: "green", dismantled: "gray" };
  const statusLabel = (s) => (s === "sold" || s === "sold_complete") ? t("sold_complete") : t(s);

  const sortedRows = [...rows].sort((a, b) => {
    const ad = (a.purchase_date || a.created_at || "9999-12-31").slice(0, 10);
    const bd = (b.purchase_date || b.created_at || "9999-12-31").slice(0, 10);
    return ad.localeCompare(bd) || String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

  const printFiltered = () => {
    if (!sortedRows.length) return;
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    const title = q.trim() ? `${t("vehicles")} · ${q.trim()}` : t("vehicles");
    const body = sortedRows.map((v) => `
      <tr>
        <td>${esc((v.purchase_date || "").slice(0, 10) || "—")}</td>
        <td>${esc(v.vehicle_name || `${v.make || ""} ${v.model || ""}`.trim() || "—")}</td>
        <td>${esc(v.chassis_number || "—")}</td>
        <td>${esc(v.supplier || "—")}</td>
        <td style="text-align:right">${esc(money(v.purchase_price || 0))}</td>
        <td>${esc(v.purchase_company || "MTC")}</td>
        <td>${esc(statusLabel(v.status))}</td>
      </tr>`).join("");
    const w = printWindow();
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{font-size:20px;margin:0 0 6px}.sub{font-size:11px;color:#555;margin-bottom:14px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#f2f2f2}@media print{button{display:none}}</style>
      </head><body><h1>${esc(title)}</h1><div class="sub">${sortedRows.length} ${esc(t("vehicles"))}</div>
      <table><thead><tr><th>${esc(t("date"))}</th><th>${esc(t("vehicle_name"))}</th><th>${esc(t("chassis"))}</th><th>${esc(t("from_label"))}</th><th>${esc(t("purchase_price"))}</th><th>Co.</th><th>${esc(t("status"))}</th></tr></thead><tbody>${body}</tbody></table>
      <script>window.onload=()=>window.print();</script></body></html>`);
    w.document.close();
  };

  const columns = [
    { label: t("date"), render: (v) => (v.purchase_date || "").slice(0, 10) || "—" },
    { label: t("vehicle_name"), render: (v) => v.vehicle_name || `${v.make || ""} ${v.model || ""}`.trim() || "—" },
    { label: t("chassis"), cell: "font-mono text-[var(--gold)]", render: (v) => v.chassis_number },
    { label: t("from_label"), render: (v) => v.supplier || "—" },
    { label: t("purchase_price"), align: "end", render: (v) => money(v.purchase_price) },
    { label: t("status"), render: (v) => <Badge tone={statusTone[v.status]}>{statusLabel(v.status)}</Badge> },
    { label: "", render: (v) => <span title="Purchase company" className="inline-flex min-w-[34px] justify-center rounded border border-[var(--gold)]/35 bg-[var(--gold)]/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[var(--gold)]">{v.purchase_company || "MTC"}</span> },
    { label: t("action"), action: true, render: (v) => (
      <div className="flex items-center gap-1">
        <Btn variant="ghost" data-testid={`view-vehicle-${v.id}`} onClick={() => openDetail(v.id)}><Eye size={16} /></Btn>
        {editable && <Btn variant="ghost" data-testid={`edit-vehicle-${v.id}`} onClick={() => openEdit(v)}><Pencil size={16} className="text-sky-300" /></Btn>}
        {editable && v.status === "in_stock" &&
          <Btn variant="ghost" data-testid={`sell-vehicle-${v.id}`}
            onClick={() => setSellVeh({ id: v.id, chassis: v.chassis_number, sale_date: new Date().toISOString().slice(0, 10), customer_id: "", sale_price: "", amount_received: "", method: "bank" })}>
            <DollarSign size={16} className="text-emerald-400" /></Btn>}
        {editable && v.status === "in_stock" &&
          <Btn variant="ghost" data-testid={`dismantle-btn-${v.id}`}
            onClick={() => setDismantle({ vehicle: v, dismantle_date: new Date().toISOString().slice(0, 10), scrap_amount: "", shokubai_with_engine: null })}>
            <Wrench size={16} className="text-[var(--gold)]" /></Btn>}
        {editable && <Btn variant="ghost" onClick={() => del(v.id)}><Trash2 size={16} className="text-red-400" /></Btn>}
      </div>) },
  ];

  return (
    <div>
      <PageHeader title={t("vehicles")} actions={editable &&
        <Btn data-testid="add-vehicle-btn" onClick={openAdd}><Plus size={16} />{t("add_vehicle")}</Btn>} />

      <PurchaseBox kind="vehicles" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[280px] max-w-md flex-1 items-center gap-2 card-surface rounded-sm px-3 py-2">
          <Search size={16} className="text-muted-foreground" />
          <input data-testid="vehicle-search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t("search_chassis")} className="w-full bg-transparent text-sm text-white outline-none" />
        </div>
        {[["in_stock","Stock Vehicles"],["dismantled","Dismantled Vehicles"],["","All"]].map(([value,label]) => <Btn key={label} variant={stockGroup === value ? undefined : "dark"} onClick={() => setStockGroup(value)}>{label}</Btn>)}
        <Btn variant="dark" onClick={printFiltered} disabled={!sortedRows.length}><Printer size={16} />{t("print_pdf_list")}</Btn>
      </div>

      <DataTable columns={columns} rows={sortedRows} rowKey={(v) => v.id} rowTestId={(v) => `vehicle-row-${v.id}`} empty={t("no_data")} />

      {/* Add/Edit */}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t("edit") : t("add_vehicle")} testid="vehicle-modal" wide>
        {form && (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Company</span>
              {["MTC", "TSK"].map((code) => (
                <button key={code} type="button" data-testid={`v-company-${code.toLowerCase()}`}
                  onClick={() => setForm({ ...form, purchase_company: code })}
                  className={`rounded border px-2.5 py-1 text-xs font-bold ${((form.purchase_company || "MTC") === code) ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]" : "border-border text-muted-foreground"}`}>
                  {((form.purchase_company || "MTC") === code) ? "✓ " : ""}{code}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              <VehiclePurchaseDateField t={t} value={form.purchase_date || ""} entryYear={entryYear} persistYear={!form.id}
                onYearChange={setEntryYear} onChange={(purchase_date) => setForm({ ...form, purchase_date })} />
              <Field label={t("vehicle_name")}><NameSuggestInput kind="vehicle" data-testid="v-name" value={form.vehicle_name} onChange={(e) => setForm({ ...form, vehicle_name: e.target.value })} /></Field>
              <Field label={t("chassis")}><Input data-testid="v-chassis" value={form.chassis_number} onChange={(e) => setForm({ ...form, chassis_number: e.target.value })} onBlur={(e) => lookupVehicle(e.target.value, form)} /></Field>
              <Field label={t("from_label")}><NameSuggestInput kind="supplier" data-testid="v-from" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
              <Field label={t("purchase_price")}><Input type="number" data-testid="v-price" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} /></Field>
              <Field label={t("payment_method")}><Select value={form.payment_method || ""} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} disabled={!!form.broker_vehicle_id}><option value="">{t("not_recorded")}</option><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>
            </div>
            {!form.id && pendingBV.length > 0 && (
              <Field label={t("link_broker_vehicle")}>
                <select data-testid="v-broker-link" value={form.broker_vehicle_id || ""} onChange={(e) => pickPending(e.target.value)}
                  className="w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none">
                  <option value="">—</option>
                  {pendingBV.map((b) => <option key={b.id} value={b.id}>{b.broker_name}: {b.vehicle_name} ({money(b.purchase_price)})</option>)}
                </select>
              </Field>
            )}
            <details className="mt-1 rounded-sm border border-border p-3">
              <summary className="cursor-pointer text-sm text-[var(--gold)]" data-testid="v-more-details">{t("more_details")}</summary>
              <div className="mt-3 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <Field label={t("make")}><NameSuggestInput kind="make" data-testid="v-make" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} /></Field>
                <Field label={t("model")}><NameSuggestInput kind="model" data-testid="v-model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} onBlur={(e) => lookupVehicle(e.target.value, form)} /></Field>
                <Field label={t("engine_name")}><NameSuggestInput kind="engine" data-testid="v-engine-name" value={form.engine_name} onChange={(e) => setForm({ ...form, engine_name: e.target.value })} /></Field>
                <Field label={t("engine_code")}><Input data-testid="v-engine-code" value={form.engine_code} onChange={(e) => setForm({ ...form, engine_code: e.target.value })} /></Field>
                <Field label={t("engine_number")}><Input data-testid="v-engine-number" value={form.engine_number} onChange={(e) => setForm({ ...form, engine_number: e.target.value })} /></Field>
                <Field label={t("year")}><Input type="number" data-testid="v-year" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></Field>
                <Field label={t("color")}><Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
                <Field label={t("mileage")}><Input type="number" value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value })} /></Field>
                <Field label={t("notes")}><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              </div>
            </details>
            {catalogHint && <p className="mt-2 text-xs text-amber-300">{catalogHint}</p>}
            {catalogChoices.length>0 && <div className="mt-2 rounded-lg border border-white/20 p-3"><p className="mb-2 text-xs">Choose correct vehicle and engine (reference only):</p>{catalogChoices.map((r,i)=><button key={i} type="button" onClick={()=>applyCatalogChoice(r)} className="mb-1 block w-full rounded border border-white/10 p-2 text-left text-sm hover:bg-white/10">{r.make} {r.vehicle_name} · {r.model_code} · {r.engine_code}</button>)}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <Btn variant="dark" onClick={() => setForm(null)}>{t("cancel")}</Btn>
              <Btn data-testid="save-vehicle" onClick={save}>{t("save")}</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Detail */}
      <Modal open={!!detail} onClose={() => { if (!gallery) setDetail(null); }} title={detail ? <span className="flex w-full items-center justify-between gap-4"><span>{detail.chassis_number}</span><button type="button" className="font-inherit text-[var(--gold)] hover:underline" onClick={() => openPhotos(detail)}>Photos</button></span> : ""} testid="vehicle-detail" wide>
        {detail && (
          <div>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Info l={t("make")} v={detail.make} /><Info l={t("model")} v={detail.model} />
              <Info l={t("year")} v={detail.year} /><Info l={t("color")} v={detail.color} />
              <Info l={t("purchase_price")} v={money(detail.purchase_price)} />
              <Info l="Company" v={detail.purchase_company || "MTC"} />
              <Info l={t("status")} v={statusLabel(detail.status)} />
              {(detail.status === "sold" || detail.status === "sold_complete") && <Info l={t("sale_price")} v={money(detail.sale_price)} />}
              {(detail.status === "sold" || detail.status === "sold_complete") && (
                <div>
                  <div className="text-xs text-muted-foreground">{t("profit_loss")}</div>
                  <div data-testid="vehicle-profit-loss" className={(Number(detail.sale_price || 0) - Number(detail.purchase_price || 0)) >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {money(Number(detail.sale_price || 0) - Number(detail.purchase_price || 0))}
                  </div>
                </div>
              )}
            </div>
            {detail.sale_summary && (
              <div className="mt-5 rounded-sm border border-emerald-500/30 bg-emerald-500/5 p-3" data-testid="sale-summary-panel">
                <h4 className="mb-2 font-head font-bold text-emerald-400">{t("complete_sale")}</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  <Info l={t("purchase_price")} v={money(detail.sale_summary.purchase_price)} />
                  <Info l={t("sale_price")} v={money(detail.sale_summary.sale_price)} />
                  <Info l={t("sold_to")} v={detail.sale_summary.sold_to} />
                  <Info l={t("sale_date")} v={(detail.sale_summary.sale_date || "").slice(0, 10)} />
                  <Info l={t("amount_received")} v={money(detail.sale_summary.amount_received)} />
                  <Info l={t("balance_due")} v={money(detail.sale_summary.balance_due)} />
                </div>
                <div className="mt-3 border-t border-emerald-500/20 pt-3 text-sm">
                  <span data-testid="sale-summary-pl">{t("recovery_pl")}: <b className={detail.sale_summary.profit_loss >= 0 ? "text-emerald-400" : "text-red-400"}>{money(detail.sale_summary.profit_loss)}</b></span>
                </div>
              </div>
            )}
            {detail.recovery && (
              <div className="mt-5 rounded-sm border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-3" data-testid="recovery-panel">
                <h4 className="mb-2 font-head font-bold gold-text">{t("recovery")}</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  <Info l={t("purchase_price")} v={money(detail.recovery.purchase_price)} />
                  <Info l={t("engine")} v={money(detail.recovery.engine.total)} />
                  <Info l={t("half_cut")} v={money(detail.recovery.half_cut.total)} />
                  <Info l={t("parts")} v={money((detail.recovery.parts && detail.recovery.parts.total) || 0)} />
                  <Info l={t("scrap")} v={money(detail.recovery.scrap.total)} />
                  <Info l={t("shokubai")} v={money(detail.recovery.shokubai.total)} />
                  {detail.recovery.complete_sale > 0 && <Info l={t("complete_sale")} v={money(detail.recovery.complete_sale)} />}
                </div>
                <div className="mt-3 flex flex-wrap gap-4 border-t border-[var(--gold)]/20 pt-3 text-sm">
                  <span data-testid="recovery-total">{t("total_recovered")}: <b className="gold-text">{money(detail.recovery.total_recovered)}</b></span>
                  <span data-testid="recovery-pl">{t("recovery_pl")}: <b className={detail.recovery.profit_loss >= 0 ? "text-emerald-400" : "text-red-400"}>{money(detail.recovery.profit_loss)}</b></span>
                  <span>{t("remaining_recover")}: <b className="text-red-400">{money(detail.recovery.remaining_to_recover)}</b></span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {detail.recovery.recovery_status === "completed"
                    ? <Badge tone="green" data-testid="recovery-completed-badge">{t("recovery_completed")}</Badge>
                    : (can("vehicles.edit") &&
                        <Btn variant="dark" data-testid="recovery-complete-btn" onClick={() => recoveryComplete(detail.id)}>
                          {t("recovery_completed")} / {t("all_parts_sold")}
                        </Btn>)}
                </div>
              </div>
            )}
            <h4 className="mb-2 mt-5 font-head font-bold gold-text">{t("derived_parts")}</h4>
            {detail.derived_parts.length ? detail.derived_parts.map((p) => (
              <div key={p.id} className="flex justify-between border-b border-border py-1.5 text-sm">
                <span>{p.name} ({p.quantity})</span><span className="text-muted-foreground">{money(p.unit_cost)}</span>
              </div>)) : <div className="text-sm text-muted-foreground">{t("no_data")}</div>}
            <h4 className="mb-2 mt-5 font-head font-bold gold-text">{t("vehicle_history")}</h4>
            {detail.history.map((h) => (
              <div key={h.id} className="border-b border-border py-1.5 text-xs">
                <span className="gold-text">{h.action}</span> · {h.details} <span className="text-muted-foreground">({h.timestamp.slice(0, 16).replace("T", " ")})</span>
              </div>))}
          </div>
        )}
      </Modal>

      {/* Photos gallery: loads only after Photos is clicked. */}
      {gallery && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-3" role="dialog" aria-modal="true" aria-label="Vehicle photos">
        <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded border border-border bg-[var(--surface-2)] p-4 text-white">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="font-mono text-[var(--gold)]">{gallery.chassis_number} · Photos</div>
            <button type="button" className="px-3 py-1 text-xl" aria-label="Close photos" onClick={closePhotos}>×</button>
          </div>
          {selectedPhoto ? <div>
            <button type="button" className="mb-3 text-[var(--gold)]" onClick={() => setSelectedPhoto(null)}>← Back to photos</button>
            {photoUrls[`${selectedPhoto.id}-full`] ?
              <div className="max-h-[72vh] overflow-auto rounded bg-black text-center" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
                <img src={photoUrls[`${selectedPhoto.id}-full`]} alt="Vehicle photo enlarged" className="mx-auto max-h-[70vh] max-w-full object-contain" onClick={(e) => { e.currentTarget.classList.toggle("max-w-full"); e.currentTarget.classList.toggle("max-w-none"); }} />
              </div> : <div>Loading photo...</div>}
            <p className="mt-2 text-xs text-muted-foreground">Tap image to toggle full resolution; use browser zoom to inspect details.</p>
          </div> : <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {editable && <>
                <select aria-label="Photo type" value={photoKind} onChange={(e) => setPhotoKind(e.target.value)} className="rounded border border-border bg-[var(--surface-2)] p-2 text-sm">
                  <option value="vehicle">Vehicle</option><option value="chassis">Chassis Number</option><option value="additional">Additional</option>
                </select>
                <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadPhotos(Array.from(e.target.files || []))} />
                <button type="button" disabled={photoUploading || photos.length >= 20} onClick={() => photoInputRef.current?.click()} className="rounded border border-[var(--gold)] px-3 py-2 text-sm text-[var(--gold)] disabled:opacity-50">{photoUploading ? "Uploading..." : "+ Add Photos"}</button>
              </>}
              <span className="text-xs text-muted-foreground">{photos.length} photo(s)</span>
            </div>
            {photoLoading ? <p>Loading photos...</p> : photos.length === 0 ? <p className="text-sm text-muted-foreground">No photos uploaded yet.</p> :
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {photos.map((p) => <div key={p.id} className="rounded border border-border p-1">
                  <button type="button" onClick={() => openLargePhoto(p)} className="block w-full" aria-label="Open photo">
                    {photoUrls[`${p.id}-thumb`] ? <img src={photoUrls[`${p.id}-thumb`]} alt={p.kind} className="h-28 w-full rounded object-cover" /> : <div className="flex h-28 items-center justify-center text-xs">Loading...</div>}
                  </button>
                  <div className="mt-1 flex items-center justify-between gap-1 text-xs"><span className="capitalize">{p.kind}</span>{editable && <button type="button" className="text-red-400" onClick={() => removePhoto(p)}>Delete</button>}</div>
                </div>)}
              </div>}
          </div>}
        </div>
      </div>}

      {/* Dismantle */}
      <Modal open={!!dismantle} onClose={() => setDismantle(null)} title={t("dismantle_vehicle")} testid="dismantle-modal">
        {dismantle && (
          <div>
            <p className="mb-4 rounded-sm bg-[var(--gold)]/10 p-3 text-sm text-[var(--gold)]">{t("dismantle_note")}</p>
            <div className="mb-3 text-sm text-muted-foreground">{dismantle.vehicle.vehicle_name || `${dismantle.vehicle.make || ""} ${dismantle.vehicle.model || ""}`.trim()} · {dismantle.vehicle.chassis_number} · {money(dismantle.vehicle.purchase_price)}</div>
            <Field label={t("dismantle_date")}><Input type="date" data-testid="dismantle-date" value={dismantle.dismantle_date} onChange={(e) => setDismantle({ ...dismantle, dismantle_date: e.target.value })} /></Field>
            <Field label="Scrap Amount (optional)"><Input type="number" min="0" value={dismantle.scrap_amount} onChange={(e) => setDismantle({ ...dismantle, scrap_amount: e.target.value })} /></Field>
            <div className="-mt-2 mb-3 text-xs text-muted-foreground" dir="rtl">اگر یہ گاڑی چھوٹی یا ہلکی ہے اور آپ کو اس کے اسکریپ کی تقریباً رقم معلوم ہے تو یہاں درج کریں۔ رقم معلوم نہ ہو تو خالی چھوڑ دیں۔</div>
            <div className="mb-3">
              <div className="mb-2 text-sm font-medium text-white" dir="rtl">شوکوبائی انجن کے ساتھ گیا؟</div>
              <div className="flex gap-2">{[[true,"YES"],[false,"NO"]].map(([v,l]) => <button key={l} type="button" onClick={() => setDismantle({...dismantle, shokubai_with_engine:v})} className={`rounded-sm border px-5 py-2 text-sm font-bold ${dismantle.shokubai_with_engine===v ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]" : "border-border text-white"}`}>{dismantle.shokubai_with_engine===v ? "✓ " : ""}{l}</button>)}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn variant="dark" onClick={() => setDismantle(null)}>{t("cancel")}</Btn>
              <Btn disabled={!dismantle.dismantle_date || dismantle.shokubai_with_engine === null} data-testid="confirm-dismantle" onClick={async () => {
                try {
                  await api.post(`/vehicles/${dismantle.vehicle.id}/dismantle`, {
                    parts: [], dismantle_date: dismantle.dismantle_date,
                    scrap_amount: dismantle.scrap_amount === "" ? null : +dismantle.scrap_amount,
                    shokubai_with_engine: dismantle.shokubai_with_engine,
                    create_engine: true, create_half_cut: false });
                  toast.success(t("dismantle")); setDismantle(null); load();
                } catch (e) { toast.error(apiError(e)); }
              }}>{t("confirm_dismantle")}</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!sellVeh} onClose={() => setSellVeh(null)} title={t("sell_complete")} testid="sell-vehicle-modal">
        {sellVeh && (
          <div>
            <div className="mb-3 font-mono text-sm gold-text">{sellVeh.chassis}</div>
            <Field label={t("date")}><Input type="date" value={sellVeh.sale_date} onChange={(e) => setSellVeh({ ...sellVeh, sale_date: e.target.value })} /></Field>
            <Field label={t("to_label")}>
              <select data-testid="sellveh-customer" value={sellVeh.customer_id} onChange={(e) => setSellVeh({ ...sellVeh, customer_id: e.target.value })}
                className="w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--gold)]">
                <option value="">—</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label={t("sale_price")}><Input type="number" data-testid="sellveh-price" value={sellVeh.sale_price} onChange={(e) => setSellVeh({ ...sellVeh, sale_price: e.target.value })} /></Field>
            <Field label={t("amount_received")}><Input type="number" data-testid="sellveh-received" value={sellVeh.amount_received} onChange={(e) => setSellVeh({ ...sellVeh, amount_received: e.target.value })} /></Field>
            <Field label={t("payment_method")}><Select value={sellVeh.method || "bank"} onChange={(e) => setSellVeh({ ...sellVeh, method: e.target.value })} disabled={(+sellVeh.amount_received || 0) <= 0}><option value="cash">{t("cash")}</option><option value="bank">{t("bank")}</option></Select></Field>
            <div className="mt-2 flex justify-end gap-2">
              <Btn variant="dark" onClick={() => setSellVeh(null)}>{t("cancel")}</Btn>
              <Btn data-testid="confirm-sell-vehicle" onClick={async () => {
                try {
                  await api.post(`/vehicles/${sellVeh.id}/sell`, { sale_date: sellVeh.sale_date, customer_id: sellVeh.customer_id, sale_price: +sellVeh.sale_price || 0, amount_received: +sellVeh.amount_received || 0, method: (+sellVeh.amount_received || 0) > 0 ? sellVeh.method : null });
                  toast.success(t("sell_complete")); setSellVeh(null); load();
                } catch (e) { toast.error(apiError(e)); }
              }}>{t("save")}</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function upd(state, set, i, key, val) {
  const parts = [...state.parts]; parts[i] = { ...parts[i], [key]: val }; set({ ...state, parts });
}
function Info({ l, v }) {
  return <div><div className="text-xs text-muted-foreground">{l}</div><div className="text-white">{v || "—"}</div></div>;
}

function VehiclePurchaseDateField({ t, value, entryYear, persistYear, onYearChange, onChange }) {
  const parts = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value || "");
  const year = parts ? Number(parts[1]) : entryYear;
  const month = parts ? Number(parts[2]) : new Date().getMonth() + 1;
  const day = parts ? Number(parts[3]) : new Date().getDate();
  const maxDay = new Date(year, month, 0).getDate();
  const emit = (y, m, d) => {
    const safeDay = Math.min(Number(d), new Date(Number(y), Number(m), 0).getDate());
    onChange(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`);
  };
  return (
    <Field label={t("purchase_date")}>
      <div className="grid grid-cols-3 gap-2" data-testid="v-date">
        <Input type="number" min="2000" max="2100" aria-label={t("year")} value={year}
          onChange={(e) => { const y = Number(e.target.value); if (y >= 2000 && y <= 2100) { if (persistYear) onYearChange(y); emit(y, month, day); } }} />
        <Select aria-label={t("month")} value={month} onChange={(e) => emit(year, Number(e.target.value), day)}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
        </Select>
        <Select aria-label={t("date")} value={Math.min(day, maxDay)} onChange={(e) => emit(year, month, Number(e.target.value))}>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{String(d).padStart(2, "0")}</option>)}
        </Select>
      </div>
    </Field>
  );
}
