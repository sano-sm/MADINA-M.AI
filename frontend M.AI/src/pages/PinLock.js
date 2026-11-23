import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { useI18n } from "@/context/I18nContext";
import { api, apiError } from "@/lib/api";
import { Modal, Field, Input, Btn } from "@/components/kit";
import { Delete, Languages, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";

export default function PinLock() {
  const { unlockPin, switchToPassword, resetPinWithCode } = useAuth();
  const { t, toggle, lang } = useI18n();
  const navigate = useNavigate();
  const { theme } = useSettings();
  const pinTheme = theme === "white" ? "floral" : theme === "navy" ? "modern" : "car";
  const accent = pinTheme === "floral" ? "#a72b73" : pinTheme === "modern" ? "#e7b747" : "#54baf4";
  const ink = pinTheme === "floral" ? "#23172a" : "#ffffff";
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (val) => {
    setBusy(true);
    try { await unlockPin(val); }
    catch (e) {
      const msg = e?.response?.data?.detail || t("incorrect_pin");
      setErr(msg); setPin("");
    } finally { setBusy(false); }
  };

  const push = (d) => {
    if (busy) return;
    setErr("");
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) submit(next);
  };
  const back = () => { setErr(""); setPin((p) => p.slice(0, -1)); };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div data-testid="pin-lock" data-pin-theme={pinTheme} className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-6" style={{ color: ink, background: pinTheme === "floral" ? "linear-gradient(150deg,#fff9fc 0%,#f8e4ef 48%,#eee6f8 100%)" : pinTheme === "modern" ? "radial-gradient(ellipse at 75% 85%,#09687a 0%,#043a49 38%,#06131e 80%)" : "linear-gradient(165deg,#07121e 0%,#132b40 52%,#050b13 100%)" }}>
      {pinTheme === "car" && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 bottom-0 h-2/3 opacity-80" style={{background:"radial-gradient(ellipse at 30% 95%,rgba(240,158,73,.4),transparent 50%),linear-gradient(0deg,rgba(7,17,28,.85),transparent 75%)"}} />
        <svg viewBox="0 0 700 330" className="absolute bottom-[5%] left-1/2 w-[min(110vw,850px)] -translate-x-1/2 opacity-60" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M50 230 L90 188 L188 166 L260 98 Q285 77 336 77 L463 83 Q501 88 532 137 L617 165 Q654 172 665 211 L664 250 L50 250 Z" fill="#07111c" stroke="#65b7ed" strokeWidth="3"/>
          <path d="M260 102 L333 95 L340 164 L205 164 Z M353 95 L458 101 Q484 106 512 157 L355 164 Z" fill="#244b68" stroke="#87c9ed" strokeWidth="3"/>
          <circle cx="178" cy="249" r="48" fill="#02070d" stroke="#4a8cb2" strokeWidth="8"/><circle cx="535" cy="249" r="48" fill="#02070d" stroke="#4a8cb2" strokeWidth="8"/>
          <path d="M57 206 L118 197 M606 193 L658 207" stroke="#a5e4ff" strokeWidth="12" strokeLinecap="round"/>
        </svg>
      </div>}
      {pinTheme === "floral" && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute -right-5 top-12 rotate-12 text-[110px] opacity-55">🌸</span>
        <span className="absolute -left-10 bottom-10 -rotate-12 text-[130px] opacity-45">🌸</span>
        <span className="absolute right-5 bottom-[25%] text-5xl opacity-35">🌸</span>
      </div>}
      {pinTheme === "modern" && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-36 -top-32 h-96 w-96 rotate-45 rounded-[35%] border-[35px] border-[#d6a94e]/35" />
        <div className="absolute -bottom-48 -left-36 h-[480px] w-[480px] rotate-45 rounded-[45%] border-[55px] border-[#e7b747]/25" />
        <div className="absolute inset-0" style={{background:"linear-gradient(130deg,transparent 35%,rgba(10,194,211,.12) 53%,transparent 70%)"}} />
      </div>}
      <button onClick={toggle} data-testid="pin-lang-toggle"
        className="absolute top-5 end-5 z-10 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold" style={{borderColor:accent,color:ink,background:pinTheme === "floral" ? "#ffffffcc" : "#071624aa"}}>
        <Languages size={16} /> {lang === "en" ? "اردو" : "English"}
      </button>

      <div className="relative z-10 flex w-full max-w-xs sm:max-w-sm lg:max-w-md flex-col items-center rounded-3xl px-4 py-7 sm:px-8 lg:px-12 lg:py-10 backdrop-blur-[3px]" style={{background:pinTheme === "floral" ? "rgba(255,255,255,.68)" : "rgba(0,8,19,.35)",boxShadow:`0 0 55px ${accent}18`}}>
        <img src="/logo.png" alt="MTC" className="mb-3 h-20 w-20 lg:h-24 lg:w-24 rounded-sm object-cover" />
        <h1 className="font-head text-xl lg:text-3xl font-black gold-text">{t("enter_pin")}</h1>
        <p className="mt-1 mb-6 text-center text-sm" style={{color:ink,opacity:.78}}>{t("pin_subtitle")}</p>

        {/* dots */}
        <div className="mb-4 flex items-center gap-4" data-testid="pin-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-4 w-4 rounded-full border-2 transition-colors" style={{borderColor:accent,background:i < pin.length ? accent : "transparent"}} />
          ))}
        </div>
        <div className="mb-4 h-5 text-sm text-red-400" data-testid="pin-error">{busy ? <Loader2 className="animate-spin" size={16} /> : err}</div>

        {/* keypad */}
        <div className="grid grid-cols-3 gap-3 lg:gap-5">
          {keys.map((k) => (
            <button key={k} data-testid={`pin-key-${k}`} onClick={() => push(k)} disabled={busy}
              className="flex h-16 w-16 lg:h-20 lg:w-20 items-center justify-center rounded-full border-2 text-2xl font-bold shadow-lg transition-transform active:scale-95" style={{borderColor:accent,color:ink,background:pinTheme === "floral" ? "#fff" : "#071927c9",boxShadow:`0 0 12px ${accent}40`}}>
              {k}
            </button>
          ))}
          <span />
          <button data-testid="pin-key-0" onClick={() => push("0")} disabled={busy}
            className="flex h-16 w-16 lg:h-20 lg:w-20 items-center justify-center rounded-full border-2 text-2xl font-bold shadow-lg transition-transform active:scale-95" style={{borderColor:accent,color:ink,background:pinTheme === "floral" ? "#fff" : "#071927c9",boxShadow:`0 0 12px ${accent}40`}}>
            0
          </button>
          <button data-testid="pin-backspace" onClick={back} disabled={busy}
            className="flex h-16 w-16 items-center justify-center rounded-full active:scale-95" style={{color:ink}}>
            <Delete size={24} />
          </button>
        </div>

        <div className="mt-7 flex flex-col items-center gap-3">
          <button data-testid="pin-forgot-link" onClick={() => setForgot(true)}
            className="text-sm font-bold hover:underline" style={{color:pinTheme === "floral" ? "#8b1c58" : "#f3c34d"}}>{t("forgot_pin")}</button>
          <button data-testid="pin-use-password" onClick={() => { switchToPassword(); navigate("/login"); }}
            className="text-xs font-semibold hover:underline" style={{color:ink}}>{t("use_password")}</button>
        </div>
      </div>

      {forgot && <ForgotPinModal onClose={() => setForgot(false)} t={t} resetPinWithCode={resetPinWithCode} />}
    </div>
  );
}

