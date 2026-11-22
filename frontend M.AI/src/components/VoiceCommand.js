import React, { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Search, X } from "lucide-react";
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
    setError("");
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
      setReply(data.message || (data.action === "navigate" ? "Page opened" : "Command received"));
      return;
    } catch (error) {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        setError("اس کمانڈ کی اجازت نہیں ہے۔");
        return;
      }
      // Read-only local navigation/search fallback if the server is unreachable.
    }
    const lower = query.toLowerCase();
    const destination = destinations.find((item) => item.words.some((word) => lower.includes(word.toLowerCase())));
    if (destination) { navigate(destination.path); setReply("Page opened. Further actions require a supported command."); return; }
    if (searchWords.test(lower)) { setReply("Search needs a supported record query; no changes were made."); return; }
    setReply("یہ کمانڈ ابھی دستیاب نہیں؛ کوئی ریکارڈ تبدیل نہیں کیا گیا۔");
  };

  const start = (isRestart = false) => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError(language === "en" ? "Voice recognition is not supported here. Type your search below, or try Chrome on Android/desktop." : "اس براوزر میں وائس ریکگنیشن دستیاب نہیں۔ نیچے تلاش لکھیں، یا Chrome Android/desktop پر آزمائیں۔");
      setStatus("unsupported");
      return;
    }
    keepListening.current = true;
    const currentSession = isRestart ? session.current : ++session.current;
    setError("");
    setStatus("starting");
    const r = new Recognition();
    recognition.current = r;
    r.lang = document.documentElement.lang === "ur" ? "ur-PK" : language;
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
        restartTimer.current = window.setTimeout(() => { if (currentSession === session.current && keepListening.current) start(true); }, 350);
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

  // Both assistants are compact and persistent across routes. No blocking search modal.
  return <div className={`fixed bottom-24 z-[80] flex flex-col items-end gap-2 ${kind === "agent" ? "right-20" : "right-4"}`} aria-label={kind === "agent" ? "External AI" : "MAI"}>
    {error && <div role="alert" className="max-w-xs rounded-lg bg-[#19191c] p-2 text-xs text-amber-300 shadow-lg">{error}</div>}
    {reply && <div role="status" className="max-w-xs rounded-lg bg-[#19191c] p-2 text-xs text-white shadow-lg">{reply}</div>}
    {busy && <div className="rounded bg-[#19191c] px-2 py-1 text-xs text-amber-300">Processing…</div>}
    <div className="flex items-center gap-1">
      <span className="rounded bg-[#19191c] px-1 text-[10px] text-white">{kind === "agent" ? "AI" : "MAI"}</span>
      <button type="button" aria-label={active ? "Stop listening" : "Start microphone"} title={listeningLabel} onClick={toggleListening}
        className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-white shadow-lg ${active ? "border-emerald-300 bg-emerald-600 animate-pulse" : status === "starting" || busy ? "border-yellow-300 bg-amber-500" : "border-gray-400 bg-gray-700"}`}>
        {active ? <Mic size={24} /> : <MicOff size={24} />}
      </button>
      <button type="button" onClick={() => { stop(); onClose(); }} aria-label="Close assistant" className="rounded-full bg-[#19191c] p-1 text-white"><X size={12}/></button>
    </div>
  </div>;
}
