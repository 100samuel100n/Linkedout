import LegalDoc from "@/components/LegalDoc";
import { TERMS } from "@/lib/legal-content";
export const metadata = { title: "Terms of Use — LinkedOut" };
export default function TermsPage() { return <LegalDoc doc={TERMS} />; }
