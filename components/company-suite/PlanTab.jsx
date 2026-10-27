"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { BUSINESS_PLANS } from "@/lib/tiers";
import Loading from "@/components/ui/Loading";
import { Card, Err, inp, muted, can } from "./ui";
import PlanComparison from "./PlanComparison";

const HIGHLIGHTS = {
  business: ["Stories inbox with assignment, deadlines and private notes", "Response templates, drafts and an AI reply assistant", "Reputation trends, “what changed”, alerts, improvement tracking", "Hiring analytics, salary ranges, employer profile and showcase", "3 representatives"],
  business_pro: ["Everything in Business", "Approval workflows, case management, tone check and similar stories", "Industry benchmarks and salary comparison, full alert types and role routing", "CSV exports, printable PDF reports, audit log, brand analytics", "10 representatives with 7 roles, priority review"],
  enterprise: ["Everything in Business Pro", "Multi-level approval and escalation routing", "50+ representatives, custom roles", "SSO, API, ATS and scheduled reports are on the roadmap with your account team", "Talk to us"],
};
export default function PlanTab({ id, meta }) {
  const params = useSearchParams(); const [d, setD] = useState(null); const [err, setErr] = useState(null); const [interval, setIv] = useState("year");
  const [lead, setLead] = useState(null); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { api.getBusiness(id).then(setD).catch((e) => setErr(e.message)); }, [id]);
  async function buy(plan) { setBusy(true); setErr(null); try { const r = await api.businessCheckout({ companyId: id, plan, interval }); window.location.href = r.url; } catch (e) { setErr(e.message); setBusy(false); } }
  if (!d) return err ? <Err>{err}</Err> : <Loading variant="cards" />;
  const P = d.plan, active = P.plan !== "none", owner = can(meta, "billing.manage");
  const price = (p) => (p.custom ? "Custom" : `$${(interval === "year" ? p.annualMonthly : p.monthly).toFixed(0)}/mo`);
  return (
    <div className="flex flex-col gap-4">
      {params.get("status") === "success" && <div style={{ background: alpha(C.green, 12), border: `1px solid ${alpha(C.green, 35)}`, borderRadius: 12, padding: "10px 14px", fontSize: 14 }}>Thank you. Your plan activates as soon as payment is confirmed (usually seconds).</div>}
      <Err>{err}</Err>
      {meta.planSource === "admin_test" && <div style={{ background: alpha(C.mustard, 12), border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 12, padding: "10px 14px", fontSize: 14 }}>This plan was set by LinkedOut staff for testing. No payment is attached.</div>}
      <Card title="Plans" right={<span className="flex gap-1.5">{[["month", "Monthly"], ["year", "Annual (save ~12%)"]].map(([k, l]) => <button key={k} onClick={() => setIv(k)} className="lo-btn lo-btn-sm" style={{ background: interval === k ? C.mustard : "transparent", color: interval === k ? "#fff" : C.text2, border: `1px solid ${interval === k ? C.mustard : C.line}` }}>{l}</button>)}</span>}
        sub="Replying to stories, announcements, your FAQ and candidate questions are free for every verified company. Plans add insight, workflow and employer tools. They never buy removal, hiding, editing, ranking, or the identity of an author.">
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {Object.entries(BUSINESS_PLANS).map(([k, p]) => (
            <div key={k} className="lo-card flex flex-col gap-2" style={{ padding: 16, borderColor: P.plan === k ? C.mustard : undefined }}>
              <div style={{ fontWeight: 730, fontSize: 17, color: C.text }}>{p.name}{P.plan === k ? " · current" : ""}</div>
              <div style={{ fontSize: 26, fontWeight: 780, color: C.text }}>{p.custom ? "Custom" : `$${(interval === "year" ? p.annualMonthly : p.monthly).toFixed(0)}`}<span style={{ fontSize: 12.5, color: C.muted, fontWeight: 400 }}>{p.custom ? "" : " / month"}</span></div>
              {!p.custom && interval === "year" && <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>${p.annual.toFixed(2)} billed yearly</div>}
              <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13.5, color: C.text2 }} className="flex flex-col gap-1">{HIGHLIGHTS[k].map((x) => <li key={x}><Check size={13} color={C.green} style={{ display: "inline", marginRight: 6 }} />{x}</li>)}</ul>
              {p.custom ? <button className="lo-btn lo-btn-secondary" onClick={() => setLead({ companyName: meta.company.name, contactName: "", email: "", teamSize: "", message: "" })}>Contact us</button>
                : <button disabled={busy || P.plan === k || !owner} className="lo-btn lo-btn-primary" onClick={() => buy(k)}>{P.plan === k ? "Current plan" : !owner ? "Owner only" : active ? "Switch to this plan" : "Subscribe"}</button>}
            </div>))}
        </div>
        {lead && !sent && <div className="flex flex-col gap-2" style={{ background: C.surface2, borderRadius: 12, padding: 12 }}>
          {["companyName:Company", "contactName:Your name", "email:Work email", "teamSize:Team size (e.g. 200)"].map((x) => { const [k, l] = x.split(":"); return <input key={k} style={inp} placeholder={l} value={lead[k]} onChange={(e) => setLead({ ...lead, [k]: e.target.value })} />; })}
          <textarea rows={3} style={inp} placeholder="What do you need?" value={lead.message} onChange={(e) => setLead({ ...lead, message: e.target.value })} />
          <div><button className="lo-btn lo-btn-primary" onClick={async () => { try { await api.enterpriseLead(lead); setSent(true); } catch (e) { setErr(e.message); } }}>Send</button></div></div>}
        {sent && <div style={{ fontSize: 14, color: C.green }}>Thanks. We'll be in touch.</div>}
      </Card>
      <Card title="Compare every plan"><PlanComparison current={P.plan} prices={Object.fromEntries([["none", "Free"], ...Object.entries(BUSINESS_PLANS).map(([k, p]) => [k, price(p)])])} /></Card>
    </div>
  );
}
