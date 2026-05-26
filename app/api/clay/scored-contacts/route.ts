import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Webhook entrante de Clay con el scoring de un contacto.
//
// Clay envía este payload después de correr "Lead Fit Score":
//   {
//     "bullseye_contact_id": "<uuid>",
//     "fit_score":           <number 1-10>,
//     "fit":                 "high" | "medium" | "low",
//     "fit_reason":          "<texto>",
//     "fit_action":          "enrich" | "manual_review" | "discard"
//   }
//
// Al recibir el scoring, el contacto sale de "Pendientes" y va al tab correcto:
//   enrich        → status = "enriched"  → tab "En campaña"
//   manual_review → fit_action solo      → tab "Revisión manual"
//   discard       → fit_action solo      → tab "Descartados"

type Body = {
  bullseye_contact_id: string;
  fit_score?: number | string | null;
  fit?: string | null;
  fit_reason?: string | null;
  fit_action?: "enrich" | "manual_review" | "discard" | string | null;
};

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.CLAY_WEBHOOK_SECRET;
  if (!expected) return true;
  const hdr =
    req.headers.get("x-webhook-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return hdr === expected;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    body = parsed as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const contactId = body.bullseye_contact_id?.trim();
  if (!contactId) {
    return NextResponse.json({ error: "bullseye_contact_id es requerido" }, { status: 400 });
  }

  const fitAction = (body.fit_action ?? "").toString().trim() as Body["fit_action"];
  const fitScore = body.fit_score != null ? Number(body.fit_score) : null;

  const updates: Record<string, unknown> = {
    fit:        body.fit        ?? null,
    fit_reason: body.fit_reason ?? null,
    fit_action: fitAction       || null,
    fit_score:  Number.isFinite(fitScore) ? fitScore : null,
    updated_at: new Date().toISOString(),
  };

  // Si Clay aprueba el contacto para enriquecer → pasa a "En campaña"
  if (fitAction === "enrich") {
    updates.status = "enriched";
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("contacts")
    .update(updates)
    .eq("id", contactId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, contact_id: contactId, fit_action: fitAction });
}
