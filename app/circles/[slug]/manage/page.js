"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Check, X, VolumeX, Ban, UserMinus, ShieldPlus, Crown, Archive, ArchiveRestore } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useDialog } from "@/components/Dialog";
import ErrorNote from "@/components/ErrorNote";
import Loading from "@/components/ui/Loading";

const field = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 14.5, width: "100%", fontFamily: "inherit" };
const Btn = ({ icon: I, label, onClick, danger }) => <button onClick={onClick} className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: danger ? C.flag : C.text2 }} title={label}><I size={14} /> {label}</button>;

export default function Manage({ params }) {
  const { slug } = use(params);
  const dialog = useDialog();
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.manageCircle(slug).then((x) => { setD(x); setEdit((e) => e || { description: x.circle.description, rules: x.circle.rules || "", joinMode: x.circle.joinMode }); }).catch((e) => setErr(e.message)), [slug]);
  useEffect(() => { load(); }, [load]);
  async function act(body) { try { setD(await api.manageCircleAction(slug, body)); setErr(null); } catch (e) { setErr(e.message); } }
  async function sure(title, message, body, label = "Confirm") { if (await dialog.confirm({ title, message, confirmLabel: label, danger: true })) act(body); }
  if (err && !d) return <ErrorNote>{err}</ErrorNote>;
  if (!d) return <Loading variant="cards" />;
  const c = d.circle; const owner = c.isOwner;
  const pending = d.members.filter((m) => m.state === "pending");
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/circles/${slug}`} className="inline-flex items-center gap-1" style={{ color: C.muted, textDecoration: "none", fontSize: 13.5 }}><ChevronLeft size={15} /> {c.name}</Link>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 760, color: C.text }}>Manage circle</h1>
      <div style={{ fontSize: 13.5, color: C.muted }}>Members appear as handles, so moderating never unmasks anyone. Every action is logged below.</div>
      {err && <ErrorNote>{err}</ErrorNote>}

      {pending.length > 0 && <section className="lo-card flex flex-col gap-2" style={{ padding: 16, borderColor: alpha(C.mustard, 45) }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 720, color: C.text }}>Waiting to join ({pending.length})</h2>
        {pending.map((m) => <div key={m.handle} className="flex items-center gap-2"><span style={{ ...monoFont, fontSize: 13, color: C.text2 }}>{m.handle}</span><span style={{ ...monoFont, fontSize: 12, color: C.muted }}>asked {m.joined}</span><span style={{ marginLeft: "auto" }} className="flex gap-1"><Btn icon={Check} label="Approve" onClick={() => act({ action: "approve", handle: m.handle })} /><Btn icon={X} label="Decline" danger onClick={() => act({ action: "deny", handle: m.handle })} /></span></div>)}
      </section>}

      <section className="lo-card flex flex-col gap-3" style={{ padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 720, color: C.text }}>Details and rules</h2>
        <textarea rows={3} style={{ ...field, lineHeight: 1.5 }} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={400} />
        <textarea rows={5} style={{ ...field, lineHeight: 1.5 }} placeholder="House rules" value={edit.rules} onChange={(e) => setEdit({ ...edit, rules: e.target.value })} maxLength={1500} />
        <div className="flex gap-2 flex-wrap">{[["open", "Anyone can join"], ["request", "Approve members"]].map(([k, l]) => <button key={k} onClick={() => setEdit({ ...edit, joinMode: k })} className="lo-btn lo-btn-sm" style={{ background: edit.joinMode === k ? C.mustard : "transparent", color: edit.joinMode === k ? "#fff" : C.text2, border: `1px solid ${edit.joinMode === k ? C.mustard : C.line}` }}>{l}</button>)}</div>
        <div><button onClick={() => act({ action: "update", patch: edit })} className="lo-btn lo-btn-primary lo-btn-sm">Save changes</button></div>
      </section>

      <section className="lo-card flex flex-col gap-2" style={{ padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 720, color: C.text }}>Members ({d.members.filter((m) => m.state !== "pending").length})</h2>
        {d.members.filter((m) => m.state !== "pending").map((m) => (
          <div key={m.handle} className="flex items-center gap-2 flex-wrap" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
            <span style={{ ...monoFont, fontSize: 13, color: C.text }}>{m.you ? "You" : m.handle}</span>
            <span style={{ ...monoFont, fontSize: 11.5, color: m.role === "owner" ? C.mustard : C.muted }}>{m.role}{m.state !== "active" ? ` · ${m.state}` : ""}</span>
            {!m.you && m.role !== "owner" && (
              <span style={{ marginLeft: "auto" }} className="flex gap-1 flex-wrap">
                {m.state === "muted" ? <Btn icon={VolumeX} label="Unmute" onClick={() => act({ action: "unmute", handle: m.handle })} /> : <Btn icon={VolumeX} label="Mute" onClick={() => act({ action: "mute", handle: m.handle })} />}
                {m.state === "banned" ? <Btn icon={Ban} label="Unban" onClick={() => act({ action: "unban", handle: m.handle })} /> : <Btn icon={Ban} label="Ban" danger onClick={() => sure("Ban this member?", "They'll be removed and can't rejoin.", { action: "ban", handle: m.handle }, "Ban")} />}
                <Btn icon={UserMinus} label="Remove" onClick={() => act({ action: "remove", handle: m.handle })} />
                {owner && (m.role === "mod" ? <Btn icon={ShieldPlus} label="Remove mod" onClick={() => act({ action: "unmod", handle: m.handle })} /> : <Btn icon={ShieldPlus} label="Make mod" onClick={() => act({ action: "mod", handle: m.handle })} />)}
                {owner && <Btn icon={Crown} label="Hand over" danger onClick={() => sure("Hand this circle over?", "They become the owner and you become a moderator.", { action: "transfer", handle: m.handle }, "Hand over")} />}
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="lo-card flex flex-col gap-2" style={{ padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 720, color: C.text }}>Recent stories</h2>
        <div style={{ fontSize: 12.5, color: C.muted }}>Removing a story takes it out of this circle only. It is not deleted and the author keeps it. Report it to LinkedOut if it breaks the site rules.</div>
        {d.stories.map((s) => <div key={s.id} className="flex items-center gap-2" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8 }}><Link href={`/stories/${s.id}`} style={{ fontSize: 14, color: C.text, textDecoration: "none", flex: 1 }}>{s.title}</Link><span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{s.time}</span><Btn icon={X} label="Remove from circle" danger onClick={() => act({ action: "remove_story", storyId: s.id })} /></div>)}
        {d.stories.length === 0 && <div style={{ fontSize: 14, color: C.muted }}>Nothing yet.</div>}
      </section>

      <section className="lo-card flex flex-col gap-2" style={{ padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 720, color: C.text }}>Activity log</h2>
        {d.log.map((l, i) => <div key={i} style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{l.time} · {l.action}{l.target ? ` · ${l.target}` : ""}{l.note ? ` · ${l.note}` : ""}</div>)}
      </section>

      {owner && <section className="lo-card flex gap-2 items-center" style={{ padding: 16 }}>
        {c.status === "archived" ? <Btn icon={ArchiveRestore} label="Restore circle" onClick={() => act({ action: "restore" })} /> : <Btn icon={Archive} label="Archive circle" danger onClick={() => sure("Archive this circle?", "It stops accepting stories and leaves the list. You can restore it later.", { action: "archive" }, "Archive")} />}
      </section>}
    </div>
  );
}
