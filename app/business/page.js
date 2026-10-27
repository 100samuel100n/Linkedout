import Link from "next/link";
import PlanComparison from "@/components/company-suite/PlanComparison";
import { BUSINESS_PLANS } from "@/lib/tiers";
import { C } from "@/lib/theme";

export const metadata = { title: "LinkedOut for companies: plans", description: "Compare Verified, Business, Business Pro and Enterprise. Replying to stories is free. Plans add insight, response workflow and employer tools. Nothing buys removal or the identity of an author." };
const price = (p) => (p.custom ? "Custom" : `$${p.monthly}/mo · $${p.annualMonthly.toFixed(0)}/mo billed yearly`);
export default function Page() {
  return (
    <main className="flex flex-col gap-4" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 780, color: C.text, letterSpacing: "-0.02em" }}>LinkedOut for companies</h1>
      <p style={{ margin: 0, fontSize: 15.5, color: C.text2, lineHeight: 1.6 }}>Every verified company can reply to stories, publish announcements, answer candidates and fill in its FAQ, free. Paid plans add the Command Center: a stories inbox with a response workflow, alerts, reputation trends, benchmarks, improvement tracking and employer tools. <b>No plan can remove, hide or edit a story, rank a company, or reveal who wrote anything.</b></p>
      <PlanComparison prices={{ none: "Free", business: price(BUSINESS_PLANS.business), business_pro: price(BUSINESS_PLANS.business_pro), enterprise: "Custom" }} />
      <div className="flex gap-2 flex-wrap"><Link href="/companies" className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }}>Find or verify your company</Link></div>
      <p style={{ margin: 0, fontSize: 13, color: C.muted }}>To subscribe, verify your company page, then open its Command Center and choose the Plan tab.</p>
    </main>
  );
}
