// Pre-filter prompt validado con Tom Wiand (Wiand Dental Lab, mayo 2026).
// Mantener este string estable — cambios deben pasar por revisión manual antes.
export const PREFILTER_SYSTEM = `You are a B2B sales filter for weCAD4you, a dental CAD/CAM design outsourcing service.

weCAD4you targets dental laboratories, multi-location dental clinics, and DSOs that use digital workflows (exocad, inLab, 3Shape, Dental Wings). The ideal contact is someone who makes purchasing decisions or directly manages production and people at a dental lab, clinic, or DSO.`;

export function prefilterUserPrompt(args: {
  job_title: string | null;
  linkedin_headline: string | null;
  company_type: string | null;
}): string {
  return `CONTACT:
- Job title: ${args.job_title ?? "(unknown)"}
- LinkedIn headline: ${args.linkedin_headline ?? "(unknown)"}
- Company type: ${args.company_type ?? "(unknown)"}

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

When in doubt about whether someone has decision power, answer YES. It is better to score a borderline contact than to miss a potential decision maker.

Respond with a single word only: YES or NO`;
}
