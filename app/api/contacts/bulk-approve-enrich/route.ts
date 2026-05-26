import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";
import { syncContactToHubspot } from "@/lib/hubspotContactSync";
import { generateContactMessages } from "@/lib/messageGenerator";
import { loadActiveModelTrainingConfig } from "@/lib/modelTrainingConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/bulk-approve-enrich
// Aprueba en masa los contactos de manual_review y los empuja a Lemlist + HubSpot.
// Body: { contact_ids?: string[], client_id?: string }
// Si no se pasan contact_ids, aprueba todos los de manual_review (sin human_decision).

export async function POST(req: NextRequest) {
  let body: { contact_ids?: string[]; client_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body opcional
  }

  const db = supabaseAdmin();
  const trainingConfig = await loadActiveModelTrainingConfig(db);

  // Construir query de contactos a aprobar
  let query = db
    .from("contacts")
    .select("id, client_id, company_id, first_name, last_name, job_title, email, fit_reason, " +
      "linkedin_icebreaker, email_subject, email_body")
    .eq("fit_action", "manual_review")
    .is("human_decision", null);

  if (body.client_id) {
    query = query.eq("client_id", body.client_id);
  }
  if (body.contact_ids?.length) {
    query = query.in("id", body.contact_ids);
  }

  const { data: contacts, error: fetchErr } = await query.limit(100);

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ ok: true, total: 0, approved: 0, errors: [] });
  }

  // Cargar todas las empresas de una vez para resolver client_id
  const companyIds = [...new Set(contacts.map((c: any) => c.company_id).filter(Boolean))];
  const { data: companies } = await db
    .from("companies")
    .select("id, client_id, company_name, company_type, tool_primary, tool_secondary, research_summary")
    .in("id", companyIds);

  type CompanyRow = {
    id: string;
    client_id: string | null;
    company_name: string | null;
    company_type: string | null;
    tool_primary: string | null;
    tool_secondary: string | null;
    research_summary: string | null;
  };

  const companyMap = new Map<string, CompanyRow>(
    (companies ?? []).map((co: any) => [co.id, co as CompanyRow])
  );

  const results: { contactId: string; ok: boolean; error?: string }[] = [];

  for (const contact of contacts as any[]) {
    const company = companyMap.get(contact.company_id);
    const clientId = (contact.client_id ?? company?.client_id ?? body.client_id) as string | null;

    try {
      // Registrar aprobación humana
      await db.from("contacts").update({
        human_decision: "approved",
        human_decision_at: new Date().toISOString(),
        human_decision_by: "bulk",
      }).eq("id", contact.id);

      // Generar mensajes si faltan
      if (!contact.linkedin_icebreaker && !contact.email_subject) {
        // Cargar ICP context
        let icpContext: string | undefined;
        if (clientId) {
          const { data: icpData } = await db
            .from("icp_config")
            .select("notes, signals_strong, signals_medium")
            .eq("client_id", clientId)
            .eq("is_active", true)
            .maybeSingle();
          if (icpData) {
            icpContext = [
              icpData.notes,
              icpData.signals_strong?.length ? `Señales fuertes: ${icpData.signals_strong.join(", ")}` : null,
              icpData.signals_medium?.length ? `Señales medias: ${icpData.signals_medium.join(", ")}` : null,
            ]
              .filter(Boolean)
              .join("\n") || undefined;
          }
        }

        try {
          const messages = await generateContactMessages({
            hasEmail: !!contact.email,
            firstName: contact.first_name ?? undefined,
            lastName: contact.last_name ?? undefined,
            jobTitle: contact.job_title ?? undefined,
            companyName: company?.company_name ?? undefined,
            companyType: company?.company_type ?? undefined,
            toolPrimary: company?.tool_primary ?? undefined,
            toolSecondary: company?.tool_secondary ?? undefined,
            icpContext,
            fitReason: contact.fit_reason ?? undefined,
            language: trainingConfig?.language as "es" | "en" | undefined ?? "es",
            trainingConfig,
          });

          const msgUpdate: Record<string, string | null> = {};
          if (messages.linkedinIcebreaker) msgUpdate["linkedin_icebreaker"] = messages.linkedinIcebreaker;
          else if (messages.linkedinIcebreakerNoEmail) msgUpdate["linkedin_icebreaker"] = messages.linkedinIcebreakerNoEmail;
          if (messages.emailSubject) msgUpdate["email_subject"] = messages.emailSubject;
          if (messages.emailBody) msgUpdate["email_body"] = messages.emailBody;

          if (Object.keys(msgUpdate).length > 0) {
            await db.from("contacts").update(msgUpdate).eq("id", contact.id);
          }
        } catch (msgErr: unknown) {
          // No bloquear si falla la generación de mensajes
          console.error(`[bulk-approve] Error generando mensajes para ${contact.id}:`, msgErr);
        }
      }

      // Push a Lemlist
      const lemlistResult = await pushApprovedToLemlist(contact.id, clientId);

      // Sync a HubSpot (no bloquear)
      syncContactToHubspot(contact.id).catch((err) => {
        console.error(`[bulk-approve] Error HubSpot para ${contact.id}:`, err);
      });

      if (lemlistResult.ok) {
        results.push({ contactId: contact.id, ok: true });
      } else {
        results.push({ contactId: contact.id, ok: false, error: lemlistResult.error });
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ contactId: contact.id, ok: false, error });
    }
  }

  const approved = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok: true,
    total: contacts.length,
    approved,
    errors: errors.length > 0 ? errors : [],
  });
}
