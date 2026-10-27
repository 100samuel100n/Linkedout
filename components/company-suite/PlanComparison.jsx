"use client";
import { Fragment } from "react";
import { Check, Minus } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { PLAN_KEYS, PLAN_LABELS, comparisonByPillar, SEATS } from "@/lib/business-features";

// The same table the server enforces (lib/business-features.js). Shown before purchase so nobody has to guess what each plan has.
const Cell = ({ v, soon }) => {
  if (soon) return <span style={{ ...monoFont, fontSize: 10.5, color: C.muted }}>{v ? "Coming soon" : <Minus size={14} color={C.muted} />}</span>;
  if (v === true) return <Check size={16} color={C.green} aria-label="Included" />;
  if (!v) return <Minus size={14} color={C.line} aria-label="Not included" />;
  if (v === "public") return <span style={{ fontSize: 12, color: C.text2 }}>Public label</span>;
  return <span style={{ fontSize: 12, color: C.text2, textTransform: "capitalize" }}>{String(v)}</span>;
};
export default function PlanComparison({ current = null, prices = null }) {
  const groups = comparisonByPillar();
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: 14 }}>
      <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", fontSize: 13.5, color: C.text }}>
        <thead><tr style={{ background: C.surface2 }}>
          <th style={{ textAlign: "left", padding: 10, position: "sticky", left: 0, background: C.surface2 }}>What you get</th>
          {PLAN_KEYS.map((p) => <th key={p} style={{ padding: 10, textAlign: "center", borderBottom: current === p ? `3px solid ${C.mustard}` : undefined }}>{PLAN_LABELS[p]}{current === p && <div style={{ ...monoFont, fontSize: 10, color: C.mustard }}>current</div>}{prices?.[p] && <div style={{ fontWeight: 400, fontSize: 12, color: C.muted }}>{prices[p]}</div>}</th>)}
        </tr></thead>
        <tbody>
          <tr style={{ borderTop: `1px solid ${C.line}` }}><td style={{ padding: 10, position: "sticky", left: 0, background: C.surface }}>Representatives (including the owner)</td>{PLAN_KEYS.map((p) => <td key={p} style={{ textAlign: "center", ...monoFont }}>{SEATS[p]}{p === "enterprise" ? "+" : ""}</td>)}</tr>
          {groups.map((g) => <Fragment key={g.key}>
            <tr style={{ background: alpha(C.mustard, 8) }}><td colSpan={5} style={{ padding: "8px 10px", fontWeight: 740 }}>{g.label} <span style={{ fontWeight: 400, color: C.muted }}>· {g.question}</span></td></tr>
            {g.rows.map((r) => <tr key={r.key} style={{ borderTop: `1px solid ${C.line}` }}><td style={{ padding: "8px 10px", position: "sticky", left: 0, background: C.surface }}>{r.label}</td>{r.levels.map((v, i) => <td key={i} style={{ textAlign: "center", padding: 6 }}><Cell v={v} soon={r.status === "soon"} /></td>)}</tr>)}
          </Fragment>)}
        </tbody>
      </table>
      <div style={{ padding: 10, fontSize: 12.5, color: C.muted }}>“Coming soon” means it's on the roadmap and not yet available. No plan can remove, hide, edit or rank a story, or reveal who wrote it. Replying is free for every verified company.</div>
    </div>
  );
}
