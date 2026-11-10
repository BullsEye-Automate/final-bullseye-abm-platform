import { NextRequest, NextResponse } from "next/server";
import { requireCentroUser } from "@/lib/centroProspeccion/access";
import { loadClientLinks } from "@/lib/centroProspeccion/portalLink";
import { computeAllClientsDashboard, type ProspectingKpis } from "@/lib/prospectingDashboard";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Resumen del portal para el Centro de prospección (fases 2-3, solo lectura):
//  - porFicha: KPIs de prospección del Dashboard (mismo cálculo,
//    computeAllClientsDashboard) + contactos IA por revisar, por ficha.
//  - pedidos: lo que los clientes piden o responden desde su portal
//    (empresas pedidas o subidas en listado y propuestas rechazadas), para la
//    bandeja única de Solicitudes.
// ?days= período de los KPIs (por defecto 30).

type Pedido = {
  id: string;
  clienteId: string | null;
  cliente: string;
  empresa: string;
  tipo: "pedida" | "rechazada";
  estado: string;
  fecha: string;
  motivo: string | null;
};

const pick = (k: ProspectingKpis) => ({
  propuestas: k.proposed,
  pedidasCliente: k.client_requested,
  aprobadas: k.approved,
  rechazadas: k.rejected,
  tasaAprobacion: k.approval_rate,
  prospectadas: k.prospected,
  contactosAuto: k.auto_contacts,
  contactosManuales: k.manual_contacts,
  contactosAprobados: k.contacts_approved,
  conEmail: k.contacts_with_email,
  conTelefono: k.contacts_with_phone,
  esperandoCliente: k.pending_approval,
  esperandoClienteDias: k.pending_approval_oldest_days,
  porProspectar: k.pending_prospecting,
  erroresLemlist: k.lemlist_errors,
  busquedaManual: k.manual_queue,
  activas: k.total_active,
});

export async function GET(req: NextRequest) {
  const u = await requireCentroUser();
  if (u.response) return u.response;
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const db = supabaseAdmin();

  try {
    const [links, dash, suggested, pedidosRes] = await Promise.all([
      loadClientLinks(),
      computeAllClientsDashboard(db, start, end),
      db.from("wishlist_contacts").select("client_id").eq("status", "suggested").limit(20000),
      db.from("client_wishlist")
        .select("id, client_id, company_name, status, origin, created_at, client_decision_at, client_reject_reason, clients(name)")
        .or(`and(origin.eq.client,created_at.gte.${start.toISOString()}),and(status.eq.rejected_by_client,client_decision_at.gte.${start.toISOString()})`)
        .order("created_at", { ascending: false })
        .limit(400),
    ]);

    const toReview = new Map<string, number>();
    for (const r of suggested.data ?? []) toReview.set(r.client_id, (toReview.get(r.client_id) ?? 0) + 1);

    const porFicha: Record<string, { clientId: string; cliente: string; porRevisar: number } & ReturnType<typeof pick>> = {};
    const cards = new Map(dash.clients.map((c) => [c.client_id, c]));
    for (const f of links.fichas) {
      const client = links.byFicha.get(f.id);
      if (!client) continue;
      const card = cards.get(client.id);
      const kpis = card ? pick(card.kpis) : null;
      porFicha[f.id] = {
        clientId: client.id,
        cliente: client.name,
        porRevisar: toReview.get(client.id) ?? 0,
        ...(kpis ?? pick({
          recommended_ai: 0, proposed: 0, client_requested: 0, approved: 0, rejected: 0, approval_rate: null, prospected: 0,
          prospected_ok: 0, prospected_few: 0, auto_contacts: 0, avg_auto_per_company: null, manual_contacts: 0,
          contacts_approved: 0, contacts_with_email: 0, contacts_with_phone: 0, pending_approval: 0,
          pending_approval_oldest_days: null, pending_prospecting: 0, lemlist_errors: 0, manual_queue: 0, total_active: 0,
        })),
      };
    }

    // Ficha principal de cada cliente del portal (la primera vinculada)
    const fichaOf = (clientId: string) => links.fichasByClient.get(clientId)?.[0]?.id ?? null;
    const pedidos: Pedido[] = (pedidosRes.data ?? []).map((w) => {
      const rel = w.clients as unknown as { name?: string } | { name?: string }[] | null;
      const name = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? "";
      const tipo: Pedido["tipo"] = w.status === "rejected_by_client" ? "rechazada" : "pedida";
      return {
        id: w.id,
        clienteId: fichaOf(w.client_id),
        cliente: name,
        empresa: w.company_name,
        tipo,
        estado: w.status,
        fecha: (tipo === "rechazada" ? w.client_decision_at : w.created_at) ?? w.created_at,
        motivo: w.client_reject_reason ?? null,
      };
    });

    return NextResponse.json({
      dias: days,
      porFicha,
      totales: pick(dash.totals),
      porRevisarTotal: Array.from(toReview.values()).reduce((s, n) => s + n, 0),
      pedidos,
      migration_missing: dash.migration_missing,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
