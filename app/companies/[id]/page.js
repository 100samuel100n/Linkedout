import { notFound } from "next/navigation";
import { getCompanyById } from "@/lib/content/service";
import { companyReality, listStories } from "@/lib/stories/service";
import CompanyPageClient from "@/components/companies/CompanyPageClient";

// Server-rendered: the company's header, "what employees are saying" summary and latest stories are in
// the first HTML response (good for search engines and for slow phones), then the client takes over for
// anything interactive and refreshes the data for the signed-in person.
export default async function Page({ params }) {
  const { id } = await params;
  const company = await getCompanyById(id, null).catch(() => null);
  if (!company) notFound();
  const [reality, stories] = await Promise.all([
    companyReality(id, { viewerKey: null, tier: "basic" }).catch(() => null),
    listStories({ companyId: id, limit: 10 }).catch(() => []),
  ]);
  return <CompanyPageClient id={id} initialCompany={JSON.parse(JSON.stringify(company))} initialReality={reality ? JSON.parse(JSON.stringify(reality)) : null} initialStories={JSON.parse(JSON.stringify(stories))} />;
}
