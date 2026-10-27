"use client";
import ErrorNote from "@/components/ErrorNote";
import { useState, useRef } from "react";
import { Sparkles, Upload, FileText, X } from "lucide-react";
import { C, monoFont, sunken } from "@/lib/theme";
import { Modal } from "@/components/primitives";
import { api } from "@/lib/api";

export default function ResumeRoastModal({ open, onClose }) {
  const [stage, setStage] = useState("idle"); // idle | pasting | loading | roasting | done
  const [fileName, setFileName] = useState(null);
  const [pastedText, setPastedText] = useState("");
  const [lines, setLines] = useState([]);
  const [error, setError] = useState(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const fileInputRef = useRef(null);

  function reset() { setStage("idle"); setFileName(null); setPastedText(""); setLines([]); setError(null); }
  function close() { reset(); onClose(); }

  async function roast(payload) {
    setStage("loading");
    setError(null);
    try {
      const result = await api.getResumeRoast(payload);
      setLines(result.lines);
      setAiConfigured(result.configured);
      setStage("roasting");
    } catch (e) {
      setError(e.message);
      setStage("idle");
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    roast(file);
  }

  return (
    <Modal open={open} onClose={close} title="Roast My Resume" icon={Sparkles}>
      <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        Real AI, roasting your actual resume — opt-in, one-time, never stored against your public profile. An icebreaker, not a performance review.
      </p>

      {stage === "idle" && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="lo-tap flex flex-col items-center justify-center gap-2"
            style={{ border: `1px dashed ${C.line}`, borderRadius: 10, padding: "28px 12px", color: C.muted, background: C.surface2, cursor: "pointer" }}
          >
            <Upload size={20} />
            <span style={{ fontSize: 12.5 }}>Upload resume (PDF or .txt)</span>
          </button>
          <input ref={fileInputRef} type="file" accept="application/pdf,text/plain" onChange={handleFile} style={{ display: "none" }} />
          <button
            onClick={() => setStage("pasting")}
            className="lo-tap"
            style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: "none", cursor: "pointer", alignSelf: "center" }}
          >or paste your resume text instead</button>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      )}

      {stage === "pasting" && (
        <div className="flex flex-col gap-2">
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste your resume text here…"
            rows={8}
            style={{ ...monoFont, fontSize: 12, background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: 10, resize: "vertical" }}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <button
            onClick={() => roast(pastedText)}
            disabled={pastedText.trim().length < 20}
            className="lo-tap"
            style={{ ...monoFont, fontSize: 12, color: "#FFFFFF", background: pastedText.trim().length >= 20 ? C.mustard : C.surface2, border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer", alignSelf: "flex-start" }}
          >Roast it</button>
        </div>
      )}

      {(stage === "loading" || stage === "roasting" || stage === "done") && (
        <div className="flex items-center gap-2" style={{ fontSize: 12, color: C.muted, ...monoFont }}>
          <FileText size={13} /> {fileName || "pasted text"}
          {stage === "loading" && <button onClick={reset} className="lo-tap" style={{ background: "none", border: "none", cursor: "pointer", marginLeft: "auto" }}><X size={13} /></button>}
        </div>
      )}

      {stage === "loading" && (
        <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: C.muted }}>
          <Sparkles size={13} className="lo-spin" /> reading it and losing respect for you in real time…
        </div>
      )}

      {stage === "roasting" && (
        <div className="flex flex-col gap-2">
          {!aiConfigured && (
            <div style={{ ...monoFont, fontSize: 12, color: C.muted, background: C.surface2, borderRadius: 8, padding: "6px 10px" }}>
              Preview roast — the live AI backend isn't connected on this deployment yet, so these aren't personalized to your resume.
            </div>
          )}
          {error && <div style={{ ...monoFont, fontSize: 12, color: C.flag }}>couldn't reach the roast service: {error}</div>}
          {lines.map((line, i) => (
            <div
              key={i}
              className="lo-enter"
              style={{
                fontSize: 13, color: C.text, lineHeight: 1.5, background: sunken,
                border: `1px solid ${C.line}`, borderRadius: 8, padding: 10,
                animationDelay: `${i * 0.2}s`,
              }}
            >{line}</div>
          ))}
          {lines.length > 0 && (
            <button
              onClick={() => setStage("done")}
              className="lo-tap lo-enter"
              style={{
                ...monoFont, fontSize: 12, color: "#14151A", background: C.paper, border: "none",
                borderRadius: 6, padding: "8px 12px", fontWeight: 700, marginTop: 4, cursor: "pointer",
                animationDelay: `${lines.length * 0.2}s`,
              }}
            >I've suffered enough</button>
          )}
        </div>
      )}

      {stage === "done" && (
        <div className="flex flex-col gap-3 items-start">
          <p style={{ fontSize: 13, color: C.text }}>Onboarding complete. Your resume has been roasted, not stored. Welcome to LinkedOut.</p>
          <button onClick={close} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: "#FFFFFF", background: C.mustard, border: "none", borderRadius: 6, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>Done</button>
        </div>
      )}
    </Modal>
  );
}
