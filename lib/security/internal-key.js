import crypto from "node:crypto";
// Shared secret between proxy.js and the internal security endpoints. Derived from the signing secret unless
// SECURITY_INTERNAL_KEY is set, so it needs no extra setup and is never exposed to browsers.
export const internalKey = () => process.env.SECURITY_INTERNAL_KEY || crypto.createHmac("sha256", process.env.IDENTITY_SIGNING_SECRET || "dev-only-insecure-secret-change-me").update("lo-sec-internal").digest("hex");
