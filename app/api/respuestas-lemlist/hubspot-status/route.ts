import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { hsFetchWithRetry, hsHeaders } from "@/lib/hubspot";
import { loadClientHubspot } from "@/lib/respuestasLemlist/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Estado ACTUAL en HubSpot de los contactos de la bandeja de Respuestas Lemlist
// ("Asignación BullsEye por llamar - <cliente>"), para ver si el SDR ya gestionó
// la respuesta (Hot Calling → Reunión agendada, etc.). Requiere sesión.
// POST { ids: string[] } (ids de lemlist_replies) → { status: { [id]: valor | null } }
export async function POST(req: NextRequest) {
  const { ids } = (await req.json().catch(() => ({}))) as { ids?: string[] };
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ status: {} });
  const db = supabaseAdmin();
  const { data } = await db
    .from("lemlist_replies")
    .select("id, client_id, client_name, hs_contact_id")
    .in("id", ids.slice(0, 500))
    .not("hs_contact_id", "is", null);
  const rows = (data ?? []) as { id: string; client_id: string; client_name: string; hs_contact_id: string }[];

  // Agrupado por cliente: cada uno puede usar otro HubSpot y otra propiedad
  const byClient = new Map<string, typeof rows>();
  for (const r of rows) byClient.set(r.client_id, [...(byClient.get(r.client_id) ?? []), r]);
  const status: Record<string, string | null> = {};
  const errors: string[] = [];
  await Promise.all(Array.from(byClient.entries()).map(async ([clientId, list]) => {
    try {
      const hs = await loadClientHubspot({ id: clientId, name: list[0].client_name });
      if (!hs.contactStatus) { errors.push(`${list[0].client_name}: sin propiedad de estado del contacto`); return; }
      const contactIds = Array.from(new Set(list.map((r) => r.hs_contact_id)));
      const values = new Map<string, string | null>();
      for (let i = 0; i < contactIds.length; i += 100) {
        const res = await hsFetchWithRetry("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
          method: "POST",
          headers: hsHeaders(hs.token),
          body: JSON.stringify({ properties: [hs.contactStatus], inputs: contactIds.slice(i, i + 100).map((id) => ({ id })) }),
        });
        if (!res.ok) { errors.push(`${list[0].client_name}: HubSpot ${res.status}`); continue; }
        const j = await res.json();
        for (const c of j.results ?? []) values.set(String(c.id), c.properties?.[hs.contactStatus] ?? null);
      }
      for (const r of list) status[r.id] = values.get(r.hs_contact_id) ?? null;
    } catch (e) {
      errors.push(`${list[0].client_name}: ${(e as Error).message}`);
    }
  }));
  return NextResponse.json({ status, errors });
}
