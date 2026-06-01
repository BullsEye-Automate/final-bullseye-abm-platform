import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId  = req.nextUrl.searchParams.get("client_id"); // "__all__" o uuid
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam   = req.nextUrl.searchParams.get("to");

  const db = supabaseAdmin();
  const isAll = !clientId || clientId === "__all__";

  // ── Helpers de filtro ──────────────────────────────────────────────
  function addClientFilter<T extends object>(q: any): any {
    return isAll ? q : q.eq("client_id", clientId);
  }
  function addDateFilter(q: any, col: string): any {
    if (fromParam) q = q.gte(col, fromParam);
    if (toParam)   q = q.lte(col, toParam);
    return q;
  }

  // ── Empresas ───────────────────────────────────────────────────────
  const { count: totalEmpresas } = await addClientFilter(
    db.from("companies").select("id", { count: "exact", head: true })
  );

  // ── Contactos ─────────────────────────────────────────────────────
  const { count: totalContactos } = await addClientFilter(
    db.from("contacts").select("id", { count: "exact", head: true })
  );
  const { count: contactosEnLemlist } = await addClientFilter(
    db.from("contacts").select("id", { count: "exact", head: true })
      .not("lemlist_pushed_at", "is", null)
  );
  const { count: contactosAprobados } = await addClientFilter(
    db.from("contacts").select("id", { count: "exact", head: true })
      .eq("fit_action", "enrich")
  );
  const { count: contactosDescartados } = await addClientFilter(
    db.from("contacts").select("id", { count: "exact", head: true })
      .eq("status", "discarded")
  );

  // ── Llamadas ──────────────────────────────────────────────────────
  const { count: totalLlamadas } = await addClientFilter(
    db.from("calls").select("id", { count: "exact", head: true })
  );
  const { count: llamadasConectadas } = await addClientFilter(
    db.from("calls").select("id", { count: "exact", head: true })
      .eq("outcome", "connected")
  );

  // ── Respuestas Lemlist ─────────────────────────────────────────────
  const { count: totalRespuestas } = await addClientFilter(
    db.from("lemlist_replies").select("id", { count: "exact", head: true })
  ).catch(() => ({ count: 0 }));

  // ── Contactos por cliente (solo para vista "Todos") ────────────────
  let porCliente: { name: string; empresas: number; contactos: number; en_lemlist: number }[] = [];
  if (isAll) {
    const { data: clientList } = await db
      .from("clients")
      .select("id, name")
      .eq("is_active", true)
      .order("name");

    if (clientList?.length) {
      const results = await Promise.all(
        clientList.map(async (cl) => {
          const [{ count: emp }, { count: con }, { count: lem }] = await Promise.all([
            db.from("companies").select("id", { count: "exact", head: true }).eq("client_id", cl.id),
            db.from("contacts").select("id", { count: "exact", head: true }).eq("client_id", cl.id),
            db.from("contacts").select("id", { count: "exact", head: true }).eq("client_id", cl.id).not("lemlist_pushed_at", "is", null),
          ]);
          return { name: cl.name, empresas: emp ?? 0, contactos: con ?? 0, en_lemlist: lem ?? 0 };
        })
      );
      porCliente = results;
    }
  }

  return NextResponse.json({
    empresas:            totalEmpresas      ?? 0,
    contactos:           totalContactos     ?? 0,
    contactosAprobados:  contactosAprobados ?? 0,
    contactosEnLemlist:  contactosEnLemlist ?? 0,
    contactosDescartados: contactosDescartados ?? 0,
    llamadas:            totalLlamadas      ?? 0,
    llamadasConectadas:  llamadasConectadas ?? 0,
    respuestas:          totalRespuestas    ?? 0,
    porCliente,
  });
}
