import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchHSOwners } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

// HubSpot propio del cliente (token de una app privada de solo lectura).
// El token NUNCA vuelve al navegador: GET solo dice si está conectado y sus
// últimos 4 caracteres. Al guardar se prueba primero contra HubSpot.
// Requiere sesión (middleware: /api/clients/[id]/* no es pública).

function mask(token: string | null | undefined) {
  const t = (token ?? "").trim();
  return t ? { connected: true, last4: t.slice(-4) } : { connected: false, last4: null };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin()
    .from("client_configs")
    .select("hubspot_access_token")
    .eq("client_id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(mask((data as any)?.hubspot_access_token));
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "Falta el token" }, { status: 400 });

  // probar antes de guardar: debe poder leer los usuarios de la cuenta
  let users = 0;
  try {
    users = (await fetchHSOwners(token)).length;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const hint = /401/.test(msg)
      ? "HubSpot rechazó el token (401). Revisa que esté bien copiado."
      : /403/.test(msg)
        ? "El token no tiene permiso para leer usuarios (crm.objects.owners.read)."
        : msg.slice(0, 300);
    return NextResponse.json({ error: hint }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from("client_configs")
    .upsert({ client_id: params.id, hubspot_access_token: token }, { onConflict: "client_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...mask(token), users });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin()
    .from("client_configs")
    .update({ hubspot_access_token: null })
    .eq("client_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(mask(null));
}
