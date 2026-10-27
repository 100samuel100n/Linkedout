import { NextResponse } from "next/server";
import { COMPANY_TERMS, COMPANY_TERMS_VERSION, COMPANY_DECLARATIONS, COMPANY_LIMITS, COMPANY_SIZES, COMPANY_RELATIONSHIPS, DOCUMENT_TYPES } from "@/lib/company-terms";
import { DISPUTE_REASONS } from "@/lib/content/company-registry";

export async function GET() {
  return NextResponse.json({ version: COMPANY_TERMS_VERSION, terms: COMPANY_TERMS, declarations: COMPANY_DECLARATIONS, limits: COMPANY_LIMITS, sizes: COMPANY_SIZES, relationships: COMPANY_RELATIONSHIPS, documentTypes: DOCUMENT_TYPES, disputeReasons: DISPUTE_REASONS });
}
