import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS = "https://api.hubapi.com";

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

const CONTACT_PROPERTIES = [
  { name: "bullseye_seniority",            label: "Seniority (BullsEye)",          type: "string", fieldType: "text"     },
  { name: "bullseye_linkedin_headline",   label: "LinkedIn Headline (BullsEye)",  type: "string", fieldType: "text"     },
  { name: "bullseye_email_subject",       label: "Email Subject (BullsEye)",      type: "string", fieldType: "text"     },
  { name: "bullseye_email_body",          label: "Email Body (BullsEye)",         type: "string", fieldType: "textarea" },
  { name: "bullseye_linkedin_icebreaker", label: "LinkedIn Icebreaker",           type: "string", fieldType: "textarea" },
  { name: "bullseye_telefono_lusha",      label: "Teléfono Lusha",               type: "string", fieldType: "text"     },
  { name: "bullseye_fit_score",           label: "Fit Score (BullsEye)",          type: "number", fieldType: "number"   },
  {
    name: "bullseye_engagement_score",
    label: "BullsEye Engagement Score",
    type: "number",
    fieldType: "number",
    description: "Score 0-100 de interacción del contacto con las campañas (Lemlist + llamadas). Se recalcula en cada sync. EMAIL (max 50): +1 enviado, +5 abierto (max 15), +15 click (max 30), +25 respondido (max 50). LINKEDIN (max 50): +1 mensaje, +15 invitación aceptada, +30 respuesta. LLAMADAS: +50 interesado, +40 callback, +25 timing, +15 precio, +5 otra. +10 boost si actividad en últimos 7 días.",
  },
  { name: "bullseye_client_name",         label: "Cliente BullsEye",             type: "string", fieldType: "text"     },
  { name: "bullseye_status",              label: "Estado (BullsEye)",             type: "string", fieldType: "text"     },
  { name: "bullseye_contact_id",          label: "BullsEye Contact ID",           type: "string", fieldType: "text"     },
  { name: "bullseye_lemlist_pushed_at",   label: "Lemlist Pushed At",             type: "string", fieldType: "text"     },
  { name: "bullseye_phone_source",        label: "Fuente del Teléfono",           type: "string", fieldType: "text"     },
  { name: "bullseye_lemlist_campaign_id", label: "Lemlist Campaign ID",           type: "string", fieldType: "text"     },
  {
    name: "bullseye_script_sdr_ia",
    label: "Script SDR IA",
    type: "string",
    fieldType: "textarea",
    description: "Script personalizado generado por IA para la llamada SDR. Incluye apertura, propuesta de valor, preguntas de calificación, manejo de objeciones y CTA.",
  },
];

const COMPANY_PROPERTIES = [
  { name: "bullseye_fit_signals",        label: "Fit Signals (BullsEye)",    type: "string", fieldType: "textarea" },
  { name: "bullseye_company_id",         label: "BullsEye Company ID",       type: "string", fieldType: "text"     },
  { name: "bullseye_icp_score",          label: "ICP Score (BullsEye)",      type: "number", fieldType: "number"   },
  { name: "cliente_bullseye_empresa",    label: "Cliente BullsEye (Empresa)", type: "enumeration", fieldType: "select",
    options: [
      { label: "BullsEye",       value: "BullsEye",       displayOrder: 0, hidden: false },
      { label: "SOVOS",          value: "SOVOS",          displayOrder: 1, hidden: false },
      { label: "Crossnet",       value: "Crossnet",       displayOrder: 2, hidden: false },
      { label: "Apply Digital",  value: "Apply Digital",  displayOrder: 3, hidden: false },
      { label: "AcidLab",        value: "AcidLab",        displayOrder: 4, hidden: false },
      { label: "CanalCero",      value: "CanalCero",      displayOrder: 5, hidden: false },
      { label: "Lemu",           value: "Lemu",           displayOrder: 6, hidden: false },
      { label: "Webfleet",       value: "Webfleet",       displayOrder: 7, hidden: false },
      { label: "Ecommerce",      value: "Ecommerce",      displayOrder: 8, hidden: false },
      { label: "Otro",           value: "Otro",           displayOrder: 9, hidden: false },
    ]
  },
];

async function createProperty(
  objectType: "contacts" | "companies",
  prop: { name: string; label: string; type: string; fieldType: string; description?: string }
): Promise<{ name: string; status: "created" | "exists" | "error"; error?: string }> {
  const groupName = objectType === "contacts" ? "contactinformation" : "companyinformation";
  const res = await fetch(`${HS}/crm/v3/properties/${objectType}`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({ ...prop, groupName }),
  });

  if (res.ok)          return { name: prop.name, status: "created" };
  if (res.status === 409) return { name: prop.name, status: "exists"  };

  const text = await res.text().catch(() => "");
  return { name: prop.name, status: "error", error: text.slice(0, 200) };
}

export async function POST() {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return NextResponse.json({ error: "HUBSPOT_ACCESS_TOKEN no configurado" }, { status: 500 });
  }

  const contactResults = await Promise.all(
    CONTACT_PROPERTIES.map((p) => createProperty("contacts", p))
  );
  const companyResults = await Promise.all(
    COMPANY_PROPERTIES.map((p) => createProperty("companies", p))
  );

  const summary = {
    contacts: { created: 0, exists: 0, errors: 0 },
    companies: { created: 0, exists: 0, errors: 0 },
  };

  for (const r of contactResults) summary.contacts[r.status === "created" ? "created" : r.status === "exists" ? "exists" : "errors"]++;
  for (const r of companyResults) summary.companies[r.status === "created" ? "created" : r.status === "exists" ? "exists" : "errors"]++;

  return NextResponse.json({
    summary,
    contacts: contactResults,
    companies: companyResults,
  });
}
