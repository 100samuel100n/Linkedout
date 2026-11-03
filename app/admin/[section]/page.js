"use client";
import { use } from "react";
import { C } from "@/lib/theme";
import { useAdmin } from "@/components/admin/AdminContext";
import SectionTable from "@/components/admin/SectionTable";
import UsersAdmin from "@/components/admin/UsersAdmin";
import DmInvestigations from "@/components/admin/DmInvestigations";
import RolesAdmin from "@/components/admin/RolesAdmin";
import SecurityOps from "@/components/admin/SecurityOps";
import BroadcastComposer from "@/components/admin/BroadcastComposer";

export default function AdminSection({ params }) {
  const { section } = use(params);
  const me = useAdmin();
  const sec = me.sections.find((s) => s.id === section);
  if (!sec) return <p style={{ color: C.muted }}>Your role doesn't have access to this section.</p>;
  if (sec.kind === "roles") return <RolesAdmin />;
  if (sec.kind === "soc") return <SecurityOps />;
  if (sec.kind === "dm") return <DmInvestigations />;
  if (sec.kind === "broadcast") return <BroadcastComposer key={section} channel={section === "push" ? "push" : "email"} title={sec.label} />;
  return sec.kind === "users" ? <UsersAdmin /> : <SectionTable key={section} id={section} title={sec.label} />;
}
