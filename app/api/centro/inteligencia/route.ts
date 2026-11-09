import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser, isCentroOwner } from "@/lib/centroProspeccion/access";
import { loadClientLinks } from "@/lib/centroProspeccion/portalLink";
import { runClientIntel, type IntelRow } from "@/lib/centroProspeccion/intel/run";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MIGRATION = "Falta ejecutar la migración supabase/20261106_centro_inteligencia_migration.sql en Supabase.";

// GET: inteligencia de la última semana generada (o ?semana=AAAA-MM-DD), por
// cliente, con las fichas vinculadas. POST {client_id}: la genera ahora
// (solo administración del Centro; cuesta ~US$0,05–0,15 por cliente).
export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const db = supabaseAdmin();
  let semana = req.nextUrl.searchParams.get("semana");
  if (!semana) {
    const { data, error } = await db.from("centro_intel").select("semana").order("semana", { ascending: false }).limit(1);
    if (error) return NextResponse.json({ error: /does not exist|relation/i.test(error.message) ? MIGRATION : error.message, filas: [] });
    semana = (data?.[0] as { semana?: string } | undefined)?.semana ?? null;
  }
  if (!semana) return NextResponse.json({ semana: null, filas: [] });
  const [{ data: rows, error }, links] = await Promise.all([
    db.from("centro_intel").select("*").eq("semana", semana),
    loadClientLinks(),
  ]);
  if (error) return NextResponse.json({ error: error.message, filas: [] });
  const name = new Map(links.clients.map((c) => [c.id, c.name]));
  const filas = (rows as IntelRow[] ?? []).map((r) => ({
    ...r,
    cliente: name.get(r.client_id) ?? r.client_id,
    fichas: (links.fichasByClient.get(r.client_id) ?? []).map((f) => ({ id: f.id, nombre: String(f.data.nombre || f.id) })),
  })).sort((a, b) => a.cliente.localeCompare(b.cliente));
  return NextResponse.json({ semana, filas });
}

export async function POST(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  if (!isCentroOwner(u.email)) return NextResponse.json({ error: "Solo administración del Centro" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.client_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "client_id inválido" }, { status: 400 });
  const row = await runClientIntel(id, u.email);
  return NextResponse.json({ fila: row }, { status: row.status === "error" ? 500 : 200 });
}
