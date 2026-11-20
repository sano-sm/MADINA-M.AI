import { useEffect, useState } from "react";

const KEY = "madina_ai_preferences_v1";
export const DEFAULT_AI_PREFERENCES = { master: true, agent: false, voice: true, camera: false };

export function readAiPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return Object.fromEntries(Object.keys(DEFAULT_AI_PREFERENCES).map(k => [k, saved[k] === true]));
  } catch { return { ...DEFAULT_AI_PREFERENCES }; }
}

export function useAiPreferences() {
  const [prefs, setPrefs] = useState(readAiPreferences);
  useEffect(() => {
    const update = () => setPrefs(readAiPreferences());
    window.addEventListener("madina-ai-preferences", update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener("madina-ai-preferences", update); window.removeEventListener("storage", update); };
  }, []);
  const change = (name, enabled) => {
    const next = { ...readAiPreferences(), [name]: enabled };
    localStorage.setItem(KEY, JSON.stringify(next));
    setPrefs(next);
    window.dispatchEvent(new Event("madina-ai-preferences"));
  };
  return { prefs, change };
}
