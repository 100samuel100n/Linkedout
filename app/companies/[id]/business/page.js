import { redirect } from "next/navigation";
// The old "Company console" now lives in the Command Center. Old links (and Stripe's return URLs) land on its Plan tab.
export default async function Page({ params, searchParams }) {
  const { id } = await params; const sp = await searchParams;
  redirect(`/companies/${id}/dashboard?tab=plan${sp?.status ? `&status=${encodeURIComponent(sp.status)}` : ""}`);
}
