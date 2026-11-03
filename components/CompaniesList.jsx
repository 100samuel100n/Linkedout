"use client";
import Link from "next/link";
import { ChevronRight, Star } from "lucide-react";
import { C, monoFont, displayFont } from "@/lib/theme";
import { Stamp, Redacted } from "@/components/primitives";
import CompanyBadges from "@/components/CompanyBadges";

function CompanyCard({ co }) {
  return (
    <Link
      href={`/companies/${co.id}`}
      style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, textDecoration: "none" }}
      className="p-4 flex items-start justify-between gap-3"
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ ...displayFont, fontSize: 16, color: C.text }}>{co.name}</span>
          {co.toxic && <Stamp text="Verified Toxic Employer" tone="flag" rotate={-5} />}
          {co.layoffBadge && <Stamp text="Verified Layoffs" tone="mustard" rotate={4} />}
        </div>
        <div className="mt-1.5"><CompanyBadges co={co} size="sm" /></div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 6 }}>{[co.industry, co.headquarters, co.sizeRange && `${co.sizeRange} people`].filter(Boolean).join(" · ")}</div>
        <div className="flex items-center gap-4 mt-2 flex-wrap" style={{ fontSize: 12 }}>
          {co.avgRating && (
            <span className="flex items-center gap-1" style={{ color: C.text }}>
              <Star size={12} fill={C.mustard} color={C.mustard} /> {co.avgRating} <span style={{ color: C.muted }}>({co.ratingCount})</span>
            </span>
          )}
          <span style={{ color: C.green }}>▲ {co.greenFlags} green</span>
          <span style={{ color: C.flag }}>▼ {co.redFlags} red</span>
          <span style={{ color: C.muted, ...monoFont }}>salary: <Redacted value={co.salaryRange} /> ({co.salarySamples})</span>
        </div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 6 }}>{co.reviewCount} review{co.reviewCount === 1 ? "" : "s"} · view full page for details</div>
      </div>
      <ChevronRight size={18} color={C.muted} style={{ flexShrink: 0, marginTop: 4 }} />
    </Link>
  );
}

export default function CompaniesList({ companies }) {
  return (
    <div className="flex flex-col gap-3">
      {companies.map((co) => <CompanyCard key={co.id} co={co} />)}
    </div>
  );
}
