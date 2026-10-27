"use client";
import { useSubmitLock } from "@/lib/useSubmitLock";
import ErrorNote from "@/components/ErrorNote";
import { useState, useRef } from "react";
import Link from "next/link";
import { User, PenSquare, Radio, EyeOff, Send, Image as ImageIcon, X, Plus, Trophy, Calendar, Clock, Pin } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { Modal } from "@/components/primitives";
import { POST_TYPES, IDENTITY_MODES, MOODS, CATEGORIES, VISIBILITY_OPTIONS } from "@/lib/data";
import { useAuth } from "@/app/auth-provider";
import Select from "@/components/ui/Select";

const IDENTITY_ICONS = { real: User, alias: PenSquare, anon: EyeOff };
const TYPE_KEY = { "Humble-Brag Parody": "parody" };

export default function ComposerModal({ open, onClose, onSubmit }) {
  const { user, loading } = useAuth();
  const [type, setType] = useState("Rant");
  const [identity, setIdentity] = useState("alias");
  const [mood, setMood] = useState(MOODS[0]);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [scheduledAt, setScheduledAt] = useState("");
  const [pinned, setPinned] = useState(false);
  const [cringeNominated, setCringeNominated] = useState(false);
  const [mediaFile, setMediaFile] = useState(null);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [pollMultiSelect, setPollMultiSelect] = useState(false);
  const [eventAt, setEventAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState(null);
  const { busy, run: runLocked } = useSubmitLock();
  const fileInputRef = useRef(null);

  const isPoll = type === "Poll";
  const isEvent = type === "Event";
  const typeKey = TYPE_KEY[type] || type.toLowerCase();

  function reset() {
    setText(""); setTitle(""); setCategory(""); setTagsInput(""); setVisibility("public");
    setScheduledAt(""); setPinned(false); setCringeNominated(false); setMediaFile(null);
    setPollOptions(["", ""]); setPollMultiSelect(false); setEventAt(""); setEventLocation(""); setShowAdvanced(false);
  }

  function handlePost() {
    if (!text.trim()) return;
    if (isPoll && pollOptions.filter((o) => o.trim()).length < 2) {
      setError("Polls need at least 2 options.");
      return;
    }
    return runLocked(doPost);
  }

  async function doPost() {
    setError(null);
    try {
      const form = new FormData();
      form.set("type", typeKey);
      form.set("mood", mood);
      form.set("mode", identity);
      form.set("text", text);
      form.set("tags", JSON.stringify([type, ...tagsInput.split(",").map((t) => t.trim()).filter(Boolean)]));
      if (title.trim()) form.set("title", title.trim());
      if (category) form.set("category", category);
      form.set("visibility", visibility);
      if (scheduledAt) form.set("scheduledAt", new Date(scheduledAt).toISOString());
      if (cringeNominated) form.set("cringeNominated", "1");
      if (mediaFile) form.set("media", mediaFile);
      if (isPoll) {
        form.set("pollOptions", JSON.stringify(pollOptions.map((o) => o.trim()).filter(Boolean)));
        if (pollMultiSelect) form.set("multiSelect", "1");
      }
      if (isEvent) {
        if (eventAt) form.set("eventAt", new Date(eventAt).toISOString());
        if (eventLocation.trim()) form.set("eventLocation", eventLocation.trim());
      }

      const created = await onSubmit(form);
      if (pinned && created?.id) {
        const { api } = await import("@/lib/api");
        await api.pinPost(created.id, true);
      }
      reset();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) setMediaFile(file);
    e.target.value = "";
  }

  if (!loading && !user) {
    return (
      <Modal open={open} onClose={onClose} title="New Pulse post" icon={Radio}>
        <p style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
          You need an account to post — even anonymous posts are backed by a
          verified account behind the scenes, just never shown. Nobody sees
          which account posted what unless you choose "Real Name."
        </p>
        <Link
          href="/login"
          onClick={onClose}
          style={{ ...monoFont, fontSize: 12.5, color: "#FFFFFF", background: C.mustard, borderRadius: 8, padding: "9px 16px", fontWeight: 700, textAlign: "center", textDecoration: "none" }}
        >Log in to post</Link>
      </Modal>
    );
  }

  const inputStyle = { width: "100%", background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "8px 10px", fontSize: 13 };

  return (
    <Modal open={open} onClose={onClose} title="New Pulse post" icon={Radio}>
      <div className="flex gap-2 flex-wrap">
        {POST_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            style={{
              ...monoFont, fontSize: 12, padding: "5px 10px", borderRadius: 20,
              border: `1px solid ${type === t ? C.mustard : C.line}`,
              color: type === t ? C.mustard : C.muted, background: "transparent",
            }}
          >{t}</button>
        ))}
      </div>

      <div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Post as</div>
        <div className="flex gap-2 flex-wrap">
          {IDENTITY_MODES.map((m) => {
            const Icon = IDENTITY_ICONS[m.key];
            const active = identity === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setIdentity(m.key)}
                className="flex items-center gap-1.5"
                style={{
                  ...monoFont, fontSize: 12, padding: "5px 10px", borderRadius: 8,
                  border: `1px solid ${active ? C.mustard : C.line}`,
                  color: active ? C.mustard : C.muted, background: active ? alpha(C.mustard, 8) : "transparent",
                }}
              ><Icon size={12} /> {m.label}</button>
            );
          })}
        </div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 6 }}>
          {identity === "real" && `posts as ${user?.realName || "your real name"}`}
          {identity === "alias" && `posts as ${user?.pseudonym || "your pseudonym"} — persistent, reused across your posts`}
          {identity === "anon" && "posts under a brand-new anonymous identity, used once"}
        </div>
      </div>

      <div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>Career mood</div>
        <Select value={mood} onChange={(e) => setMood(e.target.value)} style={inputStyle}>
          {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={isPoll ? "What's the poll question?" : "What actually happened today..."}
        rows={5}
        maxLength={500}
        style={{ ...inputStyle, resize: "none" }}
      />

      {isPoll && (
        <div className="flex flex-col gap-2">
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase" }}>Poll options</div>
          {pollOptions.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={opt}
                onChange={(e) => setPollOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                placeholder={`Option ${i + 1}`}
                maxLength={80}
                style={inputStyle}
              />
              {pollOptions.length > 2 && (
                <button onClick={() => setPollOptions((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer" }}>
                  <X size={14} color={C.muted} />
                </button>
              )}
            </div>
          ))}
          {pollOptions.length < 6 && (
            <button
              onClick={() => setPollOptions((prev) => [...prev, ""])}
              className="flex items-center gap-1.5"
              style={{ ...monoFont, fontSize: 12, color: C.mustard, background: "none", border: "none", cursor: "pointer", alignSelf: "flex-start" }}
            ><Plus size={13} /> add option</button>
          )}
          <label className="flex items-center gap-2" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={pollMultiSelect} onChange={(e) => setPollMultiSelect(e.target.checked)} />
            <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>Allow multiple selections</span>
          </label>
        </div>
      )}

      {isEvent && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Calendar size={14} color={C.muted} />
            <input type="datetime-local" value={eventAt} onChange={(e) => setEventAt(e.target.value)} style={inputStyle} />
          </div>
          <input value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} placeholder="Location (e.g. Virtual, link in comments)" maxLength={100} style={inputStyle} />
        </div>
      )}

      {mediaFile && (
        <div className="flex items-center justify-between" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px" }}>
          <span style={{ ...monoFont, fontSize: 12, color: C.text }}>{mediaFile.name}</span>
          <button onClick={() => setMediaFile(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={13} color={C.muted} /></button>
        </div>
      )}

      <button
        onClick={() => setShowAdvanced((s) => !s)}
        style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
      >{showAdvanced ? "− fewer options" : "+ title, tags, category, visibility, schedule, pin, attach a file"}</button>

      {showAdvanced && (
        <div className="flex flex-col gap-2" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" maxLength={100} style={inputStyle} />
          <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="Extra tags, comma separated (optional)" style={inputStyle} />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
            <option value="">No category</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} style={inputStyle}>
            {VISIBILITY_OPTIONS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </Select>
          <div className="flex items-center gap-2">
            <Clock size={14} color={C.muted} />
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={inputStyle} />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: C.text, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
              <ImageIcon size={13} /> Attach image/video/audio/document
            </button>
            <input ref={fileInputRef} type="file" onChange={handleFileChange} style={{ display: "none" }} accept="image/*,video/*,audio/*,.pdf,.doc,.docx" />
            <label className="flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: C.text, cursor: "pointer" }}>
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              <Pin size={12} /> Pin to my profile
            </label>
            <label className="flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: C.mustard, cursor: "pointer" }}>
              <input type="checkbox" checked={cringeNominated} onChange={(e) => setCringeNominated(e.target.checked)} />
              <Trophy size={12} /> Submit to Cringe Awards
            </label>
          </div>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center justify-between">
        <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{text.length}/500</span>
        <button
          onClick={handlePost}
          disabled={!text.trim() || busy}
          className="flex items-center gap-1.5"
          style={{
            background: text.trim() ? C.mustard : C.surface2, color: text.trim() ? "#FFFFFF" : C.muted,
            fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: "8px 16px", border: "none",
            cursor: text.trim() ? "pointer" : "default",
          }}
        >{busy ? <Send size={13} className="lo-spin" /> : <Send size={13} />} {busy ? "Posting…" : "Post"}</button>
      </div>
    </Modal>
  );
}
