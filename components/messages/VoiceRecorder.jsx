"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Trash2, Send, Pause, Play, Square } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

// Record -> (pause / resume) -> stop -> preview -> send or discard. Live level meter, countdown to the plan's
// limit, auto-stop at the limit. onSend(blob, seconds, mimeType).
export default function VoiceRecorder({ maxSeconds = 180, onSend, onCancel }) {
  const [state, setState] = useState("starting"); // starting | recording | paused | preview | error
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const rec = useRef(null), stream = useRef(null), chunks = useRef([]), timer = useRef(null), raf = useRef(null), ctx = useRef(null), result = useRef(null), secsRef = useRef(0), audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => { start(); return cleanup; /* eslint-disable-next-line */ }, []);
  function cleanup() {
    clearInterval(timer.current); cancelAnimationFrame(raf.current);
    try { rec.current?.state !== "inactive" && rec.current?.stop(); } catch {}
    stream.current?.getTracks().forEach((t) => t.stop()); ctx.current?.close?.().catch(() => {});
  }
  async function start() {
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) { setErr("Voice recording isn't supported in this browser."); setState("error"); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) { setErr(e?.name === "NotAllowedError" ? "Microphone access is blocked. Allow it in your browser settings to record." : "No microphone found."); setState("error"); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; ctx.current = new AC();
      const an = ctx.current.createAnalyser(); an.fftSize = 256; ctx.current.createMediaStreamSource(stream.current).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => { an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); setLevel(Math.min(1, peak / 60)); raf.current = requestAnimationFrame(tick); };
      tick();
    } catch {}
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined); rec.current = r;
    r.ondataavailable = (e) => e.data?.size && chunks.current.push(e.data);
    r.onstop = () => {
      const type = r.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks.current, { type }); result.current = { blob, type };
      setBlobUrl(URL.createObjectURL(blob)); setState("preview");
    };
    r.start(250); setState("recording");
    timer.current = setInterval(() => { secsRef.current += 1; setSecs(secsRef.current); if (maxSeconds && secsRef.current >= maxSeconds) stop(); }, 1000);
  }
  function stop() { clearInterval(timer.current); cancelAnimationFrame(raf.current); setLevel(0); try { rec.current.stop(); } catch {} stream.current?.getTracks().forEach((t) => t.stop()); }
  function pause() { if (state === "recording") { rec.current.pause(); clearInterval(timer.current); setState("paused"); } else if (state === "paused") { rec.current.resume(); timer.current = setInterval(() => { secsRef.current += 1; setSecs(secsRef.current); if (maxSeconds && secsRef.current >= maxSeconds) stop(); }, 1000); setState("recording"); } }
  const discard = () => { cleanup(); if (blobUrl) URL.revokeObjectURL(blobUrl); onCancel(); };
  const send = () => { if (secsRef.current < 1) { setErr("That was too short. Hold on a little longer."); return; } onSend(result.current.blob, secsRef.current, result.current.type); };
  const Btn = ({ onClick, label, children, strong }) => <button onClick={onClick} aria-label={label} className="lo-tap" style={{ width: 40, height: 40, borderRadius: "50%", border: strong ? "none" : `1px solid ${C.line}`, background: strong ? "var(--lo-grad)" : C.surface2, color: strong ? "#fff" : C.text, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>{children}</button>;

  if (state === "error") return (
    <div className="flex items-center gap-3" style={{ padding: "12px 14px" }}>
      <div style={{ flex: 1, fontSize: 13, color: C.flag }}>{err}</div><Btn onClick={onCancel} label="Close"><Trash2 size={16} /></Btn>
    </div>
  );
  return (
    <div className="flex items-center gap-2" style={{ padding: "10px 12px calc(10px + env(safe-area-inset-bottom, 0px))" }}>
      <Btn onClick={discard} label="Discard recording"><Trash2 size={17} color={C.flag} /></Btn>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 22, padding: "8px 14px" }}>
        {state === "preview" ? (
          <>
            <audio ref={audioRef} src={blobUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
            <button onClick={() => (playing ? audioRef.current.pause() : audioRef.current.play())} aria-label={playing ? "Pause preview" : "Play preview"} style={{ border: "none", background: "transparent", color: C.mustard, cursor: "pointer", display: "flex" }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
            <span style={{ ...monoFont, fontSize: 13 }}>{mmss(secs)}</span><span style={{ fontSize: 12.5, color: C.muted }}>Preview</span>
          </>
        ) : (
          <>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: C.flag, opacity: state === "recording" ? 1 : 0.4, animation: state === "recording" ? "pulse 1s infinite" : "none" }} />
            <span style={{ ...monoFont, fontSize: 13 }}>{mmss(secs)}</span>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 2, height: 22 }}>
              {Array.from({ length: 24 }).map((_, i) => <span key={i} style={{ flex: 1, maxWidth: 4, borderRadius: 2, background: C.mustard, height: `${12 + Math.abs(Math.sin(i * 1.7 + secs)) * level * 88}%`, opacity: state === "recording" ? 0.9 : 0.3, transition: "height .08s" }} />)}
            </div>
            {maxSeconds ? <span style={{ ...monoFont, fontSize: 11, color: C.muted }}>{mmss(Math.max(0, maxSeconds - secs))}</span> : null}
          </>
        )}
      </div>
      {state === "recording" || state === "paused" ? (<><Btn onClick={pause} label={state === "paused" ? "Resume" : "Pause"}>{state === "paused" ? <Mic size={17} /> : <Pause size={17} />}</Btn><Btn onClick={stop} label="Stop and preview" strong><Square size={15} /></Btn></>)
        : state === "preview" ? <Btn onClick={send} label="Send voice note" strong><Send size={17} /></Btn> : null}
      {err && state !== "error" && <div role="alert" style={{ position: "absolute", bottom: "100%", left: 12, right: 12, fontSize: 12.5, color: C.flag, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 10px" }}>{err}</div>}
    </div>
  );
}
