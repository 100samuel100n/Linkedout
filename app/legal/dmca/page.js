import PublicForm from "@/components/PublicForm";
export const metadata = { title: "DMCA takedown notice — LinkedOut" };
export default function DmcaPage() {
  return (
    <PublicForm
      title="Copyright / DMCA takedown notice" endpoint="/api/public/dmca" submitLabel="Submit notice"
      intro="If you believe content on LinkedOut infringes your copyright, tell us what it is and where it is. Notices are reviewed by our team. Knowingly misrepresenting a claim can carry legal liability."
      fields={[
        { key: "name", label: "Your full legal name (or the rights holder's)" },
        { key: "email", label: "Contact email", type: "email" },
        { key: "work", label: "The copyrighted work you own", long: true },
        { key: "url", label: "Link to the infringing post", placeholder: "https://…/post/…" },
        { key: "details", label: "Anything else we should know", long: true, optional: true },
        { key: "signature", label: "Electronic signature (type your full name)" },
      ]}
      checks={[
        { key: "goodFaith", label: "I have a good-faith belief that this use isn't authorized by the copyright owner, its agent, or the law." },
        { key: "accurate", label: "The information in this notice is accurate, and under penalty of perjury I'm the owner or authorized to act for the owner." },
      ]}
    />
  );
}
