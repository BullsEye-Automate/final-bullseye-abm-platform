import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUserEmail, resolveClient } from "@/lib/academiaSdr/server/client";
import { loadMyProgress, loadTracking, recordLap, recordQuiz, recordVisit } from "@/lib/academiaSdr/server/progress";
import { LAP_COUNT } from "@/lib/academiaSdr/catalog";

export const dynamic = "force-dynamic";

// Seguimiento del Entrenamiento cliente (ver lib/academiaSdr/server/progress.ts).
//   GET  ?client_id=  → { me: vueltas completadas del usuario, tracking: una fila por usuario }
//   POST { client_id, type: "visit" | "lap_done" | "lap_undone" | "quiz", no?, score?, total? }
// El usuario sale siempre de la sesión, nunca de la request.

export async function GET(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const client = await resolveClient(db, request.nextUrl.searchParams.get("client_id"));
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const email = await currentUserEmail();
    const [me, tracking] = await Promise.all([email ? loadMyProgress(db, client.id, email) : Promise.resolve([]), loadTracking(db, client.id)]);
    return NextResponse.json({ me, tracking });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = supabaseAdmin();
    const body = await request.json().catch(() => null);
    const client = await resolveClient(db, body?.client_id);
    if (!client) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    const email = (await currentUserEmail())?.toLowerCase();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });

    const type = body?.type;
    if (type === "visit") {
      await recordVisit(db, client.id, email);
      return NextResponse.json({ ok: true });
    }
    const no = Math.trunc(Number(body?.no));
    if (!(no >= 1 && no <= LAP_COUNT)) return NextResponse.json({ error: "Vuelta inválida" }, { status: 400 });
    if (type === "lap_done" || type === "lap_undone") {
      const r = await recordLap({ db, clientId: client.id, clientName: client.name, email, moduleNo: no, done: type === "lap_done" });
      return NextResponse.json({ ok: true, ...r });
    }
    if (type === "quiz") {
      const total = Math.trunc(Number(body?.total));
      const score = Math.trunc(Number(body?.score));
      if (!(total > 0 && total <= 50 && score >= 0 && score <= total)) return NextResponse.json({ error: "Puntaje inválido" }, { status: 400 });
      await recordQuiz(db, client.id, email, no, score, total);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
