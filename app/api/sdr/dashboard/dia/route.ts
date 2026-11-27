import { NextRequest, NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { identifySdr } from "@/lib/academiaSdr/server/progress";
import { canEditMeetings } from "@/lib/celulasSdr/editors";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { loadSdrDashboard } from "@/lib/dashboardSdr/server";
import { myTasks } from "@/lib/dashboardSdr/miDia";
import { addToAlloQueue, completeTask } from "@/lib/dashboardSdr/ficha";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Dashboard SDR → «Mi día» (lib/dashboardSdr/miDia.ts).
//   GET  ?sdr=<clave>                                  → seguimientos del SDR en vivo (HubSpot)
//   POST { sdr, action: "complete", client, task }     → marcar un seguimiento como hecho
//   POST { sdr, action: "dial", items: [{ client, hs, contacts }] } → contactos a la cola de Allo de quien hace clic
// Escribe el propio SDR (correo de la sesión = Maestra) y las líderes / Ingri.

async function sliceFor(email: string, sdr: string, write: boolean) {
  if (write && !canEditMeetings(email)) {
    const me = await identifySdr(email).catch(() => ({ sdrName: null }));
    const key = me.sdrName ? resolveSdrKey(me.sdrName) : null;
    if (!key || key !== sdr) throw Object.assign(new Error("Solo puedes trabajar tu propio día."), { status: 403 });
  }
  const s = (await loadSdrDashboard({ sdr, email })).sdr;
  if (!s) throw Object.assign(new Error("No se encontró el SDR."), { status: 404 });
  return s;
}

export async function GET(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const sdr = req.nextUrl.searchParams.get("sdr") ?? "";
    if (!sdr) return NextResponse.json({ error: "Falta el SDR" }, { status: 400 });
    return NextResponse.json(await myTasks(await sliceFor(email, sdr, false)));
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: e.message || "Error interno" }, { status: e.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const b = await req.json().catch(() => null);
    const slice = await sliceFor(email, String(b?.sdr ?? ""), true);
    if (b?.action === "complete") {
      const a = slice.accts[String(b?.client ?? "")];
      if (!a) return NextResponse.json({ error: "Cliente fuera de la cartera" }, { status: 400 });
      await completeTask(a.id, a.sub, String(b?.task ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (b?.action === "dial") {
      const items = (Array.isArray(b?.items) ? b.items : []).slice(0, 40) as { client: string; hs: string; contacts: string[] }[];
      let added = 0;
      const skipped: { n: string; why: string }[] = [];
      let queue: string | null = null;
      for (const it of items) {
        const a = slice.accts[String(it.client)];
        const hs = String(it.hs ?? "");
        if (!a || !slice.companies.some((c) => c.c === it.client && c.hs === hs)) { skipped.push({ n: hs, why: "empresa fuera de la cartera" }); continue; }
        const ids = (Array.isArray(it.contacts) ? it.contacts : []).map(String).filter((x) => /^\d+$/.test(x));
        if (!ids.length) continue;
        const r = await addToAlloQueue(a.id, a.sub, hs, ids, email);
        added += r.added; skipped.push(...r.skipped); queue = r.queue ?? queue;
      }
      return NextResponse.json({ ok: true, added, skipped, queue });
    }
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (err) {
    const e = err as Error & { status?: number };
    console.error("Error en /api/sdr/dashboard/dia:", e);
    return NextResponse.json({ error: e.message || "Error interno" }, { status: e.status ?? 500 });
  }
}
