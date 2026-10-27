"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShieldCheck, Plus, Search, Building2 } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import CompaniesList from "@/components/CompaniesList";
import CompanyBadges from "@/components/CompanyBadges";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "verified", label: "Verified" },
  { key: "domain", label: "Domain verified" },
];

export default function CompaniesPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState(null);
  const [mine, setMine] = useState([]);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => { api.getCompanies().then(setCompanies).catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (user) api.getMyCompanies().then(setMine).catch(() => {}); else setMine([]); }, [user?.email]);

  const shown = useMemo(() => {
    if (!companies) return null;
    const term = q.trim().toLowerCase();
    return companies.filter((c) =>
      (filter === "all" || (filter === "verified" && c.verification === "verified") || (filter === "domain" && c.domainVerified)) &&
      (!term || c.name.toLowerCase().includes(term) || (c.industry || "").toLowerCase().includes(term)));
  }, [companies, q, filter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 style={{ ...displayFont, fontSize: 22, color: C.text }}>Companies</h1>
          <div className="flex items-center gap-2 mt-1" style={{ ...monoFont, fontSize: 12, color: C.muted }}>
            <ShieldCheck size={13} /> Pages are built from employee experience. Companies can't edit or remove reviews.
          </div>
        </div>
        {user && (
          <Link href="/companies/new" className="flex items-center gap-1.5 lo-tap" style={{ ...monoFont, fontSize: 12, color: "#fff", background: C.mustard, borderRadius: 10, padding: "8px 16px", textDecoration: "none", fontWeight: 700 }}>
            <Plus size={14} /> Register a company
          </Link>
        )}
      </div>

      {mine.length > 0 && (
        <section style={{ background: C.surface, border: `1px solid ${alpha(C.mustard, 35)}`, borderRadius: 14 }} className="p-4 flex flex-col gap-2">
          <div style={{ ...monoFont, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted }}>Pages you own</div>
          {mine.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{c.name} {c.deletedAt && <span style={{ ...monoFont, fontSize: 12, color: C.flag }}>(deleted)</span>}</div>
                <div className="mt-1"><CompanyBadges co={c} size="sm" /></div>
              </div>
              <Link href={`/companies/${c.id}/manage`} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: C.mustard, border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 999, padding: "5px 12px", textDecoration: "none" }}>Manage</Link>
            </div>
          ))}
        </section>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2" style={{ flex: 1, minWidth: 200, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "7px 14px" }}>
          <Search size={14} color={C.muted} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies or industries" style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.text, fontSize: 13 }} />
        </div>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className="lo-tap" style={{ ...monoFont, fontSize: 12, cursor: "pointer", color: filter === f.key ? "#fff" : C.muted, background: filter === f.key ? C.mustard : "transparent", border: `1px solid ${filter === f.key ? C.mustard : C.line}`, borderRadius: 999, padding: "6px 12px" }}>{f.label}</button>
        ))}
      </div>

      {error && <div style={{ ...monoFont, fontSize: 12, color: C.flag }}>couldn't load companies: {error}</div>}
      {!companies && !error && <Loading variant="list" />}
      {shown && shown.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center" style={{ border: `1px dashed ${C.line}`, borderRadius: 14 }}>
          <Building2 size={26} color={C.muted} />
          <div style={{ fontSize: 14, color: C.text }}>{companies?.length ? "No companies match." : "No company pages yet."}</div>
        </div>
      )}
      {shown && shown.length > 0 && <CompaniesList companies={shown} />}
    </div>
  );
}
