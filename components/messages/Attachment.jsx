"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, FileText, Download, FileSpreadsheet, FileArchive, Image as ImageIcon } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";

const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
const bytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : (n || 0) + " B");
// Deterministic pseudo-waveform from the URL so a note always looks the same for both people.
function bars(seed, n = 28) { let h = 7; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return Array.from({ length: n }, () => { h = (h * 1664525 + 1013904223) >>> 0; return 0.25 + (h % 1000) / 1000 * 0.75; }); }

function VoiceNote({ a, mine }) {
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(a.dur || 0);
  const [rate, setRate] = useState(1);
  const fg = mine ? "#fff" : C.mustard;
  const heights = useRef(bars(a.url)).current;
  useEffect(() => () => ref.current?.pause(), []);
  function toggle() {
    const el = ref.current; if (!el) return;
    if (playing) el.pause(); else { document.querySelectorAll("audio[data-dm]").forEach((x) => x !== el && x.pause()); el.play().catch(() => {}); }
  }
  function seek(e) { const el = ref.current; const r = e.currentTarget.getBoundingClientRect(); if (el && dur) el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur; }
  function cycle() { const n = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(n); if (ref.current) ref.current.playbackRate = n; }
  const pct = dur ? t / dur : 0;
  return (
    <div className="flex items-center gap-2" style={{ minWidth: 210 }}>
      <audio ref={ref} data-dm src={a.url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setT(0); }}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDur(d); }} />
      <button onClick={toggle} aria-label={playing ? "Pause voice note" : "Play voice note"} className="lo-tap" style={{ width: 36, height: 36, borderRadius: "50%", background: mine ? "rgba(255,255,255,.22)" : alpha(C.mustard, 18), border: "none", color: fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
        {playing ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
      </button>
      <div onClick={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 2, height: 30, cursor: "pointer" }}>
        {heights.map((h, i) => <span key={i} style={{ width: 3, height: `${h * 100}%`, borderRadius: 2, background: fg, opacity: i / heights.length <= pct ? 1 : 0.35 }} />)}
      </div>
      <div className="flex flex-col items-end" style={{ ...monoFont, fontSize: 11, lineHeight: 1.2, minWidth: 34 }}>
        <span>{mmss(playing || t ? t : dur)}</span>
        <button onClick={cycle} aria-label="Playback speed" style={{ border: "none", background: "transparent", color: "inherit", opacity: 0.85, fontSize: 11, cursor: "pointer", padding: 0 }}>{rate}x</button>
      </div>
    </div>
  );
}

function FileCard({ a, mine }) {
  const ext = (a.name?.split(".").pop() || "").toLowerCase();
  const Icon = ["xls", "xlsx", "csv"].includes(ext) ? FileSpreadsheet : ["zip"].includes(ext) ? FileArchive : ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? ImageIcon : FileText;
  const isImage = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) && a.mime?.startsWith("image/");
  return (
    <div style={{ minWidth: 200, maxWidth: 280 }}>
      {isImage && <a href={a.url} target="_blank" rel="noopener noreferrer"><img src={a.url} alt={a.name} loading="lazy" style={{ width: "100%", borderRadius: 10, display: "block", marginBottom: 6 }} /></a>}
      <a href={a.url} target="_blank" rel="noopener noreferrer" download={a.name} className="flex items-center gap-3" style={{ textDecoration: "none", color: "inherit" }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: mine ? "rgba(255,255,255,.2)" : alpha(C.mustard, 16), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={19} color={mine ? "#fff" : C.mustard} /></span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
          <span style={{ ...monoFont, fontSize: 11, opacity: 0.8 }}>{ext.toUpperCase() || "FILE"} · {bytes(a.size)}</span>
        </span>
        <Download size={16} style={{ opacity: 0.85, flexShrink: 0 }} />
      </a>
    </div>
  );
}

export function isMediaOnly(m) { return m.attachment && (m.attachment.type === "gif" || m.attachment.type === "sticker") && !m.text; }

export default function Attachment({ m }) {
  const a = m.attachment; if (!a) return null;
  if (a.type === "voice") return <VoiceNote a={a} mine={m.mine} />;
  if (a.type === "file") return <FileCard a={a} mine={m.mine} />;
  return <img src={a.url} alt={a.title || (a.type === "sticker" ? "Sticker" : "GIF")} loading="lazy" style={{ display: "block", maxWidth: 220, width: "100%", borderRadius: 12 }} />;
}
