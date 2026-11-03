// Shared by the contact form, the ticket API and (as a copy) the native app.
export const SUPPORT_CATEGORIES = [
  ["general", "General question"],
  ["account", "My account"],
  ["billing", "Billing & subscription"],
  ["bug", "Something's broken"],
  ["safety", "Safety or abuse"],
  ["privacy", "Privacy or data request"],
  ["business", "Business, company pages or advertising"],
  ["partnership", "Partnerships or press"],
  ["feature", "Feature request"],
];
export const SUPPORT_CATEGORY_KEYS = SUPPORT_CATEGORIES.map(([k]) => k);
export const HIGH_PRIORITY = new Set(["safety", "billing", "privacy"]);
