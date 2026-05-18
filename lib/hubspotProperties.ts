// Definición de las propiedades custom wecad_* que la app crea en HubSpot
// la primera vez que pushea un objeto. Idempotente: lista las que ya existen
// y solo crea las que faltan. Se llama desde lib/hubspotPush.ts antes de
// cada upsert.

import {
  createProperty,
  ensureGroup,
  listProperties,
  type PropertyDef
} from "./hubspot";

const GROUP_NAME = "wecad4you";
const GROUP_LABEL = "weCAD4you";

const CONTACT_PROPERTIES: PropertyDef[] = [
  {
    name: "wecad_contact_id",
    label: "weCAD Contact ID",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    description: "UUID del contacto en la base de la app weCAD4you (Supabase)."
  },
  {
    name: "wecad_fit_score",
    label: "weCAD Fit Score",
    type: "number",
    fieldType: "number",
    groupName: GROUP_NAME,
    description: "Score IA de fit del contacto (1-10) emitido por el Lead Scoring de Clay."
  },
  {
    name: "wecad_fit_reason",
    label: "weCAD Fit Reason",
    type: "string",
    fieldType: "textarea",
    groupName: GROUP_NAME,
    description: "Razón IA del score, una línea explicativa."
  },
  {
    name: "wecad_fit_action",
    label: "weCAD Fit Action",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    description: "Acción decidida por el Lead Scoring + revisión humana.",
    options: [
      { label: "Enrich", value: "enrich" },
      { label: "Manual review", value: "manual_review" },
      { label: "Discard", value: "discard" }
    ]
  },
  {
    name: "wecad_human_decision",
    label: "weCAD Human Decision",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    description: "Veredicto humano cuando el contacto pasa por Revisión manual.",
    options: [
      { label: "Approved", value: "approved" },
      { label: "Rejected", value: "rejected" }
    ]
  },
  {
    name: "wecad_human_decision_reason",
    label: "weCAD Human Decision Reason",
    type: "string",
    fieldType: "textarea",
    groupName: GROUP_NAME
  },
  {
    name: "wecad_linkedin_icebreaker",
    label: "weCAD LinkedIn Icebreaker",
    type: "string",
    fieldType: "textarea",
    groupName: GROUP_NAME,
    description: "Texto exacto del icebreaker que Lemlist envía en el Día 3."
  },
  {
    name: "wecad_email_subject",
    label: "weCAD Email Subject",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME
  },
  {
    name: "wecad_email_body",
    label: "weCAD Email Body",
    type: "string",
    fieldType: "textarea",
    groupName: GROUP_NAME
  },
  {
    name: "wecad_clay_pushed_at",
    label: "weCAD Clay Pushed At",
    type: "datetime",
    fieldType: "date",
    groupName: GROUP_NAME
  },
  {
    name: "wecad_lemlist_pushed_at",
    label: "weCAD Lemlist Pushed At",
    type: "datetime",
    fieldType: "date",
    groupName: GROUP_NAME
  },
  {
    name: "wecad_lemlist_campaign",
    label: "weCAD Lemlist Campaign",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME
  },

  // Denormalizados desde la empresa asociada — al SDR le sirve verlos en
  // la card del contacto para priorizar sin un click extra. Se actualizan
  // en cada resync; si cambian en la empresa, quedan stale hasta el
  // próximo push del contacto.
  {
    name: "wecad_cad_software",
    label: "weCAD CAD Software",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    description: "CAD software de la empresa asociada (denormalizado)."
  },
  {
    name: "wecad_company_type",
    label: "weCAD Company Type",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    description: "Tipo de empresa asociada (denormalizado).",
    options: [
      { label: "Dental laboratory", value: "lab" },
      { label: "Multi-location clinic", value: "multi_clinic" },
      { label: "DSO", value: "dso" }
    ]
  },
  {
    name: "wecad_scanner_technology",
    label: "weCAD Scanner Technology",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    description: "Scanner intraoral de la empresa asociada (denormalizado)."
  },

  // Sprint 4 fase 2 — workflow SDR + phone enrichment.
  {
    name: "wecad_callback_date",
    label: "weCAD Callback Date",
    type: "datetime",
    fieldType: "date",
    groupName: GROUP_NAME,
    description: "Fecha de callback agendada por el SDR cuando el lead queda en Bad Timing."
  },
  {
    name: "wecad_qualification_outcome",
    label: "weCAD Qualification Outcome",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    description: "Motivo cualitativo del SDR cuando descalifica o califica el lead. Entrena el ICP.",
    options: [
      { label: "Qualified — moving forward", value: "qualified" },
      { label: "Not interested", value: "not_interested" },
      { label: "Wrong persona (no decision power)", value: "wrong_persona" },
      { label: "No budget / no timeline", value: "no_budget" },
      { label: "Already using competitor (happy)", value: "competitor_locked" },
      { label: "Wrong company (not fit)", value: "wrong_company" },
      { label: "Bad data (wrong contact info)", value: "bad_data" },
      { label: "Other", value: "other" }
    ]
  },
  {
    name: "wecad_phone_enrichment_status",
    label: "weCAD Phone Enrichment Status",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    description: "Estado del enrichment de teléfono. El SDR cambia a 'Requested' para disparar el workflow de enrichment manual.",
    options: [
      { label: "Not requested", value: "not_requested" },
      { label: "Requested (trigger enrichment)", value: "requested" },
      { label: "Lemlist pending", value: "lemlist_pending" },
      { label: "Done — found via Lemlist", value: "done_lemlist" },
      { label: "Done — found via Lusha", value: "done_lusha" },
      { label: "Not found (Lemlist + Lusha tried)", value: "not_found" }
    ]
  },
  {
    name: "wecad_phone_source",
    label: "weCAD Phone Source",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    description: "Provedor que devolvió el teléfono principal (lemlist / lusha)."
  },
  {
    name: "wecad_phone_lemlist",
    label: "weCAD Phone (Lemlist)",
    type: "string",
    fieldType: "phonenumber",
    groupName: GROUP_NAME,
    description: "Teléfono que devolvió Lemlist (sync nativo). Se conserva aunque después Lusha sobrescriba el field principal."
  },
  {
    name: "wecad_phone_lusha",
    label: "weCAD Phone (Lusha)",
    type: "string",
    fieldType: "phonenumber",
    groupName: GROUP_NAME,
    description: "Teléfono que devolvió Lusha (lookup manual). Se conserva aunque Lemlist haya devuelto otro."
  },
  {
    name: "wecad_engagement_score",
    label: "weCAD Engagement Score",
    type: "number",
    fieldType: "number",
    groupName: GROUP_NAME,
    description: `Score 0-100 de interacción del contacto con nuestras campañas. Cuanto más alto, más cercano está el contacto a convertirse en cliente.

Cada canal usa SU fuente real de datos:

EMAIL (max 50) — fuente: Lemlist (sync vía webhook)
  +1   Email enviado (prueba que está en campaña activa)
  +5   Email abierto (max 15, hasta 3 aperturas)
  +15  Email con click (max 30, hasta 2 clicks)
  +25  Email respondido (max 50, hasta 2 respuestas)

LINKEDIN (max 50) — fuente: Lemlist (Lemlist gestiona los touches LinkedIn)
  +1   Mensaje LinkedIn enviado
  +15  Invitación LinkedIn aceptada (señal grande de warm)
  +30  Respuesta en LinkedIn (max 60, hasta 2 respuestas)

LLAMADAS (max 50) — fuente: HubSpot (sync vía webhook real-time + categorización IA Claude)
  +50  Llamada categorizada "Interesado"
  +40  Llamada "Pidió callback"
  +25  Objeción de timing (sigue caliente)
  +15  Objeción de precio
  +5   Objeción otra (sin necesidad, autoridad, solución actual)
  +3   Voicemail / gatekeeper (intento sin diálogo)

BOOST DE RECIENCIA
  +10  Si hay actividad en los últimos 7 días

Se recalcula automáticamente cada vez que el contacto se sincroniza a HubSpot. Las llamadas se traen desde HubSpot (webhook /api/hubspot/webhook/calls) y se analizan con IA antes de afectar el score.`
  },
  {
    name: "wecad_last_engagement_at",
    label: "weCAD Last Engagement At",
    type: "datetime",
    fieldType: "date",
    groupName: GROUP_NAME,
    description: "Fecha de la última interacción del contacto (email open, reply, llamada, etc.). Se actualiza junto con el engagement score."
  }
];

