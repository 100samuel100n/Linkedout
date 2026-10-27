"use client";
import ErrorNote from "@/components/ErrorNote";
import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";

// One themed dialog system for the whole site, replacing the browser's
// alert/confirm/prompt (which look foreign to the app). Usage:
//   const dialog = useDialog();
//   if (await dialog.confirm({ title, message, danger })) …
//   await dialog.alert({ title, message });   const text = await dialog.prompt({ … });
//   dialog.report({ targetType: "post", targetId });   dialog.toast("Saved");
const Ctx = createContext(null);
export const useDialog = () => useContext(Ctx);

const REASONS = ["Spam", "Harassment or hate", "Misinformation", "Adult content", "Self-harm", "Something else"];
const btn = (kind) => ({ ...monoFont, fontSize: 12.5, fontWeight: 700, borderRadius: 10, padding: "9px 16px", cursor: "pointer", border: `1px solid ${kind === "primary" ? C.mustard : kind === "danger" ? C.flag : C.line}`, background: kind === "primary" ? C.mustard : kind === "danger" ? C.flag : "transparent", color: kind === "primary" || kind === "danger" ? "#fff" : C.text });

export function DialogProvider({ children }) {
  const [d, setD] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const resolver = useRef(null);
  const tt = useRef();

  const open = useCallback((spec) => new Promise((res) => { resolver.current = res; setD(spec); }), []);
  const close = useCallback((v) => { resolver.current?.(v); resolver.current = null; setD(null); }, []);
  const api = useRef({
    confirm: (o) => open({ kind: "confirm", ...o }),
    alert: (o) => open({ kind: "alert", ...(typeof o === "string" ? { message: o } : o) }),
    prompt: (o) => open({ kind: "prompt", ...o }),
    report: (o) => open({ kind: "report", ...o }),
    toast: (m) => { setToastMsg(m); clearTimeout(tt.current); tt.current = setTimeout(() => setToastMsg(null), 2400); },
  }).current;

  useEffect(() => {
    if (!d) return;
    const k = (e) => e.key === "Escape" && close(d.kind === "confirm" ? false : null);
    document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k);
  }, [d, close]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {typeof document !== "undefined" && toastMsg && createPortal(
        <div className="lo-toast" role="status" style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", zIndex: 200, ...monoFont, fontSize: 12, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 999, padding: "9px 16px", boxShadow: "0 10px 30px rgba(0,0,0,.35)", maxWidth: "90vw" }}>{toastMsg}</div>, document.body)}
      {typeof document !== "undefined" && d && createPortal(<Modal d={d} close={close} />, document.body)}
    </Ctx.Provider>
  );
}

function Modal({ d, close }) {
  const [text, setText] = useState(d.defaultValue || "");
  const [reason, setReason] = useState(null), [details, setDetails] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(null), [sent, setSent] = useState(false);
  const field = { width: "100%", background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 13.5 };

  async function sendReport() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType: d.targetType || "post", targetId: d.targetId, reason, details: details.trim() }) });
      if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error || "Couldn't send the report."), { status: res.status });
      setSent(true);
    } catch (e) { setErr(e.status === 401 ? "Log in to report." : e.message); } finally { setBusy(false); }
  }

  return (
    <div onClick={() => close(d.kind === "confirm" ? false : null)} style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="lo-toast" style={{ width: "min(420px, 100%)", maxHeight: "88vh", overflowY: "auto", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,.45)" }}>
        {d.kind === "report" ? (
          sent ? (
            <>
              <div style={{ ...displayFont, fontSize: 18, color: C.text, marginBottom: 6 }}>Thanks for letting us know</div>
              <div style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.5, marginBottom: 16 }}>Our moderators will review it. You won't be identified to the author.</div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}><button style={btn("primary")} onClick={() => close(true)}>Done</button></div>
            </>
          ) : (
            <>
              <div style={{ ...displayFont, fontSize: 18, color: C.text, marginBottom: 4 }}>Report this {d.targetType || "post"}</div>
              <div style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>What's wrong with it?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {REASONS.map((r) => (
                  <button key={r} onClick={() => setReason(r)} style={{ ...monoFont, fontSize: 12, borderRadius: 999, padding: "6px 12px", cursor: "pointer", color: reason === r ? "#fff" : C.text, background: reason === r ? C.mustard : "transparent", border: `1px solid ${reason === r ? C.mustard : C.line}` }}>{r}</button>
                ))}
              </div>
              <textarea rows={3} maxLength={500} placeholder="Add details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} style={field} />
              {err && <ErrorNote>{err}</ErrorNote>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                <button style={btn()} onClick={() => close(false)}>Cancel</button>
                <button style={{ ...btn("primary"), opacity: reason && !busy ? 1 : 0.5 }} disabled={!reason || busy} onClick={sendReport}>{busy ? "Sending…" : "Submit report"}</button>
              </div>
            </>
          )
        ) : (
          <>
            {d.title && <div style={{ ...displayFont, fontSize: 18, color: C.text, marginBottom: 6 }}>{d.title}</div>}
            {d.message && <div style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.5, marginBottom: d.kind === "prompt" ? 12 : 16, whiteSpace: "pre-wrap" }}>{d.message}</div>}
            {d.kind === "prompt" && (d.multiline
              ? <textarea autoFocus rows={3} value={text} placeholder={d.placeholder} onChange={(e) => setText(e.target.value)} style={{ ...field, marginBottom: 16 }} />
              : <input autoFocus value={text} placeholder={d.placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && close(text)} style={{ ...field, marginBottom: 16 }} />)}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              {d.kind !== "alert" && <button style={btn()} onClick={() => close(d.kind === "confirm" ? false : null)}>{d.cancelLabel || "Cancel"}</button>}
              <button style={btn(d.danger ? "danger" : "primary")} onClick={() => close(d.kind === "prompt" ? text : true)}>{d.confirmLabel || (d.kind === "alert" ? "OK" : d.kind === "confirm" ? "Confirm" : "Submit")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
