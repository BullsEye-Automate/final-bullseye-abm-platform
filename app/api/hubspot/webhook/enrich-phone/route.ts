import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enrichContactPhone } from "@/lib/phoneEnrichment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Target del HubSpot Workflow cuando el SDR cambia
// wecad_phone_enrichment_status = "requested".
//
// HubSpot Workflow → Action "Send a webhook":
//   Method: POST
//   URL: https://wecad-prospecting.vercel.app/api/hubspot/webhook/enrich-phone
//   Headers:
//     x-webhook-secret: <CRON_SECRET>
//   Method: Body sends the contact object (incluye properties.wecad_contact_id).
//
// El handler extrae wecad_contact_id del body (HubSpot wrap-ea las
// propiedades como { properties: { wecad_contact_id: { value: "..." } } }
// pero también soportamos shapes plana { wecad_contact_id: "..." }).

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (expected) {
    const got =
      req.headers.get("x-webhook-secret") ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    if (got !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const contactId = extractContactId(body);
  if (!contactId) {
    return NextResponse.json(
      {
        error: "wecad_contact_id not found in webhook body",
        hint: "HubSpot Workflow webhook body must include the contact's wecad_contact_id property"
      },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const result = await enrichContactPhone(db, contactId);
  return NextResponse.json(result);
}

function extractContactId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  // Shape 1: { wecad_contact_id: "..." }
  if (typeof b.wecad_contact_id === "string") return b.wecad_contact_id;

  // Shape 2: { properties: { wecad_contact_id: "..." } }
  const props1 = b.properties as Record<string, unknown> | undefined;
  if (props1) {
    const v = props1.wecad_contact_id;
    if (typeof v === "string") return v;
    // Shape 3: HubSpot canonical { properties: { wecad_contact_id: { value: "..." } } }
    if (v && typeof v === "object") {
      const val = (v as { value?: string }).value;
      if (typeof val === "string") return val;
    }
  }

  // Shape 4: array de objetos (HubSpot Workflow envía a veces así)
  if (Array.isArray(b.objects)) {
    for (const obj of b.objects) {
      if (obj && typeof obj === "object") {
        const id = extractContactId(obj);
        if (id) return id;
      }
    }
  }

  return null;
}
