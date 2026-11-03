// Called from lib/session.js for native (Bearer) requests. Fails OPEN on internal errors so an outage here cannot lock everyone out.
import { settings } from "./db.js";
import { verifyRequest, bindAccount, installStatus } from "./installs.js";
import { isDeviceBlocked, isVersionWithdrawn } from "./kill.js";

export async function checkNativeSession(headers, bearer, accountId) {
  // Kills apply in EVERY mode, including "off" and "monitor": a killed install, a blocked device or a withdrawn build gets nothing.
  const dev = headers.get("x-lo-dev"), id = headers.get("x-lo-install"), code = parseInt(headers.get("x-lo-app-code") || "0", 10);
  if ((dev && (await isDeviceBlocked(dev))) || (code && (await isVersionWithdrawn(code))) || (id && (await installStatus(id)) === "killed")) return { allow: false, code: "INSTALL_KILLED" };
  const s = await settings(); if (s.mode === "off") return { allow: true };
  const v = await verifyRequest(headers, bearer);
  if (v.ok) { bindAccount(v.installId, accountId); return { allow: true, installId: v.installId }; }
  if (s.mode === "enforce") return { allow: false, code: v.code };
  return { allow: true, monitored: v.code };           // monitor: note it, never block
}

// Sign-in / sign-up from the native app: in enforce mode the request must carry a valid install signature (token hash = empty),
// so a fake app cannot even obtain a session. Web requests are unaffected (they use cookies and the normal bot defences).
import { NextResponse } from "next/server";
export async function authInstallError(request) {
  try {
    if (request.headers.get("x-lo-client") !== "native") return null;
    const s = await settings(); if (s.mode !== "enforce") { if (s.mode === "monitor") verifyRequest(request.headers, "").catch(() => {}); return null; }
    const v = await verifyRequest(request.headers, "");
    return v.ok ? null : NextResponse.json({ error: v.message, code: v.code }, { status: 403 });
  } catch { return null; }
}
