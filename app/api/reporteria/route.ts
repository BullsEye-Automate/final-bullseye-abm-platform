import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id");

  const db = supabaseAdmin();
  const isAll = !clientId || clientId === "__all__";

  function clientFilter(q: any): any {
    return isAll ? q : q.eq("client_id", clientId);
  }

  try {
    const [
      { count: totalEmpresas },
      { count: totalContactos },
      { count: contactosEnLemlist },
      { count: contactosAprobados },
      { count: contactosDescartados },
      { count: contactosConReply },
      { count: totalLlamadas },
      { count: llamadasReales },
    ] = await Promise.all([
      clientFilter(db.from("companies").select("id", { count: "exact", head: true })),
      clientFilter(db.from("contacts").select("id", { count: "exact", head: true })),
      clientFilter(db.from("contacts").select("id", { count: "exact", head: true }).not("lemlist_pushed_at", "is", null)),
      clientFilter(db.from("contacts").select("id", { count: "exact", head: true }).eq("fit_action", "enrich")),
      clientFilter(db.from("contacts").select("id", { count: "exact", head: true }).eq("status", "discarded")),
      // Replies: contactos que completaron con reply en Lemlist
      clientFilter(db.from("contacts").select("id", { count: "exact", head: true }).not("lemlist_pushed_at", "is", null).eq("status", "replied")),
      clientFilter(db.from("calls").select("id", { count: "exact", head: true })),
      // Llamadas reales: conversaciones confirmadas por IA
      clientFilter(db.from("calls").select("id", { count: "exact", head: true }).eq("ai_is_real_conversation", true)),
    ]);

    // Desglose por cliente (solo en modo "Todos")
    let porCliente: { name: string; empresas: number; contactos: number; en_lemlist: number; llamadas: number }[] = [];
    if (isAll) {
      const { data: clientList } = await db
        .from("clients")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      if (clientList?.length) {
        porCliente = await Promise.all(
          clientList.map(async (cl) => {
            const [{ count: emp }, { count: con }, { count: lem }, { count: calls }] = await Promise.all([
              db.from("companies").select("id", { count: "exact", head: true }).eq("client_id", cl.id),
              db.from("contacts").select("id", { count: "exact", head: true }).eq("client_id", cl.id),
              db.from("contacts").select("id", { count: "exact", head: true }).eq("client_id", cl.id).not("lemlist_pushed_at", "is", null),
              db.from("calls").select("id", { count: "exact", head: true }).eq("client_id", cl.id),
            ]);
            return { name: cl.name, empresas: emp ?? 0, contactos: con ?? 0, en_lemlist: lem ?? 0, llamadas: calls ?? 0 };
          })
        );
      }
    }

    return NextResponse.json({
      empresas:             totalEmpresas      ?? 0,
      contactos:            totalContactos     ?? 0,
      contactosAprobados:   contactosAprobados ?? 0,
      contactosEnLemlist:   contactosEnLemlist ?? 0,
      contactosDescartados: contactosDescartados ?? 0,
      respuestas:           contactosConReply  ?? 0,
      llamadas:             totalLlamadas      ?? 0,
      llamadasConectadas:   llamadasReales     ?? 0,
      porCliente,
    });
  } catch (err: any) {
    console.error("[reporteria]", err?.message);
    return NextResponse.json({ error: err?.message ?? "Error interno" }, { status: 500 });
  }
}
