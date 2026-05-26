import { NextRequest, NextResponse } from "next/server";
import { pushContactToHubspot } from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hubspot/push-contact/[id]
// Sincroniza un contacto de Supabase con HubSpot.

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  const result = await pushContactToHubspot(id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    contactId: id,
    hubspotContactId: result.hubspotContactId,
    created: result.created,
  });
}
