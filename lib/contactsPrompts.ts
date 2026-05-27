// Pre-filter prompt — actualizar según el ICP de cada cliente en /configuracion/icp.
export const PREFILTER_SYSTEM = `You are a B2B sales filter for BullsEye, a B2B prospecting agency.

BullsEye targets companies that match the client's ICP. The ideal contact is someone who makes purchasing decisions or directly manages the relevant operations.`;

export function prefilterUserPrompt(args: {
  job_title: string | null;
  linkedin_headline: string | null;
  company_type: string | null;
  company_name?: string | null;
}): string {
  const companyLine = args.company_name
    ? `- Target company: ${args.company_name}`
    : "";

  return `CONTACT:
- Job title: ${args.job_title ?? "(unknown)"}
- LinkedIn headline: ${args.linkedin_headline ?? "(unknown)"}
- Company type: ${args.company_type ?? "(unknown)"}
${companyLine}

CURRENT EMPLOYMENT CHECK (apply first if company_name is provided):
If the LinkedIn headline clearly mentions working at a DIFFERENT company from the target company AND does NOT mention the target company at all, answer NO — the person is likely a former employee.
Example: target is "ComunidadFeliz" but headline says "Agente comercial · LifeCycle Argentina" → NO (ex-employee).
Only apply this rule when the headline makes the different employer explicit. If the headline is generic or missing, do not use this rule.

IMPORTANT: If LinkedIn headline is "(unknown)" or missing, base your decision SOLELY on the job title. Do not answer NO just because headline or seniority data is unavailable.

Answer YES if the job title suggests decision-making, management, or ownership:
- Owner, founder, director, president, general manager, or CEO/COO/CXO
- Any VP, head, or lead of a business area (sales, operations, marketing, growth, product, etc.)
- Manager or coordinator of a relevant department or team
- Independent professional or practice owner

Answer NO only if the job title clearly indicates a non-buyer operational or support role:
- Technician, operator, assistant, or analyst with no management scope
- Sales rep, distributor, or equipment/software vendor (they sell, not buy)
- Pure finance roles (accountant, bookkeeper, treasurer, financial controller)
- IT staff, developer, or administrative assistant

When in doubt, answer YES. Missing data is never a reason to discard a contact.

Respond with a single word only: YES or NO`;
}
