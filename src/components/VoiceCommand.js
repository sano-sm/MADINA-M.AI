import React, { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Search, X } from "lucide-react";
import { SearchRecords } from "./TradingDocuments";
import { api } from "@/lib/api";
import { listPageControls, planPageAction } from "@/lib/maiPageActions";

const destinations = [
  { path: "/brokers", words: ["broker", "brokers", "بروکر"] },
  { path: "/customers", words: ["customer", "customers", "کسٹمر", "گاہک"] },
  { path: "/vehicles", words: ["vehicle", "vehicles", "گاڑی", "گاڑیاں", "car"] },
  { path: "/parts", words: ["spare part", "spare parts", "inventory", "پارٹس", "پرزے"] },
  { path: "/recovery", words: ["parts sale", "parts sales", "پارٹس سیل"] },
  { path: "/vehicle-sales", words: ["vehicle sale", "گاڑی فروخت"] },
  { path: "/purchases", words: ["purchase", "خریداری"] },
  { path: "/loans", words: ["loan", "udhaar", "قرض", "ادھار"] },
  { path: "/summary", words: ["summary", "خلاصہ"] },
  { path: "/expenses", words: ["expense", "اخراجات"] },
  { path: "/container", words: ["container", "کنٹینر"] },
  { path: "/settings", words: ["setting", "سیٹنگ"] },
  { path: "/", words: ["home", "launcher", "ہوم"] },
  { path: "/dashboard", words: ["dashboard", "ڈیش بورڈ"] },
  { path: "/funds", words: ["funds", "فنڈز"] },
  { path: "/owner", words: ["owner", "اونر"] },
  { path: "/reports", words: ["report", "reports", "رپورٹ"] },
  { path: "/audit", words: ["audit", "آڈٹ"] },
  { path: "/alerts", words: ["alert", "alerts", "الرٹ"] },
  { path: "/allocations", words: ["allocation", "allocations", "الاٹمنٹ"] },
  { path: "/stock", words: ["stock", "اسٹاک"] },
];
const searchWords = /search|find|show|open|دکھا|تلاش|ڈھونڈ|نکال|دیکھو|کھولو|record|ریکارڈ/i;

