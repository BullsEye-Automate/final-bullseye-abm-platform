import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages } from "@/lib/messageGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { client_id, contact_id, manual } = body;

  if (!client_id) return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });

  const db = supabaseAdmin();

  // Cargar contexto ICP + config de entrenamiento
  const [{ data: icpCtx }, { data: tc }, { data: examples }, { data: styleData }] = await Promise.all([
    db.from("client_ai_context").select("content").eq("client_id", client_id).eq("file_type", "icp")
      .order("uploaded_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("model_training_config")
      .select("business_description, value_props, talking_points, style_tone, style_rules, style_avoid, style_email_length")
      .eq("client_id", client_id).maybeSingle(),
    db.from("message_examples").select("*").eq("client_id", client_id)
      .order("created_at", { ascending: false }).limit(5),
    db.from("model_training_config")
      .select("style_tone, style_rules, style_avoid, style_email_length")
      .eq("client_id", client_id).maybeSingle(),
  ]);

  const icpContext = [
    icpCtx?.content,
    tc?.business_description && `Descripción del negocio: ${tc.business_description}`,
    tc?.value_props           && `Propuestas de valor: ${tc.value_props}`,
    tc?.talking_points        && `Puntos clave: ${tc.talking_points}`,
  ].filter(Boolean).join("\n\n") || undefined;

  // Datos del contacto: desde DB o manual
  let firstName: string | undefined;
  let lastName: string | undefined;
  let jobTitle: string | undefined;
  let companyName: string | undefined;
  let linkedinHeadline: string | undefined;
  let hasEmail = true;

  if (contact_id) {
    const { data: contact } = await db
      .from("contacts")
      .select("first_name, last_name, job_title, linkedin_headline, email, company_id")
      .eq("id", contact_id).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

    firstName = contact.first_name ?? undefined;
    lastName  = contact.last_name  ?? undefined;
    jobTitle  = contact.job_title  ?? undefined;
    linkedinHeadline = contact.linkedin_headline ?? undefined;
    hasEmail  = Boolean(contact.email?.trim());

    if (contact.company_id) {
      const { data: company } = await db.from("companies").select("company_name").eq("id", contact.company_id).maybeSingle();
      companyName = company?.company_name ?? undefined;
    }
  } else if (manual) {
    firstName   = manual.firstName   || undefined;
    lastName    = manual.lastName    || undefined;
    jobTitle    = manual.jobTitle    || undefined;
    companyName = manual.companyName || undefined;
    hasEmail    = manual.hasEmail    ?? true;
  } else {
    return NextResponse.json({ error: "Se requiere contact_id o manual" }, { status: 400 });
  }

  const msgs = await generateContactMessages({
    hasEmail,
    firstName,
    lastName,
    jobTitle,
    linkedinHeadline,
    companyName,
    icpContext,
    fewShotExamples: (examples ?? []).map((e) => ({
      emailSubject: e.email_subject,
      emailBody:    e.email_body,
      icebreaker:   e.icebreaker ?? "",
      contactName:  e.contact_name ?? "",
      jobTitle:     e.job_title    ?? "",
    })),
    styleGuide: styleData ? {
      tone:        styleData.style_tone        ?? "",
      rules:       styleData.style_rules       ?? "",
      avoid:       styleData.style_avoid       ?? "",
      emailLength: styleData.style_email_length ?? "corto",
    } : undefined,
    language: "es",
  });

  return NextResponse.json({
    messages: msgs,
    contact: { firstName, lastName, jobTitle, companyName },
  });
}
