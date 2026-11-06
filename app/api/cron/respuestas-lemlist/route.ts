import { NextRequest, NextResponse } from "next/server";
import { currentMode, listReplyClients, processClientReplies, sendQueuedMails, type ClientRunResult, type ProcessedRow } from "@/lib/respuestasLemlist/process";
import { inBusinessHours } from "@/lib/respuestasLemlist/hours";
import { sendShadowDigest } from "@/lib/respuestasLemlist/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron cada 15 minutos (vercel.json): respuestas de Lemlist de todos
// los clientes activos en la Maestra → clasificación → SDR asignado o alerta
// al KAM. Ver lib/respuestasLemlist/process.ts. ?client_id= procesa uno solo.
const BUDGET_MS = 270_000;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const deadline = Date.now() + BUDGET_MS;
  const mode = currentMode();
  try {
    // Dentro del horario laboral primero salen los avisos que quedaron en cola
    const queued = mode === "activo" && inBusinessHours() ? await sendQueuedMails(Date.now() + 60_000) : null;
    const { clients, skipped } = await listReplyClients();
    const only = req.nextUrl.searchParams.get("client_id");
    const list = only ? clients.filter((c) => c.id === only) : clients;
    const results: (ClientRunResult | { client: string; error: string })[] = [];
    for (const c of list) {
      if (Date.now() > deadline) { results.push({ client: c.name, error: "Sin tiempo en esta corrida" }); continue; }
      try {
        results.push(await processClientReplies(c, deadline));
      } catch (e) {
        results.push({ client: c.name, error: (e as Error).message });
      }
    }
    // Modo sombra: resumen de lo que se habría hecho (solo si hubo respuestas nuevas)
    const rows: ProcessedRow[] = results.flatMap((r) => ("processed" in r ? r.processed : []));
    let digest: string | null = null;
    if (mode === "sombra" && rows.length) {
      const to = (process.env.RESPUESTAS_LEMLIST_SHADOW_TO ?? "amadriz@bullseye-abm.com").split(",").map((x) => x.trim()).filter(Boolean);
      try { await sendShadowDigest(to, rows); digest = `enviado a ${to.join(", ")}`; } catch (e) { digest = `error: ${(e as Error).message}`; }
    }
    return NextResponse.json({ ok: true, mode, businessHours: inBusinessHours(), queued, clients: list.length, skipped, processed: rows.length, digest, results });
  } catch (e) {
    return NextResponse.json({ ok: false, mode, error: (e as Error).message }, { status: 500 });
  }
}
