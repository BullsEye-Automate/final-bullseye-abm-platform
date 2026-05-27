import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { searchHSContact, patchHSContact } from "@/lib/hubspot";
import { generateSdrScript } from "@/lib/sdrScript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    return await handleRequest(req);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error interno del servidor" }, { status: 500 });
  }
}

async function handleRequest(req: NextRequest) {
  let body: { client_id: string; contact_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.client_id) {
    return NextResponse.json({ error: "Se requiere client_id" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // ICP context
  const { data: icpCtx } = await db
    .from("client_ai_context")
    .select("content")
    .eq("client_id", body.client_id)
    .eq("file_type", "icp")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Training config (tabla puede no existir)
  let tc: Record<string, string | null> | null = null;
  try {
    const { data } = await db
      .from("model_training_config")
      .select("business_description, value_props, talking_points")
      .eq("client_id", body.client_id)
      .maybeSingle();
    tc = data;
  } catch { /* tabla no existe aún */ }

  const trainingCtx = [
    tc?.business_description && `Negocio: ${tc.business_description}`,
    tc?.value_props           && `Propuesta de valor: ${tc.value_props}`,
    tc?.talking_points        && `Puntos clave: ${tc.talking_points}`,
  ].filter(Boolean).join("\n") || null;

  // Contactos — sin script IA o todos si contact_ids especificado
  let q = db
    .from("contacts")
    .select("id, first_name, last_name, job_title, email, company_id, email_body, linkedin_icebreaker")
    .eq("client_id", body.client_id)
    .eq("fit_action", "enrich")
    .neq("status", "discarded");

  if (body.contact_ids?.length) {
    q = q.in("id", body.contact_ids);
  }

  const { data: contacts, error: cErr } = await q.limit(5);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!contacts?.length) return NextResponse.json({ generated: 0, errors: [] });

  // Empresas
  const companyIds = [...new Set(contacts.map((c) => c.company_id).filter(Boolean))];
  const { data: companies } = await db
    .from("companies")
    .select("id, company_name, fit_signals")
    .in("id", companyIds);
  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));

  let generated = 0;
  const errors: { contact_id: string; error: string }[] = [];

  for (const contact of contacts) {
    const company     = companyById.get(contact.company_id);
    const companyName = company?.company_name ?? "";

    try {
      const script = await generateSdrScript({
        firstName:   contact.first_name  ?? "",
        lastName:    contact.last_name   ?? "",
        jobTitle:    contact.job_title   ?? "",
        companyName,
        fitSignals:  company?.fit_signals    ?? null,
        icpContext:  icpCtx?.content        ?? null,
        emailBody:   contact.email_body     ?? null,
        icebreaker:  contact.linkedin_icebreaker ?? null,
        trainingCtx,
      });

      // Guardar en Supabase (silencioso si la columna no existe aún)
      try {
        await db.from("contacts").update({ sdr_script: script } as any).eq("id", contact.id);
      } catch { /* columna sdr_script puede no existir aún */ }

      // Sincronizar a HubSpot si el contacto tiene email
      if (contact.email) {
        const hsId = await searchHSContact(contact.email).catch(() => null);
        if (hsId) {
          await patchHSContact(hsId, { bullseye_script_sdr_ia: script });
        }
      }

      generated++;
    } catch (err: any) {
      const msg = err?.message ?? String(err) ?? "Error generando script";
      console.error(`[generate-scripts] contacto ${contact.id}:`, msg);
      errors.push({ contact_id: contact.id, error: msg });
    }
  }

  return NextResponse.json({ generated, errors });
}
