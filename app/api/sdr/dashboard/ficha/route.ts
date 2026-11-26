import { NextRequest, NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { identifySdr } from "@/lib/academiaSdr/server/progress";
import { canEditMeetings } from "@/lib/celulasSdr/editors";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { loadSdrDashboard } from "@/lib/dashboardSdr/server";
import { completeTask, createActivity, loadFicha } from "@/lib/dashboardSdr/ficha";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Dashboard SDR → ficha de empresa (lib/dashboardSdr/ficha.ts).
//   GET  ?client_id=&sub=&hs=   → historial, contactos y seguimientos pendientes (todos ven todo)
//   POST { client_id, sub, hs, action: "create", kind, body, subject?, due?, taskType?, contact? }
//   POST { client_id, sub, hs, action: "complete", task }
// Escribe el SDR dueño de la empresa (correo de la sesión = Maestra) y las
// líderes de célula e Ingri (MEETING_EDITOR_EMAILS), igual que «Cambiar status».

export async function GET(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const p = req.nextUrl.searchParams;
    const clientId = p.get("client_id"), hs = p.get("hs");
    if (!clientId || !hs) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
    return NextResponse.json(await loadFicha(clientId, p.get("sub") || null, hs));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const b = await req.json().catch(() => null);
    const clientId = String(b?.client_id ?? ""), sub = b?.sub ? String(b.sub) : null, hs = String(b?.hs ?? "");
    if (!clientId || !hs) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

    if (!canEditMeetings(email)) {
      const me = await identifySdr(email).catch(() => ({ sdrName: null }));
      const key = me.sdrName ? resolveSdrKey(me.sdrName) : null;
      if (!key) return NextResponse.json({ error: "Tu usuario no calza con un SDR de la Maestra: no puedes registrar actividades." }, { status: 403 });
      const mine = (await loadSdrDashboard({ sdr: key, email })).sdr;
      const client = mine ? Object.entries(mine.accts ?? {}).find(([, a]) => a.id === clientId && (a.sub ?? null) === sub)?.[0] : undefined;
      if (!mine || !client || !mine.companies.some((c) => c.c === client && c.hs === hs)) {
        return NextResponse.json({ error: "Solo puedes registrar actividades en tus propias empresas." }, { status: 403 });
      }
    }

    if (b?.action === "complete") {
      await completeTask(clientId, sub, String(b?.task ?? ""));
      return NextResponse.json({ ok: true });
    }
    const kind = ["note", "whatsapp", "linkedin", "email", "task"].includes(b?.kind) ? b.kind : null;
    if (!kind) return NextResponse.json({ error: "Tipo de actividad inválido" }, { status: 400 });
    const r = await createActivity({
      clientId, sub, hsCompanyId: hs, contactHs: b?.contact ? String(b.contact) : null, kind,
      body: String(b?.body ?? "").slice(0, 10_000), subject: b?.subject ? String(b.subject) : undefined,
      due: b?.due ? String(b.due) : null, taskType: b?.taskType === "TODO" ? "TODO" : "CALL", byEmail: email,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("Error en /api/sdr/dashboard/ficha:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
