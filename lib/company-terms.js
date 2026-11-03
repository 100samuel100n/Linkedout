// Terms a person must accept before creating a company page. Bump
// COMPANY_TERMS_VERSION whenever the text changes — each page stores the
// version its owner accepted, so there is always a record of exactly what
// they agreed to.
//
// NOTE: this is a solid product-policy draft, not legal advice. Have a
// lawyer in your jurisdiction review it before launch, especially the
// defamation, takedown and liability sections.
export const COMPANY_TERMS_VERSION = "2026-10-01";

export const COMPANY_TERMS = [
  { title: "1. What a company page is", body: "A company page is a public directory listing where people share their own experiences of an employer. It is not an official page of the company, and creating one does not make you its representative unless you say so and can show it." },
  { title: "2. You must be truthful", body: "Everything you submit — names, registration details, relationship to the company, documents — must be accurate, and the documents genuine. You may not impersonate a company, invent a company, or create a page to harass, defame or mislead." },
  { title: "3. Reviews are opinions of their authors", body: "Reviews, ratings, salary entries and stories are written by other users, who are responsible for them. You cannot edit or delete another user's content. The only route to remove it is the dispute process below." },
  { title: "4. What you can control", body: "As the page owner you can edit the listing details, add or remove your own supporting documents, and delete the page. Name changes are limited (once every 30 days) and every edit is logged, so a page can't be quietly turned into something else." },
  { title: "5. Defamation & takedown", body: "Anyone can report content that is false and damaging, or a page that is fake. Reports are reviewed against the evidence. Content may be removed or a page suspended if it breaks these terms, is demonstrably false, or was created in bad faith. Opinion, honestly held and based on real experience, is not removed just because it is unfavourable." },
  { title: "6. Verification", body: "Submitting documents does not guarantee a Verified badge. A reviewer checks them against what you entered. Domain verification proves you control an email address at the company's website. Documents are stored privately, seen only by reviewers, and deleted 30 days after a rejection or page deletion." },
  { title: "7. Limits & enforcement", body: "We limit how many pages an account can hold and how often they can be created or changed. Abuse — fake pages, repeated bad-faith edits, evading limits — leads to removal of pages and may lead to suspension of the account." },
  { title: "8. Deleting a page", body: "Deleting hides the page immediately and lets you restore it for 30 days. After that it is permanently erased, unless there is an open dispute about it, in which case it is kept until the dispute is resolved." },
  { title: "9. Responsibility", body: "You are responsible for what you submit and for any claims arising from it. LinkedOut acts as a host of user-generated content and will act on valid reports, but does not verify every statement made on the platform." },
];

export const COMPANY_DECLARATIONS = [
  { key: "truthful", text: "Everything I've entered is accurate and any documents I upload are genuine." },
  { key: "authority", text: "I'm not impersonating a company or person, and I understand this is not an official company account unless verified." },
  { key: "reviews", text: "I understand reviews belong to their authors and I can't edit or remove them — only report them through the dispute process." },
  { key: "terms", text: "I've read and accept the Company Page Terms." },
];

export const COMPANY_LIMITS = {
  pagesByTier: { basic: 1, plus: 3, pro: 10 },
  createPerDay: 2,
  editPerDay: 20,
  renameEveryDays: 30,
  docsPerDay: 10,
  maxDocs: 6,
  restoreWindowDays: 30,
};

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1,000", "1,001-5,000", "5,001-10,000", "10,000+"];
export const COMPANY_RELATIONSHIPS = [
  { key: "founder", label: "Founder / owner" },
  { key: "authorized_rep", label: "Authorised representative" },
  { key: "employee", label: "Current employee" },
  { key: "former_employee", label: "Former employee" },
  { key: "other", label: "Other (explain in description)" },
];
export const DOCUMENT_TYPES = [
  { key: "registration", label: "Certificate of incorporation / registration" },
  { key: "tax", label: "Tax registration (e.g. KRA PIN, EIN, VAT)" },
  { key: "licence", label: "Business licence / permit" },
  { key: "proof_of_role", label: "Proof of your role (contract, payslip, ID badge)" },
  { key: "other", label: "Other supporting document" },
];
