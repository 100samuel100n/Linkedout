"use client";
import ErrorNote from "@/components/ErrorNote";
import { useState, useRef } from "react";
import { useSubmitLock } from "@/lib/useSubmitLock";
import { Paperclip, Smile, Send, X } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { useAuth } from "@/app/auth-provider";
import { api } from "@/lib/api";
import EmojiPicker from "./EmojiPicker";
import GifPicker from "./GifPicker";

export default function ReplyComposer({ postId, onPosted }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [gifUrl, setGifUrl] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const { busy, run: runLocked } = useSubmitLock();
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  if (!user) {
    return (
      <div style={{ ...monoFont, fontSize: 12, color: C.muted, textAlign: "center", padding: "16px 0" }}>
        Log in to reply.
      </div>
    );
  }

  function submit() {
    if (!text.trim() && !file && !gifUrl) return;
    return runLocked(doSubmit);
  }

  async function doSubmit() {
    setError(null);
    try {
      let comment;
      if (file) {
        const form = new FormData();
        form.set("text", text.trim());
        form.set("mode", "alias");
        if (gifUrl) form.set("gifUrl", gifUrl);
        form.set("media", file);
        comment = await api.addComment(postId, form);
      } else {
        comment = await api.addComment(postId, { text: text.trim(), mode: "alias", gifUrl });
      }
      setText("");
      setFile(null);
      setGifUrl(null);
      onPosted?.(comment);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-3 flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Post your reply"
        rows={2}
        style={{ ...monoFont, fontSize: 13, background: "none", border: "none", outline: "none", color: C.text, resize: "none" }}
      />

      {file && (
        <div className="flex items-center gap-2" style={{ background: C.surface2, borderRadius: 8, padding: "6px 10px" }}>
          <span style={{ ...monoFont, fontSize: 12, color: C.text, flex: 1 }}>{file.name}</span>
          <button onClick={() => setFile(null)} className="lo-tap" style={{ background: "none", border: "none", cursor: "pointer" }}><X size={13} color={C.muted} /></button>
        </div>
      )}
      {gifUrl && (
        <div className="relative" style={{ width: 140 }}>
          <img src={gifUrl} alt="" style={{ width: "100%", borderRadius: 8, display: "block" }} />
          <button onClick={() => setGifUrl(null)} className="lo-tap" style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.6)", border: "none", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={11} color="#fff" />
          </button>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3" style={{ position: "relative" }}>
          <button onClick={() => fileInputRef.current?.click()} className="lo-tap" style={{ background: "none", border: "none", color: C.corpblue, cursor: "pointer" }}>
            <Paperclip size={16} />
          </button>
          <input ref={fileInputRef} type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ display: "none" }} accept="image/*,video/*,audio/*,.pdf,.doc,.docx" />

          <div style={{ position: "relative" }}>
            <button onClick={() => { setShowGif((s) => !s); setShowEmoji(false); }} className="lo-tap" style={{ ...monoFont, fontSize: 12, fontWeight: 800, color: C.corpblue, background: "none", border: `1.5px solid ${C.corpblue}`, borderRadius: 4, padding: "1px 4px", cursor: "pointer", lineHeight: 1.4 }}>
              GIF
            </button>
            {showGif && <GifPicker onSelect={setGifUrl} onClose={() => setShowGif(false)} />}
          </div>

          <div style={{ position: "relative" }}>
            <button onClick={() => { setShowEmoji((s) => !s); setShowGif(false); }} className="lo-tap" style={{ background: "none", border: "none", color: C.mustard, cursor: "pointer" }}>
              <Smile size={16} />
            </button>
            {showEmoji && <EmojiPicker onSelect={(e) => setText((t) => t + e)} onClose={() => setShowEmoji(false)} />}
          </div>
        </div>

        <button
          onClick={submit}
          disabled={busy || (!text.trim() && !file && !gifUrl)}
          className="lo-tap flex items-center gap-1.5"
          style={{
            ...monoFont, fontSize: 12, fontWeight: 700, color: "#FFFFFF",
            background: (text.trim() || file || gifUrl) ? C.mustard : C.surface2,
            border: "none", borderRadius: 20, padding: "7px 16px", cursor: "pointer",
          }}
        >
          {busy && <Send size={12} className="lo-spin" />} {busy ? "Replying…" : "Reply"}
        </button>
      </div>
    </div>
  );
}
