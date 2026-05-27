import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateContactMessages } from "@/lib/messageGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = supabaseAdmin();

  const { data: contact } = await db
    .from("contacts")
    .select("id, first_name, last_name, job_title, linkedin_headline, email, company_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  const { data: company } = await db
    .from("companies")
    .select("id, company_name, fit_signals, deep_research, client_id")
    .eq("id", contact.company_id)
    .maybeSingle();

  const [{ data: icpCtx }, trainingResult] = await Promise.all([
    db.from("client_ai_context")
      .select("content")
      .eq("client_id", company?.client_id ?? "")
      .eq("file_type", "icp")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("model_training_config")
      .select("business_description, value_props, talking_points, target_buyer_persona")
      .eq("client_id", company?.client_id ?? "")
      .maybeSingle()
      .catch(() => ({ data: null })),
  ]);

  const tc = (trainingResult as any)?.data ?? {};
  const icpContext = [
    icpCtx?.content,
    tc.business_description && `Descripción del negocio: ${tc.business_description}`,
    tc.value_props          && `Propuestas de valor: ${tc.value_props}`,
    tc.talking_points       && `Puntos clave: ${tc.talking_points}`,
    tc.target_buyer_persona && `Buyer persona: ${tc.target_buyer_persona}`,
    company?.fit_signals    && `Señales de fit: ${company.fit_signals}`,
  ].filter(Boolean).join("\n\n") || undefined;

  let deepResearch = null;
  try {
    const raw = company?.deep_research;
    if (raw) deepResearch = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { /* */ }

  const msgs = await generateContactMessages({
    hasEmail:         Boolean(contact.email?.trim()),
    firstName:        contact.first_name        ?? undefined,
    lastName:         contact.last_name         ?? undefined,
    jobTitle:         contact.job_title         ?? undefined,
    linkedinHeadline: contact.linkedin_headline ?? undefined,
    companyName:      company?.company_name     ?? undefined,
    icpContext,
    deepResearch,
    language: "es",
  });

  return NextResponse.json(msgs);
}
