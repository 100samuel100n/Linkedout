import PublicForm from "@/components/PublicForm";
export const metadata = { title: "Legal & government requests — LinkedOut" };
export default function LegalRequestPage() {
  return (
    <PublicForm
      title="Legal & government requests" endpoint="/api/public/legal" submitLabel="Submit request"
      intro="For courts, law enforcement and government agencies. Requests are reviewed by our legal team against applicable law. We don't release user information through this form; we'll respond to the official contact you provide."
      fields={[
        { key: "agency", label: "Agency / court" },
        { key: "name", label: "Your name and title" },
        { key: "email", label: "Official email", type: "email" },
        { key: "type", label: "Request type", options: [["subpoena", "Subpoena"], ["court_order", "Court order"], ["preservation", "Preservation request"], ["emergency", "Emergency disclosure"], ["data_request", "Other data request"], ["other", "Other"]] },
        { key: "reference", label: "Case / reference number", optional: true },
        { key: "deadline", label: "Response deadline (YYYY-MM-DD)", optional: true, placeholder: "2026-12-31" },
        { key: "subject", label: "Subject" },
        { key: "details", label: "Details (what you're requesting and the legal basis)", long: true },
      ]}
      checks={[{ key: "authorized", label: "I'm authorized to make this request on behalf of the agency named above." }]}
    />
  );
}
