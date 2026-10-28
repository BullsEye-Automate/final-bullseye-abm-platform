import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS = "https://api.hubapi.com";

async function resolveToken(clientId: string | null): Promise<string> {
  const defaultToken = process.env.HUBSPOT_ACCESS_TOKEN ?? "";
  if (!clientId) return defaultToken;
  const db = supabaseAdmin();
  const { data } = await db
    .from("client_configs")
    .select("hubspot_access_token")
    .eq("client_id", clientId)
    .single();
  return data?.hubspot_access_token || defaultToken;
}

export async function GET(req: NextRequest) {
  const contactId = req.nextUrl.searchParams.get("contactId");
  const clientId  = req.nextUrl.searchParams.get("clientId");
  if (!contactId) return NextResponse.json({ meetings: [] });

  const token = await resolveToken(clientId);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  try {
    const assocR = await fetch(
      `${HS}/crm/v4/objects/contacts/${contactId}/associations/meetings?limit=10`,
      { headers }
    );
    if (!assocR.ok) return NextResponse.json({ meetings: [] });
    const assocD = await assocR.json();
    const ids: string[] = (assocD.results ?? []).map((r: any) => String(r.toObjectId));
    if (!ids.length) return NextResponse.json({ meetings: [] });

    const batchR = await fetch(`${HS}/crm/v3/objects/meetings/batch/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        properties: ["hs_meeting_title", "hs_meeting_start_time", "hs_meeting_end_time", "hs_meeting_outcome"],
        inputs: ids.map(id => ({ id })),
      }),
    });
    if (!batchR.ok) return NextResponse.json({ meetings: [] });
    const batchD = await batchR.json();

    const now = Date.now();
    const meetings = (batchD.results ?? [])
      .map((m: any) => ({
        id: m.id,
        title:   m.properties.hs_meeting_title      ?? null,
        start:   m.properties.hs_meeting_start_time ?? null,
        end:     m.properties.hs_meeting_end_time   ?? null,
        outcome: m.properties.hs_meeting_outcome    ?? null,
      }))
      // Reuniones de los últimos 30 días hacia adelante
      .filter((m: any) => m.start && new Date(m.start).getTime() > now - 30 * 24 * 3600 * 1000)
      .sort((a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 5);

    return NextResponse.json({ meetings });
  } catch {
    return NextResponse.json({ meetings: [] });
  }
}
