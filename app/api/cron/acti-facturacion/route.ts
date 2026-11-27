import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { closeMonth } from "@/lib/acti/billingServer";
import { prevMonth } from "@/lib/acti/billing";
import { chileToday } from "@/lib/acti/home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron (días 1 a 5 de cada mes): cierra la facturación ACTI del mes
// anterior si aún no está cerrada, con la UF del último día del mes. El equipo
// puede volver a cerrarla con otra UF desde ACTI → Red de Negocios → Facturación.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const month = req.nextUrl.searchParams.get("month") ?? prevMonth(chileToday().slice(0, 7));
  const force = req.nextUrl.searchParams.get("force") === "1";
  const { count } = await db.from("acti_billing_months").select("id", { count: "exact", head: true }).eq("month", month);
  if ((count ?? 0) > 0 && !force) return NextResponse.json({ skipped: true, month, reason: "ya cerrado" });
  try {
    return NextResponse.json(await closeMonth(db, month, "cron"));
  } catch (e) {
    console.error("[acti-facturacion]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
