import axios from "axios";
import { toast } from "sonner";

const API = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "").replace(/\/api$/, "") + "/api";

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("mtc_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const company = localStorage.getItem("mtc_company");
  if (company) config.headers["X-Company-Id"] = company;
  return config;
});

let reconnectToast = null;
let disconnected = false;

const showReconnecting = () => {
  disconnected = true;
  if (!reconnectToast) reconnectToast = toast.loading("Reconnecting…");
};
// Dismiss the spinner without declaring success (used when retries are exhausted,
// so the toast is NEVER left stuck; the reconnect manager will re-ping on reopen).
const hideReconnecting = () => {
  if (reconnectToast) { toast.dismiss(reconnectToast); reconnectToast = null; }
};
// A request just succeeded: clear the spinner and, if we were disconnected,
// announce recovery so the app can reload its data.
const markConnected = () => {
  if (reconnectToast) { toast.dismiss(reconnectToast); reconnectToast = null; }
  if (disconnected) {
    disconnected = false;
    toast.success("Reconnected");
    window.dispatchEvent(new Event("mtc:reconnected"));
  }
};
export const isDisconnected = () => disconnected;

// A genuine API error always returns JSON with a `detail` field. A transient
// gateway/ingress error (backend sleeping or cold-starting) returns an HTML/empty
// body — including a spurious 404 — which we must retry, NOT surface or log out on.
const isTransientGatewayError = (err) => {
  if (!err.response) return true; // network drop / no response
  const status = err.response.status;
  if (status === 502 || status === 503 || status === 504) return true;
  if (status === 404) {
    const data = err.response.data;
    const isApiJson = data && typeof data === "object" && "detail" in data;
    return !isApiJson; // gateway 404 (not our JSON API 404) -> retry
  }
  return false;
};

api.interceptors.response.use(
  (r) => { markConnected(); return r; },
  async (err) => {
    const cfg = err.config || {};
    // Backend sleep / cold start / temporary network drop: auto-reconnect with
    // backoff. Never destroy a valid session for these — retry until the pod wakes.
    if (isTransientGatewayError(err) && !cfg.__noRetry) {
      cfg.__retryCount = cfg.__retryCount || 0;
      if (cfg.__retryCount < 10) {
        cfg.__retryCount++;
        showReconnecting();
        const delay = Math.min(700 * cfg.__retryCount, 5000);
        await new Promise((res) => setTimeout(res, delay));
        return api(cfg);
      }
      // Gave up after retries: never leave the "Reconnecting…" spinner stuck.
      // Stay flagged disconnected so the next successful call announces recovery.
      hideReconnecting();
    }
    // Only redirect on a genuine expired/revoked session — i.e. a token WAS present.
    // Auth endpoints (login / pin verify / pin reset) handle their own 401 locally,
    // and a 401 with no token (PIN screen / login flow) must never force-redirect.
    const isAuthCall = (cfg.url || "").includes("/auth/");
    const hadToken = !!localStorage.getItem("mtc_token");
    if (err.response?.status === 401 && !isAuthCall && hadToken) {
      localStorage.removeItem("mtc_token");
      localStorage.removeItem("mtc_user");
      if (!window.location.pathname.includes("login")) window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export function apiError(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((e) => e.msg || JSON.stringify(e)).join(" ");
  return err?.message || "Something went wrong";
}

export function downloadUrl(path) {
  const token = localStorage.getItem("mtc_token");
  const company = localStorage.getItem("mtc_company") || "MTC";
  const sep = path.includes("?") ? "&" : "?";
  return `${API}${path}${sep}token=${token}&company=${company}`;
}

export { API };
