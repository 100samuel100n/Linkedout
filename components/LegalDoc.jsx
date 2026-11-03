"use client";
import Link from "next/link";
import { C, displayFont, monoFont } from "@/lib/theme";
import { LEGAL_UPDATED, INDEPENDENCE_NOTICE } from "@/lib/legal-content";
import { COMPANY, hasCompany } from "@/lib/company";

// Renders a Terms / Privacy document from lib/legal-content.js.
export default function LegalDoc({ doc }) {
  return (
    <article className="flex flex-col gap-5" style={{ maxWidth: 680, margin: "0 auto" }}>
      <header>
        <div style={{ ...displayFont, fontSize: 26, color: C.text }}>{doc.title}</div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 4 }}>Last updated {LEGAL_UPDATED}</div>
      </header>
      <div role="note" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", fontSize: 13, color: C.text, lineHeight: 1.55 }}>
        {INDEPENDENCE_NOTICE}
      </div>
      {hasCompany && (
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", fontSize: 13.5, color: C.text, lineHeight: 1.6 }}>
          <b>Published by {COMPANY.name}</b>
          {COMPANY.regNo ? <span style={{ color: C.muted }}> · Registration no. {COMPANY.regNo}</span> : null}
          {COMPANY.address ? <div style={{ color: C.muted }}>{COMPANY.address}</div> : null}
          {COMPANY.email ? <div><a href={`mailto:${COMPANY.email}`} style={{ color: C.mustard }}>{COMPANY.email}</a></div> : null}
        </div>
      )}
      <p style={{ fontSize: 14.5, color: C.text, lineHeight: 1.65 }}>{doc.intro}</p>
      {doc.sections.map((s) => (
        <section key={s.h} className="flex flex-col gap-2">
          <h2 style={{ ...displayFont, fontSize: 17, color: C.text }}>{s.h}</h2>
          {(s.p || []).map((t, i) => <p key={i} style={{ fontSize: 14, color: C.text2 || C.text, lineHeight: 1.65 }}>{t}</p>)}
          {s.list && <ul style={{ paddingLeft: 20, listStyle: "disc", display: "grid", gap: 6 }}>{s.list.map((t) => <li key={t} style={{ fontSize: 14, color: C.text2 || C.text, lineHeight: 1.6 }}>{t}</li>)}</ul>}
        </section>
      ))}
      <footer style={{ ...monoFont, fontSize: 12, color: C.muted, display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
        <Link href="/terms" style={{ color: C.mustard }}>Terms of Use</Link>
        <Link href="/privacy" style={{ color: C.mustard }}>Privacy Policy</Link>
        <Link href="/legal/dmca" style={{ color: C.mustard }}>Copyright notice</Link>
        <Link href="/support" style={{ color: C.mustard }}>Contact support</Link>
      </footer>
    </article>
  );
}