const COMPANY_PROPERTIES: PropertyDef[] = [
  {
    name: "wecad_company_id",
    label: "weCAD Company ID",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME,
    description: "UUID de la empresa en la base de la app weCAD4you (Supabase)."
  },
  {
    name: "wecad_company_type",
    label: "weCAD Company Type",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    options: [
      { label: "Dental laboratory", value: "lab" },
      { label: "Multi-location clinic", value: "multi_clinic" },
      { label: "DSO", value: "dso" }
    ]
  },
  {
    name: "wecad_cad_software",
    label: "weCAD CAD Software",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME
  },
  {
    name: "wecad_scanner_technology",
    label: "weCAD Scanner Technology",
    type: "string",
    fieldType: "text",
    groupName: GROUP_NAME
  },
  {
    name: "wecad_fit_signals",
    label: "weCAD Fit Signals",
    type: "string",
    fieldType: "textarea",
    groupName: GROUP_NAME,
    description: "Señales detectadas por la fase de discovery (hiring CAD, exocad mention, etc.)."
  },
  {
    name: "wecad_company_fit_score",
    label: "weCAD Company Fit Score",
    type: "enumeration",
    fieldType: "select",
    groupName: GROUP_NAME,
    description: "Banda de fit de la empresa estimada por Claude en discovery.",
    options: [
      { label: "High", value: "high" },
      { label: "Medium", value: "medium" },
      { label: "Low", value: "low" }
    ]
  },
  {
    name: "wecad_approved_at",
    label: "weCAD Approved At",
    type: "datetime",
    fieldType: "date",
    groupName: GROUP_NAME
  },
  {
    name: "wecad_clay_pushed_at",
    label: "weCAD Clay Pushed At",
    type: "datetime",
    fieldType: "date",
    groupName: GROUP_NAME
  }
];

