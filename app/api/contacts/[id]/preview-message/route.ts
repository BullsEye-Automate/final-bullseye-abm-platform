import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages } from "@/lib/messageGenerator";
import { loadActiveModelTrainingConfig } from "@/lib/modelTrainingConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/[id]/preview-message
// Genera (o regenera) los mensajes de outreach para un contacto sin guardarlos.
// Body opcional: { save?: boolean } — si true, guarda los mensajes en Supabase.

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  let save = false;
  try {
    const body = await req.json();
    save = !!body?.save;
  } catch {
    // Body opcional
  }

  const db = supabaseAdmin();

  // Cargar contacto
  const { data: contact, error: contactErr } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, email, fit_reason, company_id, client_id"
    )
    .eq("id", id)
    .maybeSingle();

  if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  // Cargar empresa
  const { data: company } = await db
    .from("companies")
    .select("company_name, company_type, tool_primary, tool_secondary, research_summary, client_id")
    .eq("id", contact.company_id)
    .maybeSingle();

  const clientId = contact.client_id ?? company?.client_id ?? null;

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

  // Cargar config de entrenamiento
  const trainingConfig = await loadActiveModelTrainingConfig(db);

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

    // Guardar si se solicitó
    if (save) {
      const msgUpdate: Record<string, string | null> = {};
      if (messages.linkedinIcebreaker) msgUpdate["linkedin_icebreaker"] = messages.linkedinIcebreaker;
      else if (messages.linkedinIcebreakerNoEmail) msgUpdate["linkedin_icebreaker"] = messages.linkedinIcebreakerNoEmail;
      if (messages.emailSubject) msgUpdate["email_subject"] = messages.emailSubject;
      if (messages.emailBody) msgUpdate["email_body"] = messages.emailBody;

      if (Object.keys(msgUpdate).length > 0) {
        await db.from("contacts").update(msgUpdate).eq("id", id);
      }
    }

    return NextResponse.json({ ok: true, messages, saved: save });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
