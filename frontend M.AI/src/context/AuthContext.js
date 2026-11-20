import React, { createContext, useContext, useState, useEffect } from "react";
import { api } from "@/lib/api";
import { setLocalPin, verifyLocalPin, hasLocalPin, clearLocalPin } from "@/lib/pin";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = no session
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pinMode, setPinMode] = useState(null); // 'local' | 'server' | null
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    (async () => {
      const token = localStorage.getItem("mtc_token");
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem("mtc_user")); } catch { cached = null; }

      // Returning device with an offline PIN: gate locally, no network needed.
      if (token && cached && hasLocalPin()) {
        setUser(cached); setPinMode("local"); setLocked(true); setReady(true); return;
      }
      // First unlock on this device (or after logout): use the server PIN.
      try {
        const { data } = await api.get("/auth/pin/status");
        if (data.pin_set) { setPinMode("server"); setLocked(true); setUser(false); setReady(true); return; }
      } catch { /* offline & no local pin: fall through to password */ }
      // No PIN configured anywhere -> password fallback.
      if (token) {
        try {
          const me = await api.get("/auth/me");
          setUser(me.data);
          localStorage.setItem("mtc_user", JSON.stringify(me.data));
          api.post("/auth/refresh").then((r) => localStorage.setItem("mtc_token", r.data.token)).catch(() => {});
        } catch (err) {
          if (err?.response?.status === 401) {
            localStorage.removeItem("mtc_token"); localStorage.removeItem("mtc_user"); setUser(false);
          } else { setUser(cached || false); }
        }
      } else { setUser(false); }
      setReady(true);
    })();
  }, []);

  // Reconnect manager: after idle/background, re-ping the backend on
  // foreground/online. When a call succeeds after a disconnect, api.js fires
  // "mtc:reconnected" and we bump reconnectKey to remount + reload all data.
  useEffect(() => {
    const onReconnected = () => setReconnectKey((k) => k + 1);
    let timer = null;
    const kick = () => {
      if (document.visibilityState !== "visible") return;
      clearInterval(timer);
      let tries = 0;
      const attempt = () => {
        tries += 1;
        api.get("/auth/pin/status", { __noRetry: true })
          .then(() => clearInterval(timer))
          .catch(() => { if (tries >= 8) clearInterval(timer); });
      };
      attempt();
      timer = setInterval(attempt, 1500);
    };
    window.addEventListener("mtc:reconnected", onReconnected);
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("focus", kick);
    window.addEventListener("online", kick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("mtc:reconnected", onReconnected);
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("focus", kick);
      window.removeEventListener("online", kick);
    };
  }, []);

  // Unlock via PIN: offline if a local hash exists, otherwise verify on the server.
  const unlockPin = async (pin) => {
    if (pinMode === "local" && hasLocalPin()) {
      const ok = await verifyLocalPin(pin);
      if (!ok) throw new Error("incorrect");
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem("mtc_user")); } catch { cached = null; }
      if (cached) setUser(cached);
      setLocked(false);
      api.post("/auth/refresh").then((r) => localStorage.setItem("mtc_token", r.data.token)).catch(() => {});
      return;
    }
    const { data } = await api.post("/auth/pin/verify", { pin });
    localStorage.setItem("mtc_token", data.token);
    localStorage.setItem("mtc_user", JSON.stringify(data.user));
    await setLocalPin(pin);
    setUser(data.user); setPinMode("local"); setLocked(false);
  };

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("mtc_token", data.token);
    localStorage.setItem("mtc_user", JSON.stringify(data.user));
    setUser(data.user); setLocked(false);
    return data.user;
  };

  // Set/change the PIN from Settings (authenticated) + store the offline hash.
  const setPin = async (pin) => {
    await api.post("/auth/pin/set", { pin });
    await setLocalPin(pin);
    setPinMode("local");
  };

  const resetPinWithCode = async (email, code, pin) => {
    const { data } = await api.post("/auth/pin/reset", { email, code, pin });
    localStorage.setItem("mtc_token", data.token);
    localStorage.setItem("mtc_user", JSON.stringify(data.user));
    await setLocalPin(pin);
    setUser(data.user); setPinMode("local"); setLocked(false);
  };

  const switchToPassword = () => { setLocked(false); setUser(false); };

  const logout = () => {
    localStorage.removeItem("mtc_token");
    localStorage.removeItem("mtc_user");
    clearLocalPin();
    setUser(false); setLocked(false); setPinMode(null);
  };

  const can = (perm) => user && user.permissions && user.permissions.includes(perm);

  return (
    <AuthContext.Provider value={{ user, ready, locked, pinMode, reconnectKey, login, logout, can,
      unlockPin, setPin, resetPinWithCode, switchToPassword }}>
      {children}
    </AuthContext.Provider>
  );
}
