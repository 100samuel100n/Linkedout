// What the edge proxy (proxy.js) needs to know about distribution, without touching the database itself.
// Served inside /api/internal/blocklist (internal key only) and cached by the proxy for ~15 s.
import { identityDb } from "@/lib/identity/db";
import { distReady, settings } from "./db.js";
import { blockedDevices, withdrawnCodes } from "./kill.js";

let version = 0;
export const bumpRevocations = () => { version++; };
export const revocationVersion = () => version;

export async function distPayload() {
  await distReady(); const s = await settings();
  const rows = await identityDb.prepare("SELECT install_id, status FROM dist_installs WHERE status IN ('revoked','killed') ORDER BY revoked_at DESC LIMIT 5000").all();
  const revoked = rows.filter((r) => r.status === "revoked").map((r) => r.install_id);
  // killed installs, blocked devices and withdrawn builds are refused by the edge in every mode (proxy.js)
  return { mode: s.mode, minVersionCode: +s.min_version_code || 0, revoked, killed: rows.filter((r) => r.status === "killed").map((r) => r.install_id), blockedDevices: [...(await blockedDevices())].slice(0, 20000), withdrawn: [...(await withdrawnCodes())] };
}
