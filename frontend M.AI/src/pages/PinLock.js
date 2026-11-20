import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { api, apiError } from "@/lib/api";
import { Modal, Field, Input, Btn } from "@/components/kit";
import { Delete, Languages, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";

export default function PinLock() {
  const { unlockPin, switchToPassword, resetPinWithCode } = useAuth();
  const { t, toggle, lang } = useI18n();
  const navigate = useNavigate();
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
    <div data-testid="pin-lock" className="relative flex min-h-screen flex-col items-center justify-center p-6">
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 30% 15%, #1c1c1f 0%, #0c0c0d 55%, #000 100%)" }} />
      <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(135deg, rgba(212,175,55,0.14), transparent 42%)" }} />
      <button onClick={toggle} data-testid="pin-lang-toggle"
        className="absolute top-5 end-5 z-10 flex items-center gap-2 rounded-sm border border-white/20 px-3 py-1.5 text-sm text-white hover:border-[var(--gold)]">
        <Languages size={16} /> {lang === "en" ? "اردو" : "English"}
      </button>

      <div className="relative z-10 flex w-full max-w-xs flex-col items-center">
        <img src="/logo.png" alt="MTC" className="mb-3 h-20 w-20 rounded-sm object-cover" />
        <h1 className="font-head text-xl font-black gold-text">{t("enter_pin")}</h1>
        <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">{t("pin_subtitle")}</p>

        {/* dots */}
        <div className="mb-4 flex items-center gap-4" data-testid="pin-dots">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-4 w-4 rounded-full border transition-colors ${i < pin.length ? "bg-[var(--gold)] border-[var(--gold)]" : "border-white/40"}`} />
          ))}
        </div>
        <div className="mb-4 h-5 text-sm text-red-400" data-testid="pin-error">{busy ? <Loader2 className="animate-spin" size={16} /> : err}</div>

        {/* keypad */}
        <div className="grid grid-cols-3 gap-3">
          {keys.map((k) => (
            <button key={k} data-testid={`pin-key-${k}`} onClick={() => push(k)} disabled={busy}
              className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 text-2xl font-semibold text-white transition-colors hover:border-[var(--gold)] hover:text-[var(--gold)] active:scale-95">
              {k}
            </button>
          ))}
          <span />
          <button data-testid="pin-key-0" onClick={() => push("0")} disabled={busy}
            className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 text-2xl font-semibold text-white transition-colors hover:border-[var(--gold)] hover:text-[var(--gold)] active:scale-95">
            0
          </button>
          <button data-testid="pin-backspace" onClick={back} disabled={busy}
            className="flex h-16 w-16 items-center justify-center rounded-full text-white/70 hover:text-white active:scale-95">
            <Delete size={24} />
          </button>
        </div>

        <div className="mt-7 flex flex-col items-center gap-3">
          <button data-testid="pin-forgot-link" onClick={() => setForgot(true)}
            className="text-sm text-[var(--gold)] hover:underline">{t("forgot_pin")}</button>
          <button data-testid="pin-use-password" onClick={() => { switchToPassword(); navigate("/login"); }}
            className="text-xs text-muted-foreground hover:text-white">{t("use_password")}</button>
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
