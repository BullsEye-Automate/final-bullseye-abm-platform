import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncContactToHubSpot } from "@/lib/syncContactToHubSpot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Genera mensajes (si hace falta), sube el contacto a la campaña real de
// Lemlist del cliente (con findEmail/verifyEmail/findPhone/linkedinEnrichment)
// y sincroniza a HubSpot. Acepta contactos con email O linkedin_url — los de
// Sales Navigator suelen no tener email todavía, Lemlist lo enriquece.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const forceRegenerate = body?.force_regenerate === true;
  const db = supabaseAdmin();

  const { data: contact, error } = await db
    .from("contacts")
    .select("id, client_id, email, linkedin_url, fit_action")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
  if (!contact.client_id) return NextResponse.json({ error: "El contacto no tiene cliente asignado" }, { status: 400 });
  if (!contact.email?.trim() && !contact.linkedin_url?.trim()) {
    return NextResponse.json({ error: "El contacto necesita email o LinkedIn para enviarse a Lemlist" }, { status: 400 });
  }

  if (contact.fit_action !== "enrich") {
    await db.from("contacts").update({ fit_action: "enrich" }).eq("id", contact.id);
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? (req.headers.get("host") ? `https://${req.headers.get("host")}` : "");
  if (!baseUrl) return NextResponse.json({ error: "No se pudo resolver la URL base de la app" }, { status: 500 });

  let lemlistResult: Record<string, unknown>;
  try {
    const res = await fetch(`${baseUrl}/api/lemlist/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: contact.client_id, contact_ids: [contact.id], force_regenerate: forceRegenerate }),
    });
    lemlistResult = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: (lemlistResult as any)?.error ?? `Lemlist push ${res.status}` }, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error de red al enviar a Lemlist" }, { status: 502 });
  }

  const hubspotResult = await syncContactToHubSpot(db, contact.id);

  return NextResponse.json({ ...lemlistResult, hubspot: hubspotResult });
}
