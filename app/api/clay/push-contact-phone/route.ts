import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushContactPhoneToClay } from "@/lib/clayPushContactPhone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/clay/push-contact-phone
// Body: { contact_id: string } o { contact_ids: string[] } o { linkedin_url, client_id, ad_hoc: true }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  // Modo ad-hoc: enriquecer un LinkedIn URL sin contacto existente (botón en /telefonos)
  if (body.ad_hoc && body.linkedin_url) {
    const webhookUrl = process.env.CLAY_CONTACTS_APPROVED_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json({ error: "CLAY_CONTACTS_APPROVED_WEBHOOK_URL no configurado" }, { status: 500 });
    }
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bullseye_contact_id: null,
        client_id:           body.client_id ?? null,
        linkedin_url:        body.linkedin_url,
        ad_hoc:              true,
      }),
    }).catch(() => null);

    if (!res?.ok) {
      return NextResponse.json({ error: `Clay webhook ${res?.status ?? "no-response"}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, mode: "ad_hoc" });
  }

  // Modo por contacto existente
  const ids: string[] = body.contact_ids ?? (body.contact_id ? [body.contact_id] : []);
  if (!ids.length) {
    return NextResponse.json({ error: "Se requiere contact_id, contact_ids o ad_hoc+linkedin_url" }, { status: 400 });
  }

  const results = await Promise.all(ids.map((id) => pushContactPhoneToClay(db, id)));
  const ok     = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({ ok, failed, results });
}
