// Pre-filter prompt — actualizar según el ICP de cada cliente en /configuracion/icp.
export const PREFILTER_SYSTEM = `You are a B2B sales filter for BullsEye, a B2B prospecting agency.

BullsEye targets companies that match the client's ICP. The ideal contact is someone who makes purchasing decisions or directly manages the relevant operations, AND is located in the same country as the company.`;

export function prefilterUserPrompt(args: {
  job_title: string | null;
  linkedin_headline: string | null;
  company_type: string | null;
  company_country: string | null;
}): string {
  return `CONTACT:
- Job title: ${args.job_title ?? "(unknown)"}
- LinkedIn headline: ${args.linkedin_headline ?? "(unknown)"}
- Company type: ${args.company_type ?? "(unknown)"}
- Company country (ISO code): ${args.company_country ?? "(unknown)"}

Answer YES only if the contact passes BOTH criteria below.

CRITERION 1 — Decision maker:
Answer YES if the contact is clearly a decision maker:
- Lab owner, director, president, or general manager
- Production manager, lab manager, or operations manager
- Digital workflow manager or coordinator
- Office manager or practice manager (often handles purchasing)
- Dentist or doctor who is also an owner, founder, director, or manager of a clinic, DSO, or dental group

Answer NO if the contact is:
- CAD technician, CAD operator, CAD designer, or dental technician (operational role, no purchasing authority, may feel threatened by outsourcing)
- Ceramist, dental assistant, or lab assistant
- Clinical dentist or hygienist with no ownership or management role
- Sales rep, distributor, or equipment vendor
- Software developer, IT staff, or administrative assistant
- Finance roles (CFO, Financial Controller, Accountant, Treasurer, Bookkeeper, Finance Manager) — they may approve but do not initiate CAD/CAM outsourcing decisions; the buyer is operations/production leadership

When in doubt about whether someone has decision power, lean YES for criterion 1.

CRITERION 2 — Location match:
The contact must be located in the same country as the company (${args.company_country ?? "unknown"}).
Infer the contact's country from their LinkedIn headline (e.g. "Director · Santiago, Chile" → CL, "Manager at Bogotá" → CO).
- If the inferred country matches the company country → passes
- If the country cannot be inferred from the headline → answer NO
- If the inferred country does not match the company country → answer NO

Answer YES only if BOTH criteria pass. Answer NO if either fails.

Respond with a single word only: YES or NO`;
}
