// Pre-filter prompt — actualizar según el ICP de cada cliente en /configuracion/icp.
export const PREFILTER_SYSTEM = `You are a B2B sales filter for BullsEye, a B2B prospecting agency.

BullsEye targets companies that match the client's ICP. The ideal contact is someone who makes purchasing decisions or directly manages the relevant operations.`;

export function prefilterUserPrompt(args: {
  job_title: string | null;
  linkedin_headline: string | null;
  company_type: string | null;
}): string {
  return `CONTACT:
- Job title: ${args.job_title ?? "(unknown)"}
- LinkedIn headline: ${args.linkedin_headline ?? "(unknown)"}
- Company type: ${args.company_type ?? "(unknown)"}

IMPORTANT: If LinkedIn headline is "(unknown)" or missing, base your decision SOLELY on the job title. Do not answer NO just because headline or seniority data is unavailable.

Answer YES if the job title suggests decision-making, management, or ownership:
- Owner, founder, director, president, general manager, or CEO/COO/CXO
- Any VP, head, or lead of a business area (sales, operations, marketing, growth, product, etc.)
- Manager or coordinator of a relevant department or team
- Independent professional or practice owner

Answer NO only if the job title clearly indicates a non-buyer operational or support role:
- Technician, operator, assistant, or analyst with no management scope
- Sales rep, distributor, or equipment/software vendor (they sell, not buy)
- Pure finance roles (accountant, bookkeeper, treasurer, financial controller) — they approve but do not initiate B2B service purchases
- IT staff, developer, or administrative assistant

When in doubt, answer YES. Missing data is never a reason to discard a contact.

Respond with a single word only: YES or NO`;
}
