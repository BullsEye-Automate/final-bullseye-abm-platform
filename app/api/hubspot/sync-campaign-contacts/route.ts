import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncContactToHubSpot } from "@/lib/hubspotContactSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Backfill de contactos a HubSpot. Sincroniza todos los contactos que
// están en campaña de Lemlist o aprobados FIT pero que todavía no tienen
// hubspot_contact_id. Sirve para recuperar los que se trabajaron antes de
// que el push automático (webhook scored-contacts) estuviera activo.
// Idempotente — se puede correr las veces que haga falta.
export async function POST() {
  const db = supabaseAdmin();

  const { data: rows, error } = await db
    .from("contacts")
    .select("id")
    .is("hubspot_contact_id", null)
    .or("fit_action.eq.enrich,lemlist_pushed_at.not.is.null,human_decision.eq.approved");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (rows ?? []).map((r) => r.id);
  let synced = 0;
  const errors: { contact_id: string; error: string }[] = [];

  for (const id of ids) {
    const hs = await syncContactToHubSpot(db, id);
    if (hs.ok) synced += 1;
    else errors.push({ contact_id: id, error: hs.error });
  }

  return NextResponse.json({ total: ids.length, synced, errors });
}
