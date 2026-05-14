import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshLemlistPhones } from "@/lib/lemlistPhoneRefresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Consulta a Lemlist lead-por-lead + PATCH a HubSpot — puede ser lento con
// muchos contactos pendientes.
export const maxDuration = 300;

// POST /api/lemlist/refresh-phones   body opcional { limit?: number }
//
// Recorre los contactos en campaña sin teléfono de Lemlist registrado, le
// pregunta a Lemlist el lead enriquecido y, si hay teléfono, lo persiste en
// Supabase y lo PATCHea en HubSpot. Idempotente. Lo dispara el botón
// "Levantar teléfonos de Lemlist" en /telefonos.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawLimit = (body as { limit?: unknown }).limit;
  const limit = typeof rawLimit === "number" && rawLimit > 0 ? rawLimit : undefined;

  const db = supabaseAdmin();
  const result = await refreshLemlistPhones(db, { limit });
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
