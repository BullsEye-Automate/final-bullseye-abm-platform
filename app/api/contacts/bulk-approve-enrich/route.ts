import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const clientId = body.client_id ?? null;
  const db = supabaseAdmin();

  // Buscar contactos listos: fit_action='enrich', lemlist aún no empujado, no descartados
  let q = db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, linkedin_url, email, company_id, linkedin_icebreaker, email_subject, email_body"
    )
    .eq("fit_action", "enrich")
    .is("lemlist_pushed_at", null)
    .neq("status", "discarded")
    .limit(100);
  if (clientId) q = q.eq("client_id", clientId);

  const { data: contacts, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!contacts?.length)
    return NextResponse.json({ pushed: 0, errors: 0, message: "No hay contactos por aprobar" });

  // Marcar como empujados a Lemlist (lemlist_pushed_at + status = enriched)
  // El push real a Lemlist se realiza en lib/messageGenerator.ts o similar
  let pushed = 0;
  let errors = 0;
  for (const contact of contacts) {
    const { error: updErr } = await db
      .from("contacts")
      .update({
        lemlist_pushed_at: new Date().toISOString(),
        status: "enriched"
      })
      .eq("id", contact.id);
    if (updErr) errors++;
    else pushed++;
  }

  return NextResponse.json({ pushed, errors, total: contacts.length });
}
