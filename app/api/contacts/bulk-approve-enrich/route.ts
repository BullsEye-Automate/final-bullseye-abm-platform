import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushContactPhoneToClay } from "@/lib/clayPushContactPhone";
import { syncContactToHubSpot } from "@/lib/syncContactToHubSpot";
import { pushContactsToLemlist } from "@/lib/lemlistPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const clientId   = body.client_id ?? null;
  const contactIds: string[] | undefined = body.contact_ids;
  const db = supabaseAdmin();

  let q = db
    .from("contacts")
    .select("id, first_name, last_name, job_title, linkedin_url, email, company_id, client_id, linkedin_icebreaker, email_subject, email_body")
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

  let pushed       = 0;
  let errors       = 0;
  let phonePushed  = 0;
  let phoneErrors  = 0;
  let hsPushed     = 0;
  let hsErrors     = 0;
  let lemPushed    = 0;
  let lemErrors    = 0;

  for (const contact of contacts) {
    // 1. Marcar como aprobado
    const { error: updErr } = await db
      .from("contacts")
      .update({
        status:             "enriched",
        lemlist_pushed_at:  new Date().toISOString(),
      })
      .eq("id", contact.id);
    if (updErr) { errors++; continue; }
    pushed++;

    // 2. Push a Clay para waterfall de teléfono (no bloqueante)
    const clayResult = await pushContactPhoneToClay(db, contact.id);
    if (clayResult.ok) phonePushed++;
    else               phoneErrors++;

    // 3. BYPASS: Push directo a HubSpot sin esperar Clay
    const hsResult = await syncContactToHubSpot(db, contact.id);
    if (hsResult.ok) hsPushed++;
    else { hsErrors++; console.error("[bulk-approve-enrich] HubSpot error:", hsResult.error); }

    // 4. BYPASS: Push a Lemlist sin esperar Clay
    if (contact.client_id) {
      try {
        const { status, result } = await pushContactsToLemlist(db, {
          client_id:   contact.client_id,
          contact_ids: [contact.id],
        });
        if (status === 200) lemPushed++;
        else {
          lemErrors++;
          console.error(`[bulk-approve-enrich] Lemlist push ${status}:`, JSON.stringify(result).slice(0, 150));
        }
      } catch (err: any) {
        lemErrors++;
        console.error("[bulk-approve-enrich] Lemlist push exception:", err?.message);
      }
    }
  }

  return NextResponse.json({
    pushed, errors, total: contacts.length,
    phone_enrichment: { pushed: phonePushed, errors: phoneErrors },
    hubspot:          { pushed: hsPushed,    errors: hsErrors },
    lemlist:          { pushed: lemPushed,   errors: lemErrors },
  });
}
