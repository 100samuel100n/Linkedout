"use client";
import { useState } from "react";
import Link from "next/link";
import { Languages } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { Chip } from "@/components/stories/StoryBits";
import PageHeader from "@/components/ui/PageHeader";
import ErrorNote from "@/components/ErrorNote";

const KINDS = [["corporate", "Corporate Speak", "We're realigning to position ourselves for sustainable growth."], ["hr", "HR Speak", "We need to have a conversation."], ["job", "Job Posting", "Fast-paced environment, must wear many hats."], ["meeting", "Meeting Speak", "Let's take this offline and circle back."]];

export default function Translator() {
  const { user } = useAuth();
  const [kind, setKind] = useState("corporate");
  const [text, setText] = useState(""); const [out, setOut] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  async function go(ai) {
    setBusy(true); setErr(null);
    try { setOut(await api.speakTranslate(kind, text, ai)); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const eg = KINDS.find((k) => k[0] === kind)[2];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Reality Translator" title="What they said, and what it probably means" subtitle="Interpretations of common workplace language, not statements about any company. For the title translator, see below." />
      <div className="flex gap-1.5 flex-wrap">{KINDS.map(([k, l]) => <Chip key={k} active={kind === k} onClick={() => { setKind(k); setOut(null); }}>{l}</Chip>)}</div>
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={600} placeholder={`Paste something. e.g. “${eg}”`} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, padding: 12, fontSize: 15, fontFamily: "inherit" }} />
      <div className="flex gap-2 flex-wrap">
        <button disabled={busy || !text.trim()} onClick={() => go(false)} className="lo-btn lo-btn-primary">Translate (free glossary)</button>
        <button disabled={busy || !text.trim() || !user} onClick={() => go(true)} className="lo-btn lo-btn-secondary" title={user ? "" : "Log in"}>Interpret any text with AI <span style={{ opacity: .6 }}>OUT+</span></button>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {out && (
        <div className="flex flex-col gap-3">
          {out.matches.length === 0 && !out.ai && <div className="lo-card" style={{ padding: 14, fontSize: 14.5, color: C.muted }}>No phrase from our glossary matched. OUT+ members can have any text interpreted by AI.</div>}
          {out.matches.map((m) => (
            <div key={m.phrase} className="lo-card flex flex-col gap-1" style={{ padding: 14 }}>
              <div style={{ ...monoFont, fontSize: 12.5, color: C.mustard, fontWeight: 700 }}>“{m.phrase}”</div>
              <div style={{ fontSize: 15, color: C.text }}>Often means: {m.meaning}</div>
              <div style={{ fontSize: 13.5, color: C.muted }}>Worth asking: {m.ask}</div>
            </div>
          ))}
          {out.ai && <div className="lo-card flex flex-col gap-1" style={{ padding: 14 }}><div style={{ ...monoFont, fontSize: 12.5, color: C.mustard, fontWeight: 700 }}>AI interpretation · confidence {out.ai.confidence}</div><div style={{ fontSize: 15, color: C.text }}>{out.ai.meaning}</div>{out.ai.ask && <div style={{ fontSize: 13.5, color: C.muted }}>Worth asking: {out.ai.ask}</div>}</div>}
          {out.aiNote && <div style={{ fontSize: 13.5, color: C.muted }}>{out.aiNote} {out.code === "PLAN_REQUIRED" && <Link href="/premium" style={{ color: C.mustard }}>See plans</Link>}</div>}
          <div style={{ fontSize: 12.5, color: C.muted }}>{out.disclaimer}</div>
        </div>
      )}
      <Link href="/title-translator" className="lo-card lo-tap flex items-center gap-2" style={{ padding: 12, textDecoration: "none", color: C.text }}><Languages size={16} color={C.mustard} /> Job title translator</Link>
    </div>
  );
}
