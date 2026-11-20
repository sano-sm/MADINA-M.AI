import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { apiError } from "@/lib/api";
import { Btn } from "@/components/kit";
import { Languages, Loader2 } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const { t, toggle, lang } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (e) { setErr(apiError(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 30% 15%, #1c1c1f 0%, #0c0c0d 55%, #000 100%)" }} />
      <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(135deg, rgba(212,175,55,0.14), transparent 42%)" }} />
      <button onClick={toggle} data-testid="login-lang-toggle"
        className="absolute top-5 end-5 z-10 flex items-center gap-2 rounded-sm border border-white/20 px-3 py-1.5 text-sm text-white hover:border-[var(--gold)]">
        <Languages size={16} /> {lang === "en" ? "اردو" : "English"}
      </button>
      <div className="relative z-10 w-full max-w-md card-surface rounded-sm p-8 animate-fade-up">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="MTC" className="mb-3 h-24 w-24 rounded-sm object-cover" />
          <h1 className="font-head text-2xl font-black gold-text">{t("app_name")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("welcome")}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("email")}</label>
            <input data-testid="login-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--gold)]" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{t("password")}</label>
            <input data-testid="login-password" type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-sm border border-input bg-[var(--surface-2)] px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--gold)]" />
          </div>
          {err && <div data-testid="login-error" className="rounded-sm bg-destructive/20 px-3 py-2 text-sm text-red-300">{err}</div>}
          <Btn type="submit" data-testid="login-submit" disabled={loading} className="w-full py-2.5">
            {loading && <Loader2 className="animate-spin" size={16} />} {t("sign_in")}
          </Btn>
        </form>
      </div>
    </div>
  );
}
