"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { C, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
// Story → Company → Jobs. A quiet line under a story when the company it's about is hiring. Never promotional: it carries no ranking and no payment.
export default function HiringHint({ companyId, company }) {
  const [n, setN] = useState(null);
  useEffect(() => { if (companyId) api.jobsSearch(`companyId=${companyId}`).then((r) => setN(r.total)).catch(() => {}); }, [companyId]);
  if (!n) return null;
  return <Link href={`/companies/${companyId}`} className="lo-card flex items-center gap-2" style={{ padding: 12, textDecoration: "none", borderColor: alpha(C.corpblue, 35), fontSize: 14, color: C.text }}><Briefcase size={16} color={C.corpblue} /> {company} has {n} open {n === 1 ? "position" : "positions"}. Read what people report before you consider applying.</Link>;
}
