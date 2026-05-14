// Pre-filter prompt para weCAD4you. Las listas de cargos objetivo / excluidos
// y las notas del buyer persona vienen del ICP activo (icp_config.buyer_personas),
// editable desde /configuracion/icp. La lógica de estrictez por tamaño, la
// detección de ex-empleados y el "when in doubt" se quedan acá (heurísticas
// generales, no buyer-persona-específicas).
import type { BuyerPersonas } from "./supabase";
import { DEFAULT_BUYER_PERSONAS } from "./icpDefaults";

export const PREFILTER_SYSTEM = `You are a B2B sales filter for weCAD4you, a dental CAD/CAM design outsourcing service.

weCAD4you targets dental laboratories, multi-location dental clinics, and DSOs that use digital workflows (exocad, inLab, 3Shape, Dental Wings). The ideal contact is someone who makes purchasing decisions OR directly manages production / clinical operations at a dental lab, clinic, or DSO.`;

function sizeBand(size: number | null): "small" | "medium" | "large" | "unknown" {
  if (size == null) return "unknown";
  if (size <= 30) return "small";
  if (size <= 100) return "medium";
  return "large";
}

// Si el ICP no trae buyer_personas (filas viejas) o viene vacío, caemos
// al default. Un buyer_personas sin target_roles dejaría el filtro inútil.
function resolveBuyerPersonas(bp: BuyerPersonas | null | undefined): BuyerPersonas {
  if (!bp || !Array.isArray(bp.target_roles) || bp.target_roles.length === 0) {
    return DEFAULT_BUYER_PERSONAS;
  }
  return {
    target_roles: bp.target_roles,
    excluded_roles: Array.isArray(bp.excluded_roles) ? bp.excluded_roles : [],
    notes: typeof bp.notes === "string" ? bp.notes : ""
  };
}

export function prefilterUserPrompt(args: {
  job_title: string | null;
  linkedin_headline: string | null;
  company_type: string | null;
  company_size: number | null;
  buyer_personas?: BuyerPersonas | null;
}): string {
  const band = sizeBand(args.company_size);
  const sizeText =
    args.company_size != null ? `${args.company_size} employees (${band})` : "unknown size";

  const bp = resolveBuyerPersonas(args.buyer_personas);
  const yesList = bp.target_roles.map((r) => `- ${r}`).join("\n");
  const noList = bp.excluded_roles.map((r) => `- ${r}`).join("\n");
  const notesBlock = bp.notes.trim()
    ? `\nBUYER PERSONA CONTEXT (configured by the team — weigh this heavily):\n${bp.notes.trim()}\n`
    : "";

  return `CONTACT:
- Job title: ${args.job_title ?? "(unknown)"}
- LinkedIn headline: ${args.linkedin_headline ?? "(unknown)"}
- Company type: ${args.company_type ?? "(unknown)"}
- Company size: ${sizeText}
${notesBlock}
COMPANY-SIZE STRICTNESS — adjust your threshold based on the band:
- SMALL labs (≤30 employees): be GENEROUS. In a 10-person lab, even a "Lead Dental Technician", "Senior CAD Designer", "Production Lead", or "Senior Lab Technician" usually influences buying decisions. Owner / founder / president / CEO → YES even with vague titles. Anyone with "lead" or "senior" + lab/CAD/production context → YES.
- MEDIUM labs (31-100 employees): STANDARD strictness. Require a clear management or operations role. Pure technicians without "lead/senior" + management context → NO.
- LARGE / DSO (>100 employees) — CRITICAL filter for noise: Only senior buyer roles. Owner / founder / CEO / C-level → always YES. VP, Director, Senior Manager, Head of + (Operations | Production | Clinical Services | Lab | CAD/CAM | Manufacturing | Digital) → YES. ALSO YES for "[Domain] Manager" titles where Domain is explicitly an operations area. Generic "Manager" or "Coordinator" alone, or "Manager + non-buyer area" → NO. A single-location Office Manager or Practice Manager at a 1000+ employee DSO is too operational → NO.
- UNKNOWN size: apply the MEDIUM rules as default.

Answer YES if the contact's role matches one of these TARGET ROLES (with strictness adjusted by the band above):
${yesList}

Answer NO if the contact's role matches one of these EXCLUDED ROLES, or anything clearly outside the target roles:
${noList}
- Generic / motivational headlines with no job context ("Live life to the fullest", "Helping people", "Looking for opportunities")

CRITICAL — historical employment check:
- If the headline or job title mentions "Former", "Ex-", "Previously", "Past", or any signal that the contact NO LONGER works at the dental company, answer NO.
- If the headline lists a CURRENT job at a DIFFERENT company (especially a non-dental one like real estate, consulting, retail, or another industry), answer NO — they left.
- If both job_title and headline only show roles at the dental company without "former" markers, assume current.

When in doubt:
- If the role title clearly matches a TARGET ROLE (owner, CEO, founder, director of operations, lab manager, etc.), answer YES even if the headline does not mention anything digital — decision-makers do not always describe themselves with CAD keywords.
- If the role title is ambiguous but the headline shows the person works in dental operations or management, answer YES.
- If the role title is ambiguous AND the headline gives no dental-ops context, answer NO. It is better to miss a borderline contact than to spam non-buyers.

Respond with a single word only: YES or NO`;
}
