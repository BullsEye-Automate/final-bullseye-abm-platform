import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isPeithoEnabled } from "@/lib/peitho";
import { loadPeithoClient, peithoGetJson, type PeithoClientRef } from "@/lib/peithoIntegration";
import type { MeetingListItem } from "@/components/peitho/app/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET — exporta en un JSON todas las reuniones pasadas de Peitho del cliente
// con su análisis completo (sin transcripción ni video), para armar informes
// (ej. informe de resultados de Peitho para el cliente). Solo equipo BullsEye:
// /api/clients/[id]/* requiere sesión interna (middleware.ts).
const CONCURRENCY = 5;
// Campos pesados del detalle que no sirven para un informe
const DROP_KEYS = /transcri|segments|utterances|video|recording|audio|pre_brief/i;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  // [id] acepta el id, el slug o el nombre del cliente (ej. /api/clients/crossnet/peitho/export)
  const ref = decodeURIComponent(params.id).replace(/[,()*%]/g, "").trim();
  let client: PeithoClientRef | null = /^[0-9a-f-]{36}$/i.test(ref) ? await loadPeithoClient(db, ref) : null;
  if (!client) {
    const { data } = await db.from("clients").select("id, slug, name").or(`slug.ilike.${ref},name.ilike.${ref}`).limit(1);
    client = data?.[0] ?? null;
  }
  if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  if (!(await isPeithoEnabled(db, client.id))) return NextResponse.json({ error: "Este cliente no tiene Peitho activado" }, { status: 403 });

  try {
    const meetings = await peithoGetJson<MeetingListItem[]>(client, "/meetings?scope=past");
    const analyzed = meetings.filter((m) => m.status === "analyzed");

    const details: Record<string, unknown>[] = [];
    const errors: { id: string; error: string }[] = [];
    for (let i = 0; i < analyzed.length; i += CONCURRENCY) {
      await Promise.all(
        analyzed.slice(i, i + CONCURRENCY).map(async (m) => {
          try {
            const d = await peithoGetJson<Record<string, unknown>>(client, `/meetings/${encodeURIComponent(m.id)}`);
            details.push(Object.fromEntries(Object.entries(d).filter(([k]) => !DROP_KEYS.test(k))));
          } catch (err) {
            errors.push({ id: m.id, error: err instanceof Error ? err.message : String(err) });
          }
        })
      );
    }
    const ejecutivos = await peithoGetJson<unknown>(client, "/panel/ejecutivos").catch(() => null);

    const body = JSON.stringify(
      { client: { id: client.id, name: client.name }, exported_at: new Date().toISOString(), meetings, details, ejecutivos, errors },
      null,
      1
    );
    const file = `peitho-${(client.slug ?? client.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(body, {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Peitho export:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo exportar" }, { status: 502 });
  }
}
