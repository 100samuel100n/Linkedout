"use client";
import { useCallback, useEffect, useState } from "react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Card, Pill, Err, inp, muted, useDo, can, on, Locked } from "./ui";

export default function ImproveTab({ id, meta }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [f, setF] = useState({ title: "", theme: "", target: "" });
  const load = useCallback(() => api.suite(id, "improve").then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { if (on(meta, "improvement")) load(); }, [load, meta]);
  const { run, busy, err: aerr } = useDo(id, load);
  if (!on(meta, "improvement")) return <Locked id={id} feature="improvement" what="Improvement tracking" />;
  if (err) return <Err>{err}</Err>;
  if (!d) return <Loading variant="cards" />;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Top issues" sub="Companies can't delete bad data. They can improve what people report. Pick an issue, start an initiative, and LinkedOut tracks the change.">
        {d.themes.filter((t) => t.reporters >= 3).slice(0, 6).map((t) => <div key={t.key} className="flex justify-between" style={{ fontSize: 14, color: C.text }}><span>{t.label}</span><span style={monoFont}>{t.reporters} people (90 days)</span></div>)}
        {!d.themes.some((t) => t.reporters >= 3) && <div style={muted}>No issue has 3 or more reports in the last 90 days.</div>}
      </Card>
      {can(meta, "initiatives.manage") && <Card title="Create an improvement initiative"><Err>{aerr}</Err>
        <input style={inp} placeholder="e.g. Management communication programme" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <select style={inp} value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })}><option value="">Which issue should this reduce?</option>{d.themes.map((t) => <option key={t.key} value={t.key}>{t.label} ({t.reporters})</option>)}</select>
        <input style={inp} placeholder="Target, e.g. fewer communication-related negative reports" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
        <div><button className="lo-btn lo-btn-primary" disabled={busy || !f.title || !f.theme} onClick={async () => { if (await run({ action: "initiative.save", ...f })) setF({ title: "", theme: "", target: "" }); }}>Start tracking</button></div></Card>}
      {d.initiatives.map((i) => <Card key={i.id} title={i.title} right={<Pill color={i.improved ? C.green : i.status === "done" ? C.corpblue : C.mustard}>{i.improved ? "You improved" : i.status.replace("_", " ")}</Pill>}>
        <div style={{ fontSize: 14, color: C.text }}>{i.text}</div>
        <div style={muted}>Issue: {i.themeLabel}{i.target ? ` · Target: ${i.target}` : ""} · running {i.ageDays} days · started at {i.baseline} people, now {i.current}</div>
        {can(meta, "initiatives.manage") && <div className="flex gap-2">{i.status !== "done" && <button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => run({ action: "initiative.save", id: i.id, status: "done" })}>Mark done</button>}<button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.flag }} onClick={() => confirm("Remove this initiative?") && run({ action: "initiative.delete", id: i.id })}>Remove</button></div>}
      </Card>)}
    </div>
  );
}
