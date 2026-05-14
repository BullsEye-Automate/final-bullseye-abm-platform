import type {
  BuyerPersonas,
  Competitor,
  Geography,
  OrgType,
  PipelineMix,
  SizeRule
} from "./supabase";

// Buyer personas por defecto — alimenta el pre-filtro de contactos cuando
// el ICP activo todavía no tiene un buyer_personas propio (filas viejas).
// El usuario puede editar todo esto desde /configuracion/icp.
export const DEFAULT_BUYER_PERSONAS: BuyerPersonas = {
  target_roles: [
    "Owner, co-owner, founder, co-founder, president",
    "CEO and any C-level executive (COO, CCO) — top decision makers, ALWAYS a buyer regardless of whether their headline mentions digital/CAD",
    "General Manager, Managing Director",
    "Director or VP of Operations, Production, Clinical Services, Manufacturing or Digital",
    "Lab Manager, Production Manager, Operations Manager, Workflow Manager",
    "CAD/CAM Manager, Digital Workflow Manager, Production Coordinator",
    "Office Manager or Practice Manager (often handles purchasing decisions)",
    "Regional / District / Area Manager when the role oversees dental operations or labs",
    "Partner in the lab, clinic group or DSO",
    "Dentist or doctor who is ALSO owner, founder, director, partner or manager of a clinic, DSO or dental group"
  ],
  excluded_roles: [
    "Pure technicians with no management role: CAD technician/operator/designer, dental technician, ceramist, lab technician",
    "Dental assistant, hygienist, dental nurse, sterilization tech, surgical assistant",
    "Clinical dentist / associate / oral surgeon / orthodontist with no ownership or management role",
    "Marketing (any: digital, content, brand, social media, marketing manager or director)",
    "HR / People Operations / Talent Acquisition / Recruiting",
    "Learning & Development / Training / Education / Onboarding",
    "IT, Software Engineer, Developer, DevOps, Data Analyst or Scientist",
    "Sales rep, account executive, business development, distributor, vendor, equipment sales",
    "Finance (CFO, Financial Controller, Accountant, Treasurer, Bookkeeper, Finance Manager) — they may approve but do not initiate CAD/CAM outsourcing decisions",
    "Legal, Compliance, Privacy, Risk Management",
    "Customer Service, Patient Services, Patient Coordinator, Insurance Coordinator, Front Desk, Receptionist",
    "Real Estate, Facilities, procurement of non-CAD supplies",
    "Students, interns, residents, or unspecified roles"
  ],
  notes:
    "El comprador de weCAD4you es liderazgo de operaciones/producción o la dueñería del lab/clínica/DSO. El CEO, owner y founder SIEMPRE son YES aunque su headline no mencione nada digital — son los que firman. En labs chicos (<30 empleados) el dueño ES el comprador. En DSOs grandes, solo roles senior de operaciones."
};

export const ICP_V1_DEFAULTS: {
  org_types: OrgType[];
  signals_strong: string[];
  signals_medium: string[];
  signals_weak: string[];
  size_rules: SizeRule[];
  pipeline_mix: PipelineMix[];
  competitors: Competitor[];
  geographies: Geography[];
  buyer_personas: BuyerPersonas;
  notes: string;
} = {
  org_types: [
    { key: "lab", label: "Laboratorio dental", accept: true },
    { key: "multi_clinic", label: "Clínica dental multi-centro", accept: true, note: "Evaluar centros × tamaño" },
    { key: "dso", label: "DSO", accept: true, note: "Prioridad alta" },
    { key: "single_clinic", label: "Clínica 1 centro pequeño", accept: false },
    { key: "distributor", label: "Distribuidor / proveedor", accept: false },
    { key: "software_vendor", label: "Proveedor de software", accept: false },
    { key: "academia", label: "Academia / universidad", accept: false }
  ],
  signals_strong: [
    "Mencionan exocad, inLab, 3Shape o Dental Wings en web/LinkedIn",
    "Publican casos de coronas CAD, zirconia milled, puentes digitales, implantes digitales",
    "Tienen equipo de milling o impresión 3D listado o visible",
    "Empleado con título CAD/CAM Technician, CAD Designer en LinkedIn"
  ],
  signals_medium: [
    "Mencionan digital workflow, same-day crowns o digital impressions sin software específico",
    "Comparten contenido de escáneres intraorales (iTero, Medit, Carestream, Cerec)",
    "Web o redes muestran restauraciones claramente CAD"
  ],
  signals_weak: [
    "Mencionan escáner de modelos de yeso (no intraoral)",
    "Usan la palabra digital sin tecnología concreta",
    "Contenido visible 100% analógico"
  ],
  size_rules: [
    { min: 1, max: 2, decision: "reject", note: "Sin volumen suficiente" },
    { min: 3, max: 14, decision: "approve", note: "Volumen medio — anotar" },
    { min: 15, max: 50, decision: "approve", note: "Sweet spot" },
    { min: 51, max: null, decision: "approve", note: "Overflow — prioridad" }
  ],
  pipeline_mix: [
    { label: "5–30 con flujo digital", share: 60, velocity: "rápido" },
    { label: "31–100", share: 25, velocity: "medio" },
    { label: "100+", share: 15, velocity: "lento" }
  ],
  competitors: [
    { name: "Evident", note: "" },
    { name: "Full Contour", note: "" },
    { name: "Aidite", note: "" },
    { name: "Automate (by 3Shape)", note: "Integrado en ecosistema 3Shape" }
  ],
  geographies: [
    { region: "US", priority: "principal" },
    { region: "CA", priority: "secundario" },
    { region: "EU", priority: "terciario", note: "GDPR — legitimate interest" },
    { region: "LATAM", priority: "oportunístico" }
  ],
  buyer_personas: DEFAULT_BUYER_PERSONAS,
  notes:
    "Regla de oro: lab / multi-centro / DSO + flujo digital + volumen real. Tener diseñadores propios NO descarta — es señal de que entienden el valor."
};
