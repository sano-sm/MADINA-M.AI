import React, { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Search, X } from "lucide-react";
import { SearchRecords } from "./TradingDocuments";
import { api } from "@/lib/api";

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
];
const searchWords = /search|find|show|open|دکھا|تلاش|ڈھونڈ|نکال|دیکھو|کھولو|record|ریکارڈ/i;

export default function VoiceCommand({ kind, navigate, onClose }) {
  const [active, setActive] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("idle");
  const [search, setSearch] = useState(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const recognition = useRef(null);
  const keepListening = useRef(false);
  const restartTimer = useRef(null);
  const session = useRef(0);
  const language = useMemo(() => (document.documentElement.lang === "en" ? "en-US" : "ur-PK"), []);

  const stop = () => {
    keepListening.current = false;
    session.current += 1;
    window.clearTimeout(restartTimer.current);
    try { recognition.current?.stop(); } catch (e) { /* already stopped */ }
    recognition.current = null;
    setActive(false);
    setStatus("idle");
  };

  useEffect(() => () => {
    keepListening.current = false;
    session.current += 1;
    window.clearTimeout(restartTimer.current);
    try { recognition.current?.abort(); } catch (e) { /* component is closing */ }
  }, []);

  const runCommand = async (rawText) => {
    const query = rawText.trim();
    if (!query) return;
    setHistory((items) => [...items.slice(-4), query]);
    window.dispatchEvent(new CustomEvent("mai:voice-command", { detail: { command: query, source: kind } }));
    setReply("");
    if (kind === "agent") {
      setBusy(true);
      try {
        const agentsResponse = await api.get("/ai-agents");
        const enabled = (agentsResponse.data || []).filter((agent) => agent.enabled);
        if (!enabled.length) {
          setError("External AI ابھی منسلک نہیں۔ Settings میں AI Agent کا محفوظ HTTPS endpoint اور server-side key ترتیب دیں۔");
          return;
        }
        const response = await api.post(`/ai-agents/${encodeURIComponent(enabled[0].id)}/message`, { message: query, context: { source: "voice" } });
        const data = response.data || {};
        if (!data.ok) throw new Error(`AI provider returned status ${data.status || "unknown"}`);
        const result = data.result;
        setReply(typeof result === "string" ? result : (result?.reply || result?.message || result?.text || JSON.stringify(result || {})));
      } catch (err) {
        setError(err?.response?.data?.detail || err.message || "External AI سے رابطہ نہیں ہو سکا۔");
      } finally { setBusy(false); }
      return;
    }
    try {
      const response = await api.post("/mai/command", { command: query, context: { source: kind } });
      const data = response.data || {};
      if (data.navigate_to) navigate(data.navigate_to);
      if (data.action === "search" || data.results?.length) setSearch(query);
      return;
    } catch (error) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        setError("اس کمانڈ کی اجازت نہیں ہے۔");
        return;
      }
      // Read-only local navigation/search fallback if the server is unreachable.
    }
    const lower = query.toLowerCase();
    if (searchWords.test(lower)) { setSearch(query); return; }
    const destination = destinations.find((item) => item.words.some((word) => lower.includes(word.toLowerCase())));
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
    const currentSession = ++session.current;
    setError("");
    setStatus("starting");
    const r = new Recognition();
    recognition.current = r;
    r.lang = language;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => { if (currentSession !== session.current) { try { r.abort(); } catch (_) {} return; } setActive(true); setStatus("listening"); };
    r.onresult = (event) => {
      if (currentSession !== session.current) return;
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
      if (currentSession !== session.current) return;
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
      if (currentSession !== session.current) return;
      recognition.current = null;
      if (keepListening.current) {
        restartTimer.current = window.setTimeout(() => { if (currentSession === session.current && keepListening.current) start(); }, 350);
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
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
      <div className="pointer-events-auto w-full max-w-lg rounded-2xl border border-yellow-500/30 bg-[#19191c] p-4 text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><b>{kind === "agent" ? "AI — External Agent" : "MAI — Madina Assistant"}</b><button type="button" aria-label="Close" onClick={() => { stop(); onClose(); }}><X size={18} /></button></div>
        <p className="mb-3 text-xs text-gray-400">{language === "en" ? "Press the microphone to start. Speak one command after another. Press it again to stop; while stopped, nothing is heard." : "MAI کھلا رہے گا جب آپ دوسرے صفحے پر جائیں یا باہر کلک کریں۔ مائیک شروع کرنے کے لیے دبائیں؛ بند کرنے کے لیے دوبارہ دبائیں۔"}</p>
        <div className="flex items-center gap-3">
          <button type="button" aria-label={active ? "Stop listening" : "Start listening"} onClick={toggleListening} className={`rounded-full border p-3 transition-all ${active ? "border-emerald-300 bg-emerald-600 text-white animate-pulse shadow-[0_0_22px_rgba(52,211,153,.7)]" : "border-yellow-500/60 bg-[#262329] text-yellow-400"}`}>{active ? <Mic size={22} /> : <MicOff size={22} />}</button>
          <span className="text-sm" aria-live="polite">{listeningLabel}</span>
        </div>
        <textarea aria-label="Voice command text" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder={language === "en" ? "For example: open customers and search Ahmad" : "مثلاً: کسٹمر کھولو اور احمد تلاش کرو"} className="mt-3 min-h-20 w-full rounded-lg border border-white/20 bg-black/30 p-3 text-sm text-white" />
        {error && <p role="alert" className="mt-2 text-xs text-amber-400">{error}</p>}
        {reply && <div role="status" className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-emerald-500/30 bg-black/30 p-3 text-sm">{reply}</div>}
        {history.length > 0 && <div className="mt-3 rounded-lg border border-white/10 p-2 text-xs text-gray-300"><div className="mb-1 text-gray-500">Recent commands</div>{history.map((item, index) => <div key={`${item}-${index}`}>• {item}</div>)}</div>}
        <button type="button" onClick={submitTyped} disabled={!transcript.trim() || busy} className="mt-3 flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"><Search size={16} />{language === "en" ? "Run command" : "کمانڈ چلائیں"}</button>
      </div>
    </div>
    {search !== null && <SearchRecords initialQuery={search} close={() => setSearch(null)} navigate={navigate} />}
  </>;
}