function ForgotPinModal({ onClose, t, resetPinWithCode }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    setBusy(true);
    try {
      await api.post("/auth/pin/forgot", { email });
      toast.success(t("code_sent"));
      setStep(2);
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!/^\d{4}$/.test(pin)) return toast.error(t("pin_rule"));
    setBusy(true);
    try { await resetPinWithCode(email, code, pin); toast.success(t("pin_updated")); onClose(); }
    catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} testid="forgot-pin-modal" title={<span className="flex items-center gap-2"><KeyRound size={18} />{t("reset_pin")}</span>}>
      {step === 1 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("reset_pin_hint")}</p>
          <Field label={t("email")}>
            <Input data-testid="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Btn data-testid="forgot-send-code" disabled={busy || !email} onClick={sendCode} className="w-full">
            {busy && <Loader2 className="animate-spin" size={16} />} {t("send_code")}
          </Btn>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t("reset_code")}>
            <Input data-testid="reset-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label={t("new_pin")}>
            <Input data-testid="reset-new-pin" type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Btn data-testid="reset-pin-btn" disabled={busy || !code || !pin} onClick={reset} className="w-full">
            {busy && <Loader2 className="animate-spin" size={16} />} {t("reset_pin")}
          </Btn>
        </div>
      )}
    </Modal>
  );
}
