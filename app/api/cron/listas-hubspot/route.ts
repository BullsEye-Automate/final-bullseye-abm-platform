import { NextRequest, NextResponse } from "next/server";
import { runProspectingLists } from "@/lib/listasHubspot";
import { chileDay } from "@/lib/feriados/report";
import { isBusinessDay } from "@/lib/celulasSdr/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron: listas estáticas de HubSpot con los contactos prospectados del
// día + correo a Adolfo e Ingri (lib/listasHubspot.ts). Días hábiles de Chile
// a las 18:00; vercel.json dispara a las 21:05 y 22:05 UTC (verano / invierno)
// y acá se corre solo cuando en Chile son las 18:xx. Los contactos ya puestos
// en una lista no se repiten, así que una segunda corrida no duplica nada.
// ?force=1 (con CRON_SECRET) se salta el chequeo de hora y día.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const day = chileDay();
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (req.nextUrl.searchParams.get("force") !== "1") {
    if (!isBusinessDay(day)) return NextResponse.json({ skipped: `No es día hábil (${day})` });
    if (hour !== 18) return NextResponse.json({ skipped: `Hora de Chile ${hour}:xx (se corre a las 18:00)` });
  }
  try {
    return NextResponse.json(await runProspectingLists({ day }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
