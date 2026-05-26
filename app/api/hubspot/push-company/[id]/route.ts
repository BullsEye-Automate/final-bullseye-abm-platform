import { NextRequest, NextResponse } from "next/server";
import { pushCompanyToHubspot } from "@/lib/hubspotPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/hubspot/push-company/[id]
// Sincroniza una empresa de Supabase con HubSpot.

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  const result = await pushCompanyToHubspot(id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    companyId: id,
    hubspotCompanyId: result.hubspotCompanyId,
    created: result.created,
  });
}
