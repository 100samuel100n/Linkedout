"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, BarChart3, Lock, Send, Inbox, CheckCircle2, Clock } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="lo-card" style={{ padding: 16, flex: "1 1 150px", minWidth: 150 }}>
      <div className="flex items-center gap-2" style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>{Icon && <Icon size={15} />}{label}</div>
      <div style={{ fontSize: 28, fontWeight: 750, letterSpacing: "-0.02em", color: C.text, marginTop: 6 }}>{value ?? "—"}</div>
      {hint && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

// Message analytics — OUT PRO. Aggregates only; never reveals who declined.
export default function MessageAnalytics() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { api.getMessageAnalytics().then(setD).catch((e) => setErr(e.message)); }, []);
  const max = Math.max(1, ...(d?.daily || []).map((x) => x.sent + x.received));
  const hour = d?.busiestHourUtc != null ? `${String(d.busiestHourUtc).padStart(2, "0")}:00 UTC` : "—";
  return (
    <div className="flex flex-col gap-5" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
      <Link href="/messages" className="inline-flex items-center gap-1" style={{ color: C.muted, textDecoration: "none", fontSize: 14 }}><ChevronLeft size={16} /> Messages</Link>
      <PageHeader title="Message analytics" subtitle="How your conversations are going over the last 30 days." />
      {err && <ErrorNote>{err}</ErrorNote>}
      {!d && !err && <Loading />}
      {d?.locked && (
        <div className="lo-card"><EmptyState icon={Lock} title="Message analytics is part of OUT PRO" actionLabel="Compare plans" href="/premium">See how many requests get accepted, how fast people reply, and when your messages land best.</EmptyState></div>
      )}
      {d && !d.locked && (
        <>
          <div className="flex gap-3 flex-wrap">
            <Stat icon={Send} label="Messages sent" value={d.sent} />
            <Stat icon={Inbox} label="Messages received" value={d.received} hint={d.replyRatio != null ? `${d.replyRatio}% of what you sent` : undefined} />
            <Stat icon={CheckCircle2} label="Request acceptance" value={d.acceptRate != null ? `${d.acceptRate}%` : "—"} hint={`${d.requestsAccepted} of ${d.requestsSent} accepted`} />
            <Stat icon={Clock} label="Median time to accept" value={d.medianAcceptMinutes != null ? (d.medianAcceptMinutes < 60 ? `${d.medianAcceptMinutes}m` : `${Math.round(d.medianAcceptMinutes / 60)}h`) : "—"} />
          </div>
          <div className="flex gap-3 flex-wrap">
            <Stat label="Active conversations" value={d.activeConversations} />
            <Stat label="Awaiting a reply" value={d.requestsPending} hint="Requests you sent" />
            <Stat label="Requests for you" value={d.incomingPending} />
            <Stat label="Your busiest hour" value={hour} />
          </div>
          <div className="lo-card" style={{ padding: 18 }}>
            <div className="flex items-center gap-2" style={{ fontWeight: 650, color: C.text, marginBottom: 14 }}><BarChart3 size={17} color={C.muted} /> Daily activity</div>
            {d.daily.length === 0 ? <div style={{ color: C.muted, fontSize: 14 }}>No messages in this period yet.</div> : (
              <>
                <div className="flex items-end gap-1" style={{ height: 120 }} role="img" aria-label="Daily messages sent and received">
                  {d.daily.map((x) => (
                    <div key={x.day} title={`${x.day}: ${x.sent} sent, ${x.received} received`} style={{ flex: 1, minWidth: 4, height: `${Math.max(6, ((x.sent + x.received) / max) * 100)}%`, display: "flex", flexDirection: "column-reverse", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ flex: x.sent, background: "var(--lo-grad)" }} />
                      <div style={{ flex: x.received, background: C.surface3 }} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4" style={{ marginTop: 12, fontSize: 13, color: C.muted }}>
                  <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--lo-grad)" }} /> Sent</span>
                  <span className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 3, background: C.surface3 }} /> Received</span>
                </div>
              </>
            )}
          </div>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>Only totals are shown. Linkedout never tells you who declined a request: a request that was not accepted is simply "not accepted".</p>
        </>
      )}
    </div>
  );
}
