import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncContactToHubSpot } from "@/lib/hubspotContactSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hubspot/push-contact/[id]
// Sincroniza manualmente un contacto de Supabase con HubSpot.

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const result = await syncContactToHubSpot(db, id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    contactId: id,
    hubspot_id: (result as any).hubspot_id,
    created: (result as any).created,
  });
}
