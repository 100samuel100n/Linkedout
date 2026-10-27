"use client";
import { useEffect, useState } from "react";
import { Copy, Check, Share2, Mail, X, Link2 } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { shortUrl, shareText } from "@/lib/stories/share";

// Share a story: short link, copy, the device's own share sheet where it exists, and the common networks.
export default function ShareSheet({ story, id, onClose }) {
  const [copied, setCopied] = useState(false);
  const [canNative, setCanNative] = useState(false);
  const link = shortUrl(typeof window !== "undefined" ? window.location.origin : "", id);
  const text = shareText(story);
  useEffect(() => { setCanNative(typeof navigator !== "undefined" && !!navigator.share); }, []);
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt("Copy this link", link); } }
  const enc = encodeURIComponent;
  const targets = [
    ["WhatsApp", `https://wa.me/?text=${enc(`${text} ${link}`)}`],
    ["X", `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(link)}`],
    ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}`],
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${enc(link)}`],
    ["Telegram", `https://t.me/share/url?url=${enc(link)}&text=${enc(text)}`],
    ["Reddit", `https://www.reddit.com/submit?url=${enc(link)}&title=${enc(text)}`],
  ];
  return (
    <div role="dialog" aria-modal="true" aria-label="Share this story" onClick={onClose} style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 90, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="lo-toast" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: "18px 18px 0 0", width: "min(520px,100%)", padding: "16px 18px calc(18px + env(safe-area-inset-bottom, 0px))" }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <b style={{ fontSize: 16, color: C.text }}>Share this story</b>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 13.5, color: C.muted, marginBottom: 10, lineHeight: 1.45 }}>{text}</div>
        <div className="flex items-center gap-2" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 10px" }}>
          <Link2 size={15} color={C.muted} />
          <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Short link" style={{ flex: 1, background: "transparent", border: "none", color: C.text, ...monoFont, fontSize: 13, outline: "none", minWidth: 0 }} />
          <button onClick={copy} className="lo-btn lo-btn-secondary lo-btn-sm">{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button>
        </div>
        {canNative && <button onClick={() => navigator.share({ title: text, text, url: link }).catch(() => {})} className="lo-btn lo-btn-primary" style={{ width: "100%", marginTop: 10 }}><Share2 size={15} /> Share via…</button>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
          {targets.map(([n, href]) => <a key={n} href={href} target="_blank" rel="noopener noreferrer" className="lo-tap" style={{ textAlign: "center", border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 6px", fontSize: 13, color: C.text, textDecoration: "none", background: alpha(C.mustard, 5) }}>{n}</a>)}
          <a href={`mailto:?subject=${enc(text)}&body=${enc(`${text}\n${link}`)}`} className="lo-tap" style={{ textAlign: "center", border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 6px", fontSize: 13, color: C.text, textDecoration: "none", background: alpha(C.mustard, 5) }}><Mail size={13} style={{ display: "inline", marginRight: 4 }} />Email</a>
        </div>
      </div>
    </div>
  );
}
