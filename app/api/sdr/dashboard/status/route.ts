import { NextRequest, NextResponse } from "next/server";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { identifySdr } from "@/lib/academiaSdr/server/progress";
import { canEditMeetings } from "@/lib/celulasSdr/editors";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { loadSdrDashboard } from "@/lib/dashboardSdr/server";
import { statusOptions, StatusConflict, updateStatus, type StatusType } from "@/lib/dashboardSdr/statusEdit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Dashboard SDR — cambiar el status de una empresa o contacto en HubSpot
// (lib/dashboardSdr/statusEdit.ts).
//   GET  ?client_id=&sub=  → opciones de la propiedad de status de empresa y contacto
//   POST { client_id, sub, type: "company" | "contact", hs, value, prev }
// Puede cambiarlo el SDR dueño del registro (su correo de la sesión = el de la
// Maestra) y las líderes de célula e Ingri (MEETING_EDITOR_EMAILS).

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const clientId = p.get("client_id");
    if (!clientId) return NextResponse.json({ error: "Falta client_id" }, { status: 400 });
    return NextResponse.json(await statusOptions(clientId, p.get("sub") || null));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const b = await req.json().catch(() => null);
    const clientId = String(b?.client_id ?? "");
    const sub = b?.sub ? String(b.sub) : null;
    const type = b?.type === "contact" ? "contact" : b?.type === "company" ? "company" : null;
    const hs = String(b?.hs ?? "");
    const value = String(b?.value ?? "");
    if (!clientId || !type || !hs || !value) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

    // Permiso: líder / Ingri, o el SDR dueño del registro
    if (!canEditMeetings(email)) {
      const me = await identifySdr(email).catch(() => ({ sdrName: null }));
      const key = me.sdrName ? resolveSdrKey(me.sdrName) : null;
      if (!key) return NextResponse.json({ error: "Tu usuario no calza con un SDR de la Maestra: no puedes cambiar status." }, { status: 403 });
      const mine = (await loadSdrDashboard({ sdr: key, email })).sdr;
      const client = mine ? Object.entries(mine.accts ?? {}).find(([, a]) => a.id === clientId && (a.sub ?? null) === sub)?.[0] : undefined;
      const owns = !!mine && !!client && (type === "company"
        ? mine.companies.some((c) => c.c === client && c.hs === hs)
        : mine.contacts.some((k) => k.c === client && k.hs === hs));
      if (!owns) return NextResponse.json({ error: "Solo puedes cambiar el status de tus propias empresas y contactos." }, { status: 403 });
    }

    const r = await updateStatus({ clientId, sub, type: type as StatusType, hsId: hs, value, prev: b?.prev ?? null, by: email });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof StatusConflict) return NextResponse.json({ error: err.message, conflict: true }, { status: 409 });
    console.error("Error en /api/sdr/dashboard/status:", err);
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
