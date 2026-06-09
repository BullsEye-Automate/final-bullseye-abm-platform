import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushContactPhoneToClay } from "@/lib/clayPushContactPhone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const clientId   = body.client_id ?? null;
  const contactIds: string[] | undefined = body.contact_ids;
  const db = supabaseAdmin();

  // Buscar contactos listos. Si se pasan contact_ids específicos, usar esos.
  // Si no, buscar todos los aprobados (fit_action='enrich', no descartados, no empujados aún).
  let q = db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, linkedin_url, email, company_id, client_id, linkedin_icebreaker, email_subject, email_body"
    )
    .neq("status", "discarded")
    .limit(100);

  if (contactIds?.length) {
    q = q.in("id", contactIds);
  } else {
    q = q.eq("fit_action", "enrich").is("lemlist_pushed_at", null);
    if (clientId) q = q.eq("client_id", clientId);
  }

  const { data: contacts, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!contacts?.length)
    return NextResponse.json({ pushed: 0, errors: 0, message: "No hay contactos por aprobar" });

  // Marcar como aprobados (status=enriched) y disparar el waterfall de teléfono en Clay.
  // El push REAL a Lemlist se encadena automáticamente cuando llega el teléfono enriquecido
  // (endpoint /api/clay/phone-enriched dispara /api/lemlist/push para ese contacto).
  let pushed     = 0;
  let errors     = 0;
  let phonePushed = 0;
  let phoneErrors = 0;

  for (const contact of contacts) {
    // Marcar lemlist_pushed_at = now() para sacar del bucket "por aprobar".
    // El push REAL a Lemlist se ejecuta cuando llega el teléfono enriquecido
    // (phone-enriched → /api/lemlist/push). Si Lemlist push falla, hay un retry manual
    // disponible en /campañas.
    const { error: updErr } = await db
      .from("contacts")
      .update({
        status:             "enriched",
        lemlist_pushed_at:  new Date().toISOString(),
      })
      .eq("id", contact.id);
    if (updErr) { errors++; continue; }
    pushed++;

    // Enriquecimiento de teléfono vía Clay (no bloqueante: si falla, sigue)
    const result = await pushContactPhoneToClay(db, contact.id);
    if (result.ok) phonePushed++;
    else           phoneErrors++;
  }

  return NextResponse.json({
    pushed, errors, total: contacts.length,
    phone_enrichment: { pushed: phonePushed, errors: phoneErrors },
  });
}
