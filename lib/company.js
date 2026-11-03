// The registered organisation behind LinkedOut. An organization Google Play developer account
// requires your legal entity to be identifiable (the privacy policy and store listing should name it),
// and the EU requires traders to show contact details. Set these in the server environment.
export const COMPANY = {
  name: process.env.NEXT_PUBLIC_COMPANY_LEGAL_NAME || "",
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || "",
  regNo: process.env.NEXT_PUBLIC_COMPANY_REG_NO || "",
  email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "",
};
export const hasCompany = Boolean(COMPANY.name);
