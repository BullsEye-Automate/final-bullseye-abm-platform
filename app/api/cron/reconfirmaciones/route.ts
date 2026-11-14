import { NextRequest, NextResponse } from "next/server";
import { runReconfirmation, SLOTS, type SlotId } from "@/lib/reconfirmacion/server/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Vercel Cron cada 15 min (lunes a viernes, horas UTC que cubren 8:00–19:45 de
// Chile en verano e invierno): lee la planilla, copia la reconfirmación de las
// reuniones del piloto a `meetings` (Células SDR y Pulso ABM la ven al tiro) y,
// si en Chile toca uno de los 5 envíos del día (08:30, 10:00, 12:00, 16:00,
// 18:00), lo manda una vez. Ver lib/reconfirmacion/server/alerts.ts.
// ?slot=0830|1000|1200|1600|1800&force=1 (con CRON_SECRET) fuerza ese envío.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers.get("authorization") ?? "") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const slot = sp.get("slot") as SlotId | null;
  if (slot && !SLOTS.some((s) => s.id === slot)) return NextResponse.json({ error: "slot inválido" }, { status: 400 });
  try {
    return NextResponse.json(await runReconfirmation({ slotId: slot ?? undefined, force: sp.get("force") === "1" }));
  } catch (err) {
    console.error("Error en /api/cron/reconfirmaciones:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
