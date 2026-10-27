// Forwards security events to your SIEM / log platform as signed JSON. Works with anything that accepts a webhook:
// Splunk HEC, Datadog logs intake, Elastic, Microsoft Sentinel (Logic App / DCR), Better Stack, Grafana Loki gateway…
// Config (env or the Vault): SIEM_WEBHOOK_URL, SIEM_WEBHOOK_TOKEN (sent as `Authorization: Bearer`), SIEM_SIGNING_SECRET
// (optional; adds an HMAC `X-LO-Signature` so the receiver can verify the sender).
import crypto from "node:crypto";
import { vaultGet } from "./vault";
export async function siemConfigured() { return !!(await vaultGet("SIEM_WEBHOOK_URL", "SIEM_WEBHOOK_URL")); }
export async function forwardEvent(kind, payload) {
  try {
    const url = await vaultGet("SIEM_WEBHOOK_URL", "SIEM_WEBHOOK_URL");
    if (!url) return { sent: false, reason: "not configured" };
    const token = await vaultGet("SIEM_WEBHOOK_TOKEN", "SIEM_WEBHOOK_TOKEN"), secret = await vaultGet("SIEM_SIGNING_SECRET", "SIEM_SIGNING_SECRET");
    const body = JSON.stringify({ source: "linkedout", kind, at: new Date().toISOString(), env: process.env.NODE_ENV, ...payload });
    const headers = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(secret ? { "X-LO-Signature": crypto.createHmac("sha256", secret).update(body).digest("hex") } : {}) };
    const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
    return { sent: r.ok, status: r.status };
  } catch (e) { return { sent: false, reason: e?.message }; }
}