export default function VoiceCommand({ kind, navigate, onClose }) {
  const [active, setActive] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("idle");
  const [search, setSearch] = useState(null);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(null);
  const recognition = useRef(null);
  const keepListening = useRef(false);
  const restartTimer = useRef(null);
  const language = useMemo(() => (document.documentElement.lang === "en" ? "en-US" : "ur-PK"), []);

  const stop = () => {
    keepListening.current = false;
    window.clearTimeout(restartTimer.current);
    try { recognition.current?.stop(); } catch (e) { /* already stopped */ }
    recognition.current = null;
    setActive(false);
    setStatus("idle");
  };

  useEffect(() => () => {
    keepListening.current = false;
    window.clearTimeout(restartTimer.current);
    try { recognition.current?.abort(); } catch (e) { /* component is closing */ }
  }, []);

  const runCommand = async (rawText) => {
    const query = rawText.trim();
    if (!query) return;
    setHistory((items) => [...items.slice(-4), query]);
    setNotice("");
    if (pending && /^(ok|confirm|yes|ٹھیک|ہاں|اوکے)$/i.test(query)) {
      try { pending.action(); setNotice("Confirmed. Action performed on the current page."); }
      catch (e) { setError(`Action failed: ${e.message}`); }
      setPending(null);
      return;
    }
    if (pending && /^(cancel|no|نہیں|منسوخ)$/i.test(query)) { setPending(null); setNotice("Cancelled."); return; }
    if (pending) setPending(null);
    if (/^(what can i do|list fields|list buttons|page controls|کیا کر سکتے|خانے بتاؤ|بٹن بتاؤ)/i.test(query)) {
      const items = listPageControls();
      setNotice(items.length ? items.slice(0, 30).map(x => `${x.index}. ${x.type}: ${x.label}`).join("\n") : "No accessible page controls found.");
      return;
    }
    const pageAction = kind === "voice" ? planPageAction(query) : null;
    if (pageAction) {
      if (pageAction.immediate) pageAction.immediate();
      else if (pageAction.action) setPending(pageAction);
      else setNotice(pageAction.message);
      return;
    }
    // Navigation is read-only. Voice never triggers a save/delete/payment action.
    // Access to a destination is still enforced by the existing protected routes.
    const lower = query.toLowerCase();
    const destination = destinations.find((item) => item.words.some((word) => lower.includes(word.toLowerCase())));
    const navigationRequest = /open|go to|navigate|کھولو|جاؤ|کھول|اوپن/i.test(query);
    if (navigationRequest && destination) {
      navigate(destination.path);
      setNotice(`Opened ${destination.path}. Search or edit using the existing page controls.`);
      if (searchWords.test(query) && /search|find|تلاش|ڈھونڈ/i.test(query)) setSearch(query);
      return;
    }
    if (kind === "agent") {
      setNotice("External AI connection is configured in Settings; this microphone is not yet linked to a verified agent. No changes were made.");
      return;
    }
    window.dispatchEvent(new CustomEvent("mai:voice-command", { detail: { command: query, source: kind } }));
    try {
      const response = await api.post("/mai/command", { command: query, context: { source: kind } });
      const data = response.data || {};
      if (data.navigate_to) navigate(data.navigate_to);
      if (data.action === "search" || data.results?.length) setSearch(query);
      return;
    } catch (error) {
      // Local fallback keeps MAI useful when the backend is temporarily unavailable.
    }
    if (searchWords.test(lower)) { setSearch(query); return; }
    if (destination) { navigate(destination.path); return; }
    setSearch(query);
  };

  const start = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError(language === "en" ? "Voice recognition is not supported here. Type your search below, or try Chrome on Android/desktop." : "اس براوزر میں وائس ریکگنیشن دستیاب نہیں۔ نیچے تلاش لکھیں، یا Chrome Android/desktop پر آزمائیں۔");
      setStatus("unsupported");
      return;
    }
    keepListening.current = true;
    setError("");
    setStatus("starting");
    const r = new Recognition();
    recognition.current = r;
    r.lang = language;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => { setActive(true); setStatus("listening"); };
    r.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          setTranscript(text);
          runCommand(text);
        } else interim += `${text} `;
      }
      if (interim.trim()) setTranscript(interim.trim());
    };
    r.onerror = (event) => {
      if (event.error === "no-speech" && keepListening.current) return;
      const messages = {
        "not-allowed": language === "en" ? "Microphone permission was denied. Allow microphone access and try again." : "مائیکروفون کی اجازت نہیں ملی۔ اجازت دے کر دوبارہ کوشش کریں۔",
        "audio-capture": language === "en" ? "No microphone was found on this device." : "اس ڈیوائس پر مائیکروفون نہیں ملا۔",
      };
      setError(messages[event.error] || `${language === "en" ? "Microphone" : "مائیکروفون"}: ${event.error}`);
      setActive(false);
      setStatus("error");
      keepListening.current = false;
    };
    r.onend = () => {
      recognition.current = null;
      if (keepListening.current) {
        restartTimer.current = window.setTimeout(start, 250);
      } else {
        setActive(false);
        setStatus("idle");
      }
    };
    try { r.start(); } catch (e) {
      setError(language === "en" ? "Could not start the microphone. Try again." : "مائیکروفون شروع نہیں ہو سکا۔ دوبارہ کوشش کریں۔");
      setActive(false);
      setStatus("error");
      keepListening.current = false;
    }
  };

  const toggleListening = () => { if (active || keepListening.current) stop(); else start(); };
  const submitTyped = () => { const value = transcript.trim(); if (value) runCommand(value); };
  const listeningLabel = status === "starting" ? (language === "en" ? "Starting microphone…" : "مائیکروفون شروع ہو رہا ہے…") : active ? (language === "en" ? "Listening…" : "سن رہا ہے…") : (language === "en" ? "Tap microphone to start" : "شروع کرنے کے لیے مائیکروفون دبائیں");

  return <>
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/70 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-yellow-500/30 bg-[#19191c] p-4 text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><b>{kind === "agent" ? "AI — External Agent" : "MAI — Madina Assistant"}</b><button type="button" aria-label="Close" onClick={() => { stop(); onClose(); }}><X size={18} /></button></div>
        <p className="mb-3 text-xs text-gray-400">{language === "en" ? "Press the microphone to start. Speak one command after another. Press it again to stop; while stopped, nothing is heard." : "مائیک دبانے سے شروع کریں۔ ایک کے بعد دوسرا کام بولیں۔ دوبارہ دبانے سے بند ہو جائے گا؛ بند حالت میں کچھ نہیں سنا جائے گا۔"}</p>
        <div className="flex items-center gap-3">
          <button type="button" aria-label={active ? "Stop listening" : "Start listening"} onClick={toggleListening} className={`rounded-full border p-3 transition-all ${active ? "border-emerald-300 bg-emerald-600 text-white animate-pulse shadow-[0_0_22px_rgba(52,211,153,.7)]" : "border-yellow-500/60 bg-[#262329] text-yellow-400"}`}>{active ? <Mic size={22} /> : <MicOff size={22} />}</button>
          <span className="text-sm" aria-live="polite">{listeningLabel}</span>
        </div>
        <textarea aria-label="Voice command text" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={language === "en" ? "For example: open customers and search Ahmad" : "مثلاً: کسٹمر کھولو اور احمد تلاش کرو"} className="mt-3 min-h-20 w-full rounded-lg border border-white/20 bg-black/30 p-3 text-sm text-white" />
        {notice && <p role="status" className="mt-2 whitespace-pre-wrap max-h-40 overflow-y-auto text-xs text-emerald-300">{notice}</p>}
        {pending && <div className="mt-3 rounded-lg border border-amber-500/40 p-3 text-sm"><p>{pending.message}</p><div className="mt-2 flex gap-2"><button type="button" className="rounded bg-emerald-700 px-3 py-1" onClick={() => { try { pending.action(); setNotice("Confirmed. Action performed."); } catch (e) { setError(e.message); } setPending(null); }}>OK</button><button type="button" className="rounded bg-gray-700 px-3 py-1" onClick={() => setPending(null)}>Cancel</button></div></div>}
        {error && <p role="alert" className="mt-2 text-xs text-amber-400">{error}</p>}
        {history.length > 0 && <div className="mt-3 rounded-lg border border-white/10 p-2 text-xs text-gray-300"><div className="mb-1 text-gray-500">Recent commands</div>{history.map((item, index) => <div key={`${item}-${index}`}>• {item}</div>)}</div>}
        <button type="button" onClick={submitTyped} disabled={!transcript.trim()} className="mt-3 flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"><Search size={16} />{language === "en" ? "Run command" : "کمانڈ چلائیں"}</button>
      </div>
    </div>
    {search !== null && <SearchRecords initialQuery={search} close={() => setSearch(null)} navigate={navigate} />}
  </>;
}
