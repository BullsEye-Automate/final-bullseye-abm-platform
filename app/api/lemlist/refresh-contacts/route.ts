import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";
import {
  searchHSContactByBullseyeId,
  searchHSContact,
  upsertHSContact,
  searchHSCompany,
  upsertHSCompany,
  associateContactCompany,
  patchHSContact,
  matchClientOption,
  computeEngagementScore,
} from "@/lib/hubspot";
import { generateSdrScript } from "@/lib/sdrScript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Trae todos los leads de una campaña de Lemlist con paginación.
async function fetchAllLeads(campaignId: string, credentials: string): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(
      `https://api.lemlist.com/api/campaigns/${campaignId}/leads?limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Basic ${credentials}` } }
    );
    if (!res.ok) break;
    const data = await res.json();
    const items: any[] = data?.items ?? (Array.isArray(data) ? data : []);
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }

  return all;
}

/**
 * POST /api/lemlist/refresh-contacts
 * Body: { client_id: string }
 *
 * 1. Trae todos los leads de la campaña Lemlist del cliente.
 * 2. Para cada lead, busca el contacto en Supabase por email o LinkedIn URL.
 * 3. Si Lemlist enriqueció el email de un contacto que no lo tenía, actualiza Supabase.
 * 4. Sincroniza (o re-sincroniza) a HubSpot.
 */
