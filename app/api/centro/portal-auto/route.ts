import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { loadClientLinks } from "@/lib/centroProspeccion/portalLink";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Lo que cada prospectora hizo en el portal (Empresas, Contactos y Búsqueda
// manual) por cliente en una semana del plan del Centro de prospección.
// Solo lee: no toca el plan ni las tablas de prospección.
//   propuestas  empresas propuestas al cliente desde Empresas
//   revisados   contactos IA revisados (aprobados + rechazados)
//   aprobados   contactos aprobados (incluye los agregados a mano)
//   manuales    contactos agregados a mano en Búsqueda manual
//   busquedas   empresas cerradas en Búsqueda manual (con o sin contactos)

type Counts = { propuestas: number; revisados: number; aprobados: number; manuales: number; busquedas: number };
const empty = (): Counts => ({ propuestas: 0, revisados: 0, aprobados: 0, manuales: 0, busquedas: 0 });

// Medianoche de Chile (America/Santiago, con horario de verano) en UTC
function chileMidnightUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const offset = local - guess.getTime(); // ms que Chile va adelante (negativo)
  return new Date(Date.UTC(y, m - 1, d) - offset);
}

const PAGE = 1000;
async function readAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const semana = req.nextUrl.searchParams.get("semana") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semana)) return NextResponse.json({ error: "semana inválida (AAAA-MM-DD)" }, { status: 400 });

  const a = chileMidnightUtc(semana);
  const next = new Date(Date.UTC(+semana.slice(0, 4), +semana.slice(5, 7) - 1, +semana.slice(8, 10) + 7));
  const b = chileMidnightUtc(next.toISOString().slice(0, 10));
  const ai = a.toISOString(), bi = b.toISOString();
  const db = supabaseAdmin();

  try {
    const [links, reviewed, manual, proposed, searches] = await Promise.all([
      loadClientLinks(),
      readAll<{ client_id: string; reviewed_by_email: string | null; status: string }>((f, t) =>
        db.from("wishlist_contacts").select("client_id, reviewed_by_email, status")
          .gte("reviewed_at", ai).lt("reviewed_at", bi).not("reviewed_by_email", "is", null).range(f, t)),
      readAll<{ client_id: string; added_by_email: string | null }>((f, t) =>
        db.from("wishlist_contacts").select("client_id, added_by_email")
          .eq("origin", "manual").gte("created_at", ai).lt("created_at", bi).range(f, t)),
      readAll<{ client_id: string; requested_by_email: string | null }>((f, t) =>
        db.from("client_wishlist").select("client_id, requested_by_email")
          .eq("origin", "bullseye").gte("created_at", ai).lt("created_at", bi).range(f, t)),
      readAll<{ client_id: string; manual_by_email: string | null }>((f, t) =>
        db.from("client_wishlist").select("client_id, manual_by_email")
          .in("manual_status", ["done", "no_contacts"]).gte("manual_updated_at", ai).lt("manual_updated_at", bi).range(f, t)),
    ]);

    // Conteos por cliente del portal + correo
    const byKey = new Map<string, Counts>();
    const bump = (clientId: string, email: string | null | undefined, k: keyof Counts) => {
      if (!email) return;
      const key = `${clientId}|${email.trim().toLowerCase()}`;
      const c = byKey.get(key) ?? empty();
      c[k]++;
      byKey.set(key, c);
    };
    for (const r of reviewed) {
      bump(r.client_id, r.reviewed_by_email, "revisados");
      if (r.status === "approved") bump(r.client_id, r.reviewed_by_email, "aprobados");
    }
    for (const r of manual) bump(r.client_id, r.added_by_email, "manuales");
    for (const r of proposed) bump(r.client_id, r.requested_by_email, "propuestas");
    for (const r of searches) bump(r.client_id, r.manual_by_email, "busquedas");

    // Se entrega por ficha del Centro (clienteId) + correo
    const rows: ({ clienteId: string; email: string } & Counts)[] = [];
    for (const [key, c] of byKey) {
      const [clientId, email] = key.split("|");
      for (const f of links.fichasByClient.get(clientId) ?? []) rows.push({ clienteId: f.id, email, ...c });
    }
    const linked = Object.fromEntries(links.fichas.map((f) => [f.id, links.byFicha.get(f.id)?.name ?? null]));
    return NextResponse.json({ semana, desde: ai, hasta: bi, rows, linked });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
