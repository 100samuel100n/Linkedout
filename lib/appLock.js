// App Lock for the web app: a LOCAL gate that asks the device's own screen-lock (Face ID, Touch ID, fingerprint, Windows Hello, passcode)
// via WebAuthn before the app opens. Same trust level as the native App Lock: it keeps a casual person who picks up your phone out of
// the app. Nothing is sent to our servers and the credential is never verified remotely.
const KEY = "lo-applock", GRACE_KEY = "lo-applock-grace";
export const GRACES = [[0, "immediately"], [30, "30 seconds"], [60, "1 minute"], [300, "5 minutes"], [900, "15 minutes"]];
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const rand = (n = 32) => crypto.getRandomValues(new Uint8Array(n));

export async function lockSupported() { try { return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch { return false; } }
export const lockEnabled = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
export const getGrace = () => { try { return +localStorage.getItem(GRACE_KEY) || 0; } catch { return 0; } };
export const setGrace = (s) => { try { localStorage.setItem(GRACE_KEY, String(s)); } catch { /* */ } };

export async function enableLock() {
  try {
    const cred = await navigator.credentials.create({ publicKey: { challenge: rand(), rp: { name: "LinkedOut", id: location.hostname }, user: { id: rand(16), name: "app-lock", displayName: "LinkedOut App Lock" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" }, attestation: "none", timeout: 60000 } });
    if (!cred) throw new Error("cancelled");
    localStorage.setItem(KEY, b64u(cred.rawId)); sessionStorage.setItem("lo-unlocked", "1");
  } catch (e) { throw new Error(e?.name === "NotAllowedError" ? "App Lock was not turned on (cancelled)." : "Could not turn on App Lock on this device."); }
}
// Resolves true when the person proves they are at the device. Used to unlock, and to turn App Lock off.
export async function verifyLock() {
  const id = localStorage.getItem(KEY); if (!id) return true;
  try { await navigator.credentials.get({ publicKey: { challenge: rand(), allowCredentials: [{ type: "public-key", id: fromB64u(id), transports: ["internal"] }], userVerification: "required", timeout: 60000 } }); return true; } catch { return false; }
}
export async function disableLock() {
  if (!(await verifyLock())) throw new Error("App Lock stays on: we couldn’t confirm it’s you.");
  localStorage.removeItem(KEY); sessionStorage.removeItem("lo-unlocked");
}