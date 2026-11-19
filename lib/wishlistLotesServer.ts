import type { SupabaseClient } from "@supabase/supabase-js";
import { countryOf, lotCountry, lotName, lotOf, LOT_KIND_LABEL, type LotKind, type LotTag } from "@/lib/wishlistLotes";

// Lotes de un cliente con su avance (lib/wishlistLotes.ts). Solo lectura.

export type Lot = {
  id: string; kind: LotKind; kindLabel: string; name: string; country: string | null;
  by: string | null; at: string; file: string | null; note: string | null;
  empresas: number; pendientes: number; aprobadas: number; rechazadas: number; descartadas: number;
  conBusqueda: number; pocosContactos: number; contactosEncontrados: number; contactosAprobados: number;
};

type WRow = {
  id: string; company_name: string; domain: string | null; origin: string | null; status: string; source: string | null; source_ref: string | null;
  snapshot: Record<string, unknown> | null; requested_by_email: string | null; created_at: string;
  contacts_status: string | null; contacts_found: number | null;
};

const APPROVED = new Set(["new", "in_lemlist", "in_progress", "contacts_found"]);

async function all<T>(q: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; f < 50_000; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function loadClientLots(db: SupabaseClient, clientId: string): Promise<{ lots: Lot[]; byItem: Record<string, string> }> {
  const [rows, recos, approved] = await Promise.all([
    all<WRow>((a, b) => db.from("client_wishlist")
      .select("id, company_name, domain, origin, status, source, source_ref, snapshot, requested_by_email, created_at, contacts_status, contacts_found")
      .eq("client_id", clientId).order("created_at").range(a, b)),
    // Recomendaciones de la IA que se agregaron: las propuestas del equipo que vienen de ahí son lote IA
    all<{ source: string; source_ref: string }>((a, b) => db.from("client_recommendations")
      .select("source, source_ref").eq("client_id", clientId).eq("status", "added").range(a, b)),
    all<{ wishlist_id: string }>((a, b) => db.from("wishlist_contacts")
      .select("wishlist_id").eq("client_id", clientId).eq("status", "approved").range(a, b)),
  ]);
  const recoKeys = new Set(recos.map((r) => `${r.source}:${r.source_ref}`));
  const ctApproved = new Map<string, number>();
  for (const c of approved) ctApproved.set(c.wishlist_id, (ctApproved.get(c.wishlist_id) ?? 0) + 1);

  const groups = new Map<string, { tag: LotTag; rows: WRow[] }>();
  const byItem: Record<string, string> = {};
  for (const r of rows) {
    const fromReco = r.origin === "bullseye" && !!r.source_ref && recoKeys.has(`${r.source}:${r.source_ref}`);
    const tag = lotOf({ ...r, snapshot: r.snapshot as never }, fromReco);
    byItem[r.id] = tag.id;
    const g = groups.get(tag.id) ?? { tag, rows: [] };
    g.rows.push(r);
    groups.set(tag.id, g);
  }

  const lots: Lot[] = Array.from(groups.values()).map(({ tag, rows: rs }) => {
    const country = lotCountry(rs.map((r) => countryOf({ domain: r.domain, snapshot: r.snapshot as never })));
    const at = tag.at || rs[0].created_at;
    return {
      id: tag.id, kind: tag.kind, kindLabel: LOT_KIND_LABEL[tag.kind], name: lotName(tag, country, rs[0].created_at), country,
      by: tag.by ?? rs[0].requested_by_email ?? null, at, file: tag.file ?? null, note: tag.note ?? null,
      empresas: rs.length,
      pendientes: rs.filter((r) => r.status === "proposed").length,
      aprobadas: rs.filter((r) => APPROVED.has(r.status)).length,
      rechazadas: rs.filter((r) => r.status === "rejected_by_client").length,
      descartadas: rs.filter((r) => r.status === "discarded").length,
      conBusqueda: rs.filter((r) => r.contacts_status === "done" || r.contacts_status === "few_contacts").length,
      pocosContactos: rs.filter((r) => r.contacts_status === "few_contacts").length,
      contactosEncontrados: rs.reduce((s, r) => s + (r.contacts_found ?? 0), 0),
      contactosAprobados: rs.reduce((s, r) => s + (ctApproved.get(r.id) ?? 0), 0),
    };
  });
  lots.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { lots, byItem };
}
