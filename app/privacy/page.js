import LegalDoc from "@/components/LegalDoc";
import { PRIVACY } from "@/lib/legal-content";
export const metadata = { title: "Privacy Policy — LinkedOut" };
export default function PrivacyPage() { return <LegalDoc doc={PRIVACY} />; }
