"use client";
import { useCallback, useEffect, useState } from "react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Card, Pill, Err, inp, muted, useDo, on, can, Locked } from "./ui";

// Events and AMAs, newsletter, and anonymous employee pulse.
export default function EngageTab({ id, meta }) {
  const [ev, setEv] = useState(null); const [nl, setNl] = useState(null); const [pu, setPu] = useState(null); const [err, setErr] = useState(null);
  const [e, setE] = useState({ kind: "webinar", title: "", description: "", startsAt: "", url: "" }); const [n, setN] = useState({ subject: "", body: "" }); const [p, setP] = useState({ title: "", questions: [] }); const [ans, setAns] = useState({});
  const load = useCallback(async () => {
    try {
      if (on(meta, "events")) setEv(await api.suite(id, "events"));
      if (on(meta, "newsletter") || can(meta, "announce.publish")) setNl(await api.suite(id, "newsletter").catch(() => null));
      if (on(meta, "pulse")) setPu(await api.suite(id, "pulse"));
    } catch (x) { setErr(x.message); }
  }, [id, meta]);
  useEffect(() => { load(); }, [load]);
  const { run, busy, err: aerr } = useDo(id, load);
  if (err) return <Err>{err}</Err>;
  return (
    <div className="flex flex-col gap-4"><Err>{aerr}</Err>
      {on(meta, "events") ? <Card title="Events and AMAs" sub="Career fairs, webinars, office tours, hiring events and “Ask us anything” sessions. People RSVP anonymously; you see totals only. AMA questions are asked anonymously and answered in the Employer tab's questions list.">
        {can(meta, "announce.publish") && <div className="flex flex-col gap-2"><div className="flex gap-2 flex-wrap"><select style={{ ...inp, width: 190 }} value={e.kind} onChange={(x) => setE({ ...e, kind: x.target.value })}>{(ev?.kinds || []).map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select><input style={inp} placeholder="Title" value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} /><input type="datetime-local" style={{ ...inp, width: 220 }} value={e.startsAt} onChange={(x) => setE({ ...e, startsAt: x.target.value })} /></div>
          <input style={inp} placeholder="Link to join (https://…)" value={e.url} onChange={(x) => setE({ ...e, url: x.target.value })} /><textarea rows={2} style={inp} placeholder="What it is and who it's for" value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} />
          <div><button className="lo-btn lo-btn-primary lo-btn-sm" disabled={busy} onClick={async () => { if (await run({ action: "event.save", ...e, startsAt: e.startsAt ? new Date(e.startsAt).toISOString() : "" })) setE({ kind: "webinar", title: "", description: "", startsAt: "", url: "" }); }}>Publish event</button></div></div>}
        {!ev ? <Loading variant="cards" /> : ev.events.map((x) => <div key={x.id} style={{ fontSize: 14, color: C.text, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}><div className="flex items-center gap-2 flex-wrap"><b>{x.title}</b><Pill>{x.kind.replace(/_/g, " ")}</Pill><span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{String(x.startsAt).slice(0, 16).replace("T", " ")} UTC · {x.rsvps} going{x.upcoming ? "" : " · past"}</span>{can(meta, "announce.publish") && <button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ marginLeft: "auto", color: C.flag }} onClick={() => run({ action: "event.delete", id: x.id })}>Delete</button>}</div>
          {x.questions.map((q) => <div key={q.id} style={{ color: C.text2, marginLeft: 10 }}>Q: {q.question} {q.status === "answered" ? <span style={{ color: C.green }}>(answered)</span> : <span style={{ color: C.mustard }}>(open)</span>}</div>)}</div>)}
      </Card> : <Locked id={id} feature="events" what="Events and AMAs" />}

      {nl && on(meta, "newsletter") ? <Card title="Company newsletter" sub={`Sent to followers as a notification. ${nl.followers != null ? nl.followers + " followers." : "Followers are shown once there are at least 5."} One every 6 days.`}>
        <input style={inp} placeholder="Subject" value={n.subject} onChange={(x) => setN({ ...n, subject: x.target.value })} /><textarea rows={3} style={inp} placeholder="News, openings, culture, opportunities" value={n.body} onChange={(x) => setN({ ...n, body: x.target.value })} />
        <div><button className="lo-btn lo-btn-primary lo-btn-sm" disabled={busy} onClick={async () => { const r = await run({ action: "newsletter.send", ...n }); if (r) setN({ subject: "", body: "" }); }}>Send to followers</button></div>
        {nl.sent.map((s) => <div key={s.id} style={{ fontSize: 13.5, color: C.text2 }}>{String(s.created_at).slice(0, 10)} · {s.subject} · {s.recipients} sent</div>)}</Card> : !on(meta, "newsletter") && <Locked id={id} feature="newsletter" what="The company newsletter" />}

      {on(meta, "pulse") ? <Card title="Employee pulse" sub={`Anonymous, aggregated. Only verified current employees can answer, nobody can see who did, and results appear after 8 answers. ${pu?.verifiedEmployees != null ? pu.verifiedEmployees + " verified employees have opted in to be counted." : ""}`}>
        {pu && <><div className="flex gap-1.5 flex-wrap">{pu.suggestions.map((q) => <button key={q} className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setP({ ...p, questions: p.questions.includes(q) ? p.questions.filter((x) => x !== q) : [...p.questions, q].slice(0, 5) })} style={{ border: `1px solid ${C.line}`, background: p.questions.includes(q) ? C.mustard : "transparent", color: p.questions.includes(q) ? "#fff" : C.text2 }}>{q}</button>)}</div>
          <div className="flex gap-2"><input style={inp} placeholder="Pulse name, e.g. Q4 check-in" value={p.title} onChange={(x) => setP({ ...p, title: x.target.value })} /><button className="lo-btn lo-btn-primary" disabled={busy || !p.questions.length} onClick={() => run({ action: "pulse.create", ...p })}>Open pulse</button></div>
          {pu.pulses.map((x) => <div key={x.id} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8, fontSize: 14, color: C.text }}><b>{x.title}</b> <Pill color={x.status === "open" ? C.green : C.muted}>{x.status}</Pill> <span style={{ color: C.muted }}>{x.responses} answers</span> {x.status === "open" && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => run({ action: "pulse.close", id: x.id })}>Close</button>}
            {x.hidden ? <div style={muted}>{x.note}</div> : x.questions.map((q) => <div key={q.q} style={{ marginTop: 4 }}>{q.q}<div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{q.positive}% positive · {q.neutral}% neutral · {q.negative}% negative</div></div>)}</div>)}</>}
      </Card> : <Locked id={id} feature="pulse" what="Pulse surveys" />}
    </div>
  );
}
