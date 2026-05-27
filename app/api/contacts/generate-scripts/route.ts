import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL } from "@/lib/claude";
import { searchHSContact, patchHSContact } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function generateSdrScript(opts: {
  firstName:    string;
  lastName:     string;
  jobTitle:     string;
  companyName:  string;
  fitSignals:   string | null;
  icpContext:   string | null;
  emailBody:    string | null;
  icebreaker:   string | null;
  trainingCtx:  string | null;
}): Promise<string> {
  const { firstName, lastName, jobTitle, companyName, fitSignals, icpContext, emailBody, icebreaker, trainingCtx } = opts;

  const system = `Eres un experto en ventas B2B que prepara scripts de llamada para SDRs.
Redacta scripts concisos y personalizados en formato bullet-points, listos para usar como material de apoyo durante la llamada.
Usa un tono consultivo y directo. Evita frases genéricas. Responde SOLO con el script en markdown.`;

  const user = `Prepara un script de llamada SDR para este contacto:

**Contacto:** ${firstName} ${lastName} — ${jobTitle} en ${companyName}
${fitSignals   ? `\n**Por qué encajan:** ${fitSignals}` : ""}
${icpContext   ? `\n**Contexto ICP / negocio:** ${icpContext}` : ""}
${trainingCtx  ? `\n**Propuesta de valor:** ${trainingCtx}` : ""}
${emailBody    ? `\n**Email ya enviado (para coherencia):** ${emailBody.slice(0, 400)}` : ""}
${icebreaker   ? `\n**Icebreaker LinkedIn:** ${icebreaker}` : ""}

---
Estructura el script con estas secciones (cada una 2-4 bullets breves):
1. **Apertura** — presentación + enganche personalizado a ${companyName}
2. **Propuesta de valor** — específica para el cargo de ${jobTitle}
3. **Preguntas de calificación** — para abrir el diálogo
4. **Manejo de objeción más probable** — respuesta corta lista para usar
5. **CTA** — siguiente paso concreto (reunión, demo, etc.)`;

  const res = await anthropic().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    messages: [{ role: "user", content: user }],
    system,
  });

  return (res.content[0] as { type: "text"; text: string }).text.trim();
}

export async function POST(req: NextRequest) {
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

  // ICP + training context
  const [{ data: icpCtx }, { data: tc }] = await Promise.all([
    db.from("client_ai_context")
      .select("content")
      .eq("client_id", body.client_id)
      .eq("file_type", "icp")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("model_training_config")
      .select("business_description, value_props, talking_points")
      .eq("client_id", body.client_id)
      .maybeSingle()
      .catch(() => ({ data: null })),
  ]);

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
  } else {
    q = q.is("sdr_script", null);
  }

  const { data: contacts, error: cErr } = await q.limit(30);
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

      // Guardar en Supabase
      await db.from("contacts").update({ sdr_script: script }).eq("id", contact.id);

      // Sincronizar a HubSpot si el contacto tiene email
      if (contact.email) {
        const hsId = await searchHSContact(contact.email).catch(() => null);
        if (hsId) {
          await patchHSContact(hsId, { bullseye_script_sdr_ia: script });
        }
      }

      generated++;
    } catch (err: any) {
      errors.push({ contact_id: contact.id, error: err?.message ?? "Error generando script" });
    }
  }

  return NextResponse.json({ generated, errors });
}