export async function POST(req: NextRequest) {
  let body: { client_id: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.client_id) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const apiKey = process.env.LEMLIST_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });

  const db = supabaseAdmin();
  const credentials = Buffer.from(`:${apiKey}`).toString("base64");

  const [{ data: client }, { data: config }] = await Promise.all([
    db.from("clients").select("name").eq("id", body.client_id).maybeSingle(),
    db.from("client_configs")
      .select("lemlist_campaign_id, hubspot_owner_id")
      .eq("client_id", body.client_id)
      .maybeSingle(),
  ]);

  if (!config?.lemlist_campaign_id) {
    return NextResponse.json({ error: "No hay campaña configurada" }, { status: 400 });
  }

  const leads = await fetchAllLeads(config.lemlist_campaign_id, credentials);
  if (leads.length === 0) {
    return NextResponse.json({ updated: 0, synced: 0, reason: "no_leads" });
  }

  // Indexar leads de Lemlist por email y por LinkedIn URL normalizado
  const leadByEmail    = new Map<string, any>();
  const leadByLinkedin = new Map<string, any>();
  for (const lead of leads) {
    if (lead.email?.trim())       leadByEmail.set(lead.email.trim().toLowerCase(), lead);
    if (lead.linkedinUrl?.trim()) {
      const norm = normalizeLinkedInUrl(lead.linkedinUrl);
      if (norm) leadByLinkedin.set(norm.toLowerCase(), lead);
    }
  }

  // Traer contactos de Supabase que ya fueron pusheados a Lemlist
  const { data: contacts } = await db
    .from("contacts")
    .select("id, first_name, last_name, job_title, linkedin_headline, email, phone, phone_source, linkedin_url, company_id, email_subject, email_body, linkedin_icebreaker, seniority, fit_score, status")
    .eq("client_id", body.client_id)
    .not("lemlist_pushed_at", "is", null);

  if (!contacts?.length) {
    return NextResponse.json({ updated: 0, synced: 0, reason: "no_contacts_pushed" });
  }

  // Datos de empresa + contexto para HubSpot/script
  const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))];
  const { data: companies } = await db
    .from("companies")
    .select("id, company_name, fit_signals")
    .in("id", companyIds);
  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));

  let trainingConfig: Record<string, string | null> = {};
  try {
    const { data: tc } = await db
      .from("model_training_config")
      .select("business_description, value_props, talking_points")
      .eq("client_id", body.client_id)
      .maybeSingle();
    trainingConfig = tc ?? {};
  } catch { /* tabla puede no existir */ }

  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", body.client_id)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const icpContext = [
    icpCtx?.content,
    trainingConfig.business_description && `Descripción del negocio: ${trainingConfig.business_description}`,
    trainingConfig.value_props          && `Propuestas de valor: ${trainingConfig.value_props}`,
    trainingConfig.talking_points       && `Puntos clave: ${trainingConfig.talking_points}`,
  ].filter(Boolean).join("\n\n") || undefined;

  const trainingCtxForScript = [
    trainingConfig.business_description && `Negocio: ${trainingConfig.business_description}`,
    trainingConfig.value_props          && `Propuesta de valor: ${trainingConfig.value_props}`,
    trainingConfig.talking_points       && `Puntos clave: ${trainingConfig.talking_points}`,
  ].filter(Boolean).join("\n") || null;

  const clientLabel = client?.name ? matchClientOption(client.name) : null;
  const campaignId  = config.lemlist_campaign_id;

  let updated = 0;
  let synced  = 0;
  const errors: { contact_id: string; error: string }[] = [];

  for (const contact of contacts) {
    try {
      // Buscar lead de Lemlist que corresponde a este contacto
      const normLinkedin = contact.linkedin_url ? (normalizeLinkedInUrl(contact.linkedin_url) ?? "").toLowerCase() : "";
      const lead =
        (contact.email ? leadByEmail.get(contact.email.toLowerCase()) : null) ??
        (normLinkedin    ? leadByLinkedin.get(normLinkedin)             : null);

      if (!lead) continue;

      // Detectar si Lemlist enriqueció el email donde antes no había
      const gotNewEmail = !contact.email?.trim() && !!lead.email?.trim();
      const gotNewPhone = !contact.phone?.trim()  && !!lead.phone?.trim();

      if (gotNewEmail || gotNewPhone) {
        const update: Record<string, string> = {};
        if (gotNewEmail) update.email = lead.email.trim();
        if (gotNewPhone) {
          update.phone        = lead.phone.trim();
          update.phone_source = "lemlist";
        }
        await db.from("contacts").update(update).eq("id", contact.id);
        Object.assign(contact, update);
        updated++;
      }

      // Sincronizar (o re-sincronizar) a HubSpot con datos actualizados
      const company     = companyById.get(contact.company_id);
      const companyName = company?.company_name ?? "";
      const fitSignals  = company?.fit_signals  ?? null;

      const isLushaPhone  = contact.phone_source === "lusha";
      const standardPhone = !isLushaPhone ? (contact.phone ?? null) : null;
      const lushaPhone    = isLushaPhone  ? (contact.phone ?? null) : null;

      const engagementScore = computeEngagementScore({ emailSent: true, hasRecentActivity: true });

      // Empresa en HubSpot
      let hsCompanyId: string | null = null;
      if (companyName) {
        const existingCompanyId = await searchHSCompany(companyName);
        hsCompanyId = await upsertHSCompany(
          { name: companyName, bullseye_fit_signals: fitSignals || undefined, bullseye_company_id: contact.company_id || undefined },
          existingCompanyId
        );
      }

      // Contacto en HubSpot — buscar por ID interno primero
      const existingContactId =
        await searchHSContactByBullseyeId(contact.id) ??
        (contact.email ? await searchHSContact(contact.email) : null);

      const contactProps: Record<string, string | number | null | undefined> = {
        email:                        contact.email               ?? undefined,
        firstname:                    contact.first_name          ?? undefined,
        lastname:                     contact.last_name           ?? undefined,
        jobtitle:                     contact.job_title           ?? undefined,
        phone:                        standardPhone               ?? undefined,
        linkedin_bio:                 contact.linkedin_url        ?? undefined,
        bullseye_contact_id:          contact.id,
        bullseye_client_name:         client?.name                ?? undefined,
        bullseye_seniority:           contact.seniority           ?? undefined,
        bullseye_linkedin_headline:   contact.linkedin_headline   ?? undefined,
        bullseye_email_subject:       contact.email_subject       ?? undefined,
        bullseye_email_body:          contact.email_body          ?? undefined,
        bullseye_linkedin_icebreaker: contact.linkedin_icebreaker ?? undefined,
        bullseye_telefono_lusha:      lushaPhone                  ?? undefined,
        bullseye_fit_score:           contact.fit_score           ?? undefined,
        bullseye_engagement_score:    engagementScore,
        bullseye_status:              contact.status              ?? undefined,
        bullseye_lemlist_campaign_id: campaignId,
        bullseye_phone_source:        contact.phone_source        ?? undefined,
        ...(config.hubspot_owner_id ? { hubspot_owner_id: config.hubspot_owner_id } : {}),
      };

      const hsContactId = await upsertHSContact(contactProps, existingContactId);

      if (hsContactId && hsCompanyId) {
        await associateContactCompany(hsContactId, hsCompanyId);
      }

      // Script SDR (fire & forget) si hay email y contacto en HubSpot
      if (hsContactId && contact.email) {
        generateSdrScript({
          firstName:   contact.first_name ?? "",
          lastName:    contact.last_name  ?? "",
          jobTitle:    contact.job_title  ?? "",
          companyName,
          fitSignals,
          icpContext:  icpContext ?? null,
          trainingCtx: trainingCtxForScript,
          emailBody:   contact.email_body          ?? null,
          icebreaker:  contact.linkedin_icebreaker ?? null,
        })
          .then((script) => patchHSContact(hsContactId, { bullseye_script_sdr_ia: script }))
          .catch(() => {/* no bloquea */});
      }

      synced++;
    } catch (err: any) {
      errors.push({ contact_id: contact.id, error: err?.message ?? "error" });
    }
  }

  return NextResponse.json({ updated, synced, errors });
}
