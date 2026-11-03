"use client";
import ErrorNote from "@/components/ErrorNote";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeftRight, Sparkles, Copy, Check } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { useAuth } from "@/app/auth-provider";
import { api } from "@/lib/api";

// Renamed from the old literal "Title Translator" — the feature is
// comedy first (see lib/ai.js's system prompt), so the name should read
// that way too. Route/API stay at /title-translator under the hood so
// nothing breaks; only the user-facing label changed.
const FEATURE_NAME = "Humble Brag Translator";

const EXAMPLES = {
  "real-to-hype": ["answers emails all day", "got laid off, technically", "does the job of 3 people"],
  "hype-to-real": ["Chief Vision Officer", "Growth Hacking Ninja", "Synergy Evangelist"],
};

export default function TitleTranslatorPage() {
  const { user } = useAuth();
  const [direction, setDirection] = useState("real-to-hype");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(null);

  useEffect(() => {
    api.getAiStatus().then((s) => setAiConfigured(s.configured)).catch(() => setAiConfigured(false));
  }, []);

  async function translate() {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const result = await api.translateTitle(input.trim(), direction);
      setOutput(result);
    } catch (e) {
      setError(e.status === 401 ? `Log in to use the ${FEATURE_NAME}.` : e.message);
    } finally {
      setBusy(false);
    }
  }

  function swapDirection() {
    setDirection((d) => (d === "real-to-hype" ? "hype-to-real" : "real-to-hype"));
    setInput(output?.output || "");
    setOutput(null);
  }

  function copyOutput() {
    if (!output) return;
    navigator.clipboard.writeText(output.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const inputStyle = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "10px 12px", fontSize: 13.5, width: "100%" };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div style={{ ...displayFont, fontSize: 21, fontWeight: 800, color: C.text }} className="flex items-center gap-2">
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34,
            borderRadius: 10, background: alpha(C.corpblue, 15), color: C.corpblue, flexShrink: 0,
          }}><Sparkles size={18} /></span>
          {FEATURE_NAME}
        </div>
        <p style={{ fontSize: 12.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
          Inflate an honest job title into full corporate hype, or decode someone else's humblebrag back into plain English. Powered by AI, judged by no one but us.
        </p>
        {aiConfigured === false && (
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 8, background: alpha(C.corpblue, 10), border: `1px solid ${alpha(C.corpblue, 33)}`, borderRadius: 8, padding: "6px 10px" }}>
            Preview mode — showing curated examples until the live AI backend is connected on this deployment.
          </div>
        )}
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-center gap-3">
          <div className="flex-1 text-center" style={{ ...monoFont, fontSize: 12, fontWeight: direction === "real-to-hype" ? 700 : 400, color: direction === "real-to-hype" ? C.mustard : C.muted, transition: "color 0.18s ease" }}>HONEST</div>
          <button onClick={swapDirection} className="lo-tap" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <ArrowLeftRight size={14} color={C.muted} />
          </button>
          <div className="flex-1 text-center" style={{ ...monoFont, fontSize: 12, fontWeight: direction === "hype-to-real" ? 700 : 400, color: direction === "hype-to-real" ? C.corpblue : C.muted, transition: "color 0.18s ease" }}>HUMBLEBRAG</div>
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={direction === "real-to-hype" ? "e.g. 'answers emails and sits in meetings'" : "e.g. 'Chief Growth Evangelist'"}
          rows={3}
          maxLength={300}
          style={{ ...inputStyle, resize: "none" }}
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLES[direction].map((ex) => (
            <button key={ex} onClick={() => setInput(ex)} style={{ ...monoFont, fontSize: 12, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 20, padding: "4px 10px", background: "none", cursor: "pointer" }}>{ex}</button>
          ))}
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        <button
          onClick={translate}
          disabled={!input.trim() || busy || !user}
          className="flex items-center justify-center gap-2"
          style={{ ...monoFont, fontSize: 12.5, color: "#FFFFFF", background: input.trim() && user ? C.mustard : C.surface2, border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700, cursor: input.trim() && user ? "pointer" : "default" }}
        >{busy && <Sparkles size={13} className="lo-spin" />} {busy ? "translating…" : !user ? "Log in to translate" : "Translate"}</button>

        {output && (
          <div className="lo-enter flex items-start justify-between gap-3" style={{ background: alpha(C.corpblue, 8), border: `1px solid ${alpha(C.corpblue, 33)}`, borderRadius: 8, padding: 14 }}>
            <p style={{ fontSize: 15, color: C.text, lineHeight: 1.5, fontWeight: 600 }}>{output.output}</p>
            <button onClick={copyOutput} className="lo-tap" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", flexShrink: 0 }}>
              {copied ? <Check size={15} color={C.green} /> : <Copy size={15} />}
            </button>
          </div>
        )}
      </div>

      <Link href="/profile" style={{ ...monoFont, fontSize: 12, color: C.mustard, textDecoration: "none" }}>← Back to profile</Link>
    </div>
  );
}
