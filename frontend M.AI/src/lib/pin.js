// On-device PIN storage: PBKDF2 hash (never plaintext), works fully offline.
const PIN_KEY = "mtc_pin";
const ITER = 150000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pin, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, key, 256);
  return b64(bits);
}

export async function setLocalPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt);
  localStorage.setItem(PIN_KEY, JSON.stringify({ salt: b64(salt), hash, iter: ITER }));
}

export async function verifyLocalPin(pin) {
  const raw = localStorage.getItem(PIN_KEY);
  if (!raw) return false;
  try {
    const { salt, hash } = JSON.parse(raw);
    const h = await derive(pin, unb64(salt));
    return h === hash;
  } catch {
    return false;
  }
}

export function hasLocalPin() {
  return !!localStorage.getItem(PIN_KEY);
}

export function clearLocalPin() {
  localStorage.removeItem(PIN_KEY);
}
