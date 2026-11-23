/**
 * Shared bilingual assistant draft engine. No database writes are performed here.
 * New workflows can register additional handlers without changing speech controls.
 */
const clean = (value) => String(value || "").trim();
const normal = (value) => clean(value).toLowerCase().replace(/[،؛:]/g, " ").replace(/\s+/g, " ");
const startPattern = /(?:container|کنٹینر).{0,35}(?:list|لسٹ|فہرست)|(?:list|لسٹ|فہرست).{0,35}(?:container|کنٹینر)/i;
const endPattern = /^(?:finish|done|complete|ختم|مکمل|بس|لسٹ مکمل)$/i;
const cancelPattern = /^(?:cancel|discard|منسوخ|رد کرو|لسٹ ختم کرو)$/i;
const confirmPattern = /^(?:ok|okay|yes|confirm|approved|ٹھیک ہے|اوکے|تصدیق|ہاں)$/i;
const nextPattern = /^(?:next|next car|another car|اگلی|اگلی گاڑی|دوسری گاڑی|نئی گاڑی)$/i;
const enginePattern = /(?:engine\s*(?:number|no\.?|#)|انجن\s*(?:نمبر|نمبرِ|نمبر:)?)/i;
const chassisPattern = /(?:chassis\s*(?:number|no\.?|#)?|چیسس\s*(?:نمبر)?)/i;
const carPattern = /(?:vehicle|car|گاڑی)\s*(?:name|نام|نمبر)?/i;
const extractAfter = (text, pattern) => {
  const match = pattern.exec(text);
  if (!match) return null;
  const tail = clean(text.slice(match.index + match[0].length).replace(/^[\s:،-]+/, ""));
  return tail || null;
};
const emptyRow = () => ({ vehicle: "", engine_number: "", chassis_number: "" });
export const initialContainerDraft = () => ({ mode: "idle", rows: [], current: emptyRow() });
const hasData = (row) => Object.values(row).some(Boolean);
export const containerDraftPreview = (draft) => {
  const rows = [...draft.rows, ...(hasData(draft.current) ? [draft.current] : [])];
  return rows.map((r, i) => `${i + 1}. ${r.vehicle || "Vehicle —"} | Engine: ${r.engine_number || "—"} | Chassis: ${r.chassis_number || "—"}`).join("\n");
};
export function handleContainerDraft(input, state) {
  const text = clean(input);
  const value = normal(text);
  if (!text) return null;
  if (state.mode === "idle") {
    if (!startPattern.test(text)) return null;
    return { state: { mode: "collecting", rows: [], current: emptyRow() }, reply: "کنٹینر لسٹ شروع ہوگئی۔ گاڑی کا نام، انجن نمبر یا چیسس نمبر بولیں۔ English اور اردو دونوں قبول ہیں۔" };
  }
  if (cancelPattern.test(value)) return { state: initialContainerDraft(), reply: "Draft منسوخ کر دیا گیا۔ کوئی ریکارڈ محفوظ نہیں ہوا۔" };
  if (state.mode === "review") {
    if (confirmPattern.test(value)) return { state: { ...state, mode: "approved" }, reply: "لسٹ منظور ہوگئی، لیکن ابھی database میں محفوظ نہیں ہوئی۔ اصل Container List کے ساتھ محفوظ کرنے کا کنکشن بنانا باقی ہے۔" };
    if (/(?:continue|edit|واپس|تبدیل|مزید)/i.test(value)) return { state: { ...state, mode: "collecting" }, reply: "لسٹ میں مزید تفصیل بولیں۔" };
    return { state, reply: "لسٹ دیکھ کر OK کہیں، مزید اندراج کے لیے Continue، یا Cancel کہیں۔" };
  }
  if (state.mode === "approved") {
    if (startPattern.test(text)) return { state: { mode: "collecting", rows: [], current: emptyRow() }, reply: "نئی کنٹینر لسٹ شروع ہوگئی۔" };
    return { state, reply: "پچھلی لسٹ منظور ہو چکی ہے؛ نئی لسٹ کے لیے Container List بولیں۔" };
  }
  if (endPattern.test(value) || confirmPattern.test(value)) {
    const rows = [...state.rows, ...(hasData(state.current) ? [state.current] : [])];
    if (!rows.length) return { state, reply: "لسٹ ابھی خالی ہے۔ پہلے گاڑی یا انجن نمبر بولیں۔" };
    const draft = { mode: "review", rows, current: emptyRow() };
    return { state: draft, reply: `یہ آپ کی ${rows.length} گاڑیوں کی لسٹ ہے:\n${containerDraftPreview(draft)}\nOK کہنے سے پہلے تفصیل چیک کریں۔` };
  }
  if (nextPattern.test(value)) {
    if (!hasData(state.current)) return { state, reply: "پہلے موجودہ گاڑی کی تفصیل بولیں۔" };
    return { state: { ...state, rows: [...state.rows, state.current], current: emptyRow() }, reply: "اگلی گاڑی کی تفصیل بولیں۔" };
  }
  const engine = extractAfter(text, enginePattern);
  const chassis = extractAfter(text, chassisPattern);
  const car = extractAfter(text, carPattern);
  let field = engine ? "engine_number" : chassis ? "chassis_number" : car ? "vehicle" : null;
  let data = engine || chassis || car;
  if (!field && !hasData(state.current)) { field = "vehicle"; data = text; }
  if (!field) return { state, reply: "بولیں: Engine Number 12345، Chassis Number ABC123، یا Next Car۔" };
  if (data.length > 150) return { state, reply: "تفصیل بہت لمبی ہے؛ مختصر نمبر یا نام دوبارہ بولیں۔" };
  const current = { ...state.current };
  let rows = state.rows;
  if (field === "vehicle" && current.vehicle && hasData(current)) {
    rows = [...rows, current];
    Object.assign(current, emptyRow());
  }
  current[field] = data;
  return { state: { ...state, rows, current }, reply: `${field === "vehicle" ? "گاڑی" : field === "engine_number" ? "انجن نمبر" : "چیسس نمبر"}: ${data} — Draft میں شامل۔ اگلی تفصیل بولیں؛ آخر میں Done کہیں۔` };
}

/** Shared in-memory draft between MAI and external AI; cleared on page reload. */
let sharedContainerDraft = initialContainerDraft();
export function processContainerDraft(input) {
  const outcome = handleContainerDraft(input, sharedContainerDraft);
  if (outcome) sharedContainerDraft = outcome.state;
  return outcome;
}
