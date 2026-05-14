import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { linkOrphanCalls } from "@/lib/callsLinkOrphans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/calls/link-orphans
// Body opcional: { limit?: number, import_unmatched?: boolean }
//
// Para cada call con hubspot_contact_id NOT NULL pero contact_id NULL:
//   1. Pide el contacto a HubSpot y trata de matchear contra Supabase por
//      wecad_contact_id → hubspot_contact_id → linkedin_url → email.
//   2. Si no matchea Y import_unmatched=true (default), importa el contacto
//      + su empresa desde HubSpot a Supabase como contactos "contacted" y
//      vincula la call a la nueva row.
export async function POST(req: NextRequest) {
  let body: { limit?: number; import_unmatched?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty ok */
  }

  const db = supabaseAdmin();
  try {
    const result = await linkOrphanCalls(db, {
      limit: body.limit,
      importUnmatched: body.import_unmatched
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
