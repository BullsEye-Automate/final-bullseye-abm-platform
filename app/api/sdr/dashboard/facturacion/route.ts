import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { canMarkBilling, loadBillingMarks } from "@/lib/dashboardSdr/billing";

export const dynamic = "force-dynamic";

// Dashboard SDR → vista Facturación: reuniones del mes (por fecha de la
// reunión) de todos los clientes, con la marca "Para facturar" y su
// trazabilidad (quién la marcó y cuándo). Lee la tabla meetings en vivo.
// Nunca teléfono ni correo del prospecto. GET ?month=YYYY-MM
export async function GET(req: NextRequest) {
  try {
    if (!canMarkBilling(await currentUserEmail())) return NextResponse.json({ error: "Vista solo para facturación interna." }, { status: 403 });
    const month = req.nextUrl.searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month inválido (YYYY-MM)" }, { status: 400 });
    const [y, m] = month.split("-").map(Number);
    const from = `${month}-01`;
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const db = supabaseAdmin();
    const { data: clients } = await db.from("clients").select("id, name");
    const nameOf = new Map((clients ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
    const base = "id, client_id, cliente_nombre, fecha_reunion, hora, empresa, contacto_nombre, contacto_cargo, responsable, sdr_nombre, realizado, propuesta_oportunidad, origen";
    const [res, marks] = await Promise.all([
      db.from("meetings").select(base).gte("fecha_reunion", from).lte("fecha_reunion", to).order("fecha_reunion").limit(5000),
      loadBillingMarks(),
    ]);
    if (res.error) throw new Error(res.error.message);
    const rows = ((res.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      cliente: String(r.cliente_nombre || nameOf.get(String(r.client_id)) || "Sin cliente"),
      fecha: r.fecha_reunion as string, hora: ((r.hora as string) || "").slice(0, 5),
      empresa: (r.empresa as string) || "", contacto: (r.contacto_nombre as string) || "", cargo: (r.contacto_cargo as string) || "",
      sdr: String(r.responsable || r.sdr_nombre || ""), realizado: (r.realizado as string) || "", oportunidad: (r.propuesta_oportunidad as string) || "", origen: (r.origen as string) || "",
      facturar: !!marks.get(String(r.id))?.value, by: marks.get(String(r.id))?.by ?? null, at: marks.get(String(r.id))?.at ?? null,
    }));
    return NextResponse.json({ month, ready: true, rows });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
