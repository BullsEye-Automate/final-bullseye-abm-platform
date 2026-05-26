import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushApprovedToLemlist } from "@/lib/lemlistPush";
import { syncContactToHubspot } from "@/lib/hubspotContactSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contacts/[id]/decision
// Body: { decision: "approved" | "rejected", reason?: string, by?: string }
//
// Si approved: empuja a Lemlist y sincroniza con HubSpot.
// Si rejected: marca como descartado.

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "id requerido" }, { status: 400 });
  }

  let body: { decision?: string; reason?: string; by?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const { decision, reason, by } = body;

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: 'decision debe ser "approved" o "rejected"' },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  // Verificar que el contacto existe y obtener client_id desde empresa
  const { data: contact, error: fetchErr } = await db
    .from("contacts")
    .select("id, status, client_id, company_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });

  // Resolver client_id
  let clientId = contact.client_id ?? null;
  if (!clientId && contact.company_id) {
    const { data: co } = await db
      .from("companies")
      .select("client_id")
      .eq("id", contact.company_id)
      .maybeSingle();
    clientId = co?.client_id ?? null;
  }

  // Registrar la decisión humana
  const updateData: Record<string, any> = {
    human_decision: decision,
    human_decision_at: new Date().toISOString(),
    human_decision_reason: reason ?? null,
    human_decision_by: by ?? "manual",
  };

  if (decision === "rejected") {
    updateData["status"] = "discarded";
  }

  const { error: updateErr } = await db
    .from("contacts")
    .update(updateData)
    .eq("id", id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  if (decision === "rejected") {
    return NextResponse.json({ ok: true, decision, contactId: id });
  }

  // Aprobado: push a Lemlist + HubSpot
  const lemlistResult = await pushApprovedToLemlist(id, clientId);
  const hubspotResult = await syncContactToHubspot(id);

  return NextResponse.json({
    ok: true,
    decision,
    contactId: id,
    lemlist: lemlistResult.ok
      ? { ok: true, leadId: lemlistResult.leadId }
      : { ok: false, error: lemlistResult.error },
    hubspot: hubspotResult.ok
      ? { ok: true, hubspotContactId: hubspotResult.hubspotContactId }
      : { ok: false, error: hubspotResult.error },
  });
}