// Cache module-scoped: una vez que confirmamos que las props existen en la
// cuenta, no hace falta volver a chequear. Si el deploy se reinicia, vuelve
// a chequear. Para reset manual, redeploy.
let ensuredContacts = false;
let ensuredCompanies = false;

export async function ensureContactProperties(opts: { force?: boolean } = {}): Promise<{
  ok: boolean;
  created: string[];
  errors: Array<{ property: string; error: string }>;
}> {
  if (!opts.force && ensuredContacts) return { ok: true, created: [], errors: [] };
  const result = await ensureForObject("contacts", CONTACT_PROPERTIES);
  if (result.ok) ensuredContacts = true;
  return result;
}

export async function ensureCompanyProperties(opts: { force?: boolean } = {}): Promise<{
  ok: boolean;
  created: string[];
  errors: Array<{ property: string; error: string }>;
}> {
  if (!opts.force && ensuredCompanies) return { ok: true, created: [], errors: [] };
  const result = await ensureForObject("companies", COMPANY_PROPERTIES);
  if (result.ok) ensuredCompanies = true;
  return result;
}

async function ensureForObject(
  objectType: "contacts" | "companies",
  definitions: PropertyDef[]
): Promise<{
  ok: boolean;
  created: string[];
  errors: Array<{ property: string; error: string }>;
}> {
  const created: string[] = [];
  const errors: Array<{ property: string; error: string }> = [];

  // 1) Asegurar el grupo wecad4you existe.
  const groupRes = await ensureGroup(objectType, GROUP_NAME, GROUP_LABEL);
  if (!groupRes.ok) {
    return {
      ok: false,
      created,
      errors: [{ property: `[group ${GROUP_NAME}]`, error: groupRes.error }]
    };
  }

  // 2) Listar props existentes.
  const list = await listProperties(objectType);
  if (!list.ok) {
    return {
      ok: false,
      created,
      errors: [{ property: "[listProperties]", error: list.error }]
    };
  }
  const existing = new Set(list.data?.results.map((r) => r.name) ?? []);

  // 3) Crear las que falten.
  for (const def of definitions) {
    if (existing.has(def.name)) continue;
    const res = await createProperty(objectType, def);
    if (res.ok) {
      created.push(def.name);
    } else {
      errors.push({ property: def.name, error: res.error });
    }
  }

  return { ok: errors.length === 0, created, errors };
}
