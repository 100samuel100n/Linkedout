"use client";
import { BadgeCheck, Globe2, ShieldQuestion, Clock } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";

// The trust ladder, shown the same way everywhere a company appears:
//   Verified          documents reviewed and approved by a person
//   Domain verified   owner proved control of an email at the company's site
//   Under review      documents submitted, awaiting a reviewer
//   Unverified        a community listing with no checks yet
export function companyTrust(co) {
  if (co.verification === "verified") return { key: "verified", label: "Verified", Icon: BadgeCheck, color: C.green, tip: "Registration documents were reviewed and approved." };
  if (co.verification === "submitted") return { key: "review", label: "Under review", Icon: Clock, color: C.mustard, tip: "Documents submitted — a reviewer is checking them." };
  if (co.domainVerified) return { key: "domain", label: "Domain verified", Icon: Globe2, color: C.corpblue, tip: "The page owner proved control of an email at the company's website." };
  return { key: "unverified", label: "Unverified listing", Icon: ShieldQuestion, color: C.muted, tip: "A community listing. Nothing about it has been independently checked yet." };
}

export default function CompanyBadges({ co, size = "md" }) {
  const t = companyTrust(co);
  const small = size === "sm";
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span title={t.tip} style={{ ...monoFont, fontSize: small ? 9.5 : 10.5, display: "inline-flex", alignItems: "center", gap: 4, color: t.color, background: alpha(t.color === C.muted ? C.line : t.color, t.color === C.muted ? 40 : 12), border: `1px solid ${alpha(t.color, t.color === C.muted ? 60 : 35)}`, borderRadius: 999, padding: small ? "1px 7px" : "2px 9px", fontWeight: 600 }}>
        <t.Icon size={small ? 10 : 12} /> {t.label}
      </span>
      {co.domainVerified && t.key !== "domain" && (
        <span title="Owner controls an email at the company's website" style={{ ...monoFont, fontSize: small ? 9.5 : 10.5, display: "inline-flex", alignItems: "center", gap: 4, color: C.corpblue, border: `1px solid ${alpha(C.corpblue, 35)}`, background: alpha(C.corpblue, 10), borderRadius: 999, padding: small ? "1px 7px" : "2px 9px" }}>
          <Globe2 size={small ? 10 : 12} /> Domain
        </span>
      )}
    </span>
  );
}
