import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { currentUserEmail } from "@/lib/academiaSdr/server/client";
import { identifySdr } from "@/lib/academiaSdr/server/progress";
import { canEditMeetings } from "@/lib/celulasSdr/editors";
import { resolveSdrKey } from "@/lib/sdrAnalytics";
import { loadSdrDashboard } from "@/lib/dashboardSdr/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Dashboard SDR — marca "Para facturar" de una reunión, con trazabilidad
// (quién y cuándo). POST { id: <meetings.id>, value: boolean }.
// Puede marcar el SDR responsable de la reunión (su correo = el de la Maestra)
// y las líderes de célula e Ingri (MEETING_EDITOR_EMAILS).
// Requiere supabase/20261114_meetings_facturar.sql.
export async function POST(req: NextRequest) {
  try {
    const email = await currentUserEmail();
    if (!email) return NextResponse.json({ error: "Sin sesión" }, { status: 401 });
    const b = await req.json().catch(() => null);
    const id = String(b?.id ?? "");
    const value = b?.value === true;
    if (!id) return NextResponse.json({ error: "Falta el id de la reunión" }, { status: 400 });

    if (!canEditMeetings(email)) {
      const me = await identifySdr(email).catch(() => ({ sdrName: null }));
      const key = me.sdrName ? resolveSdrKey(me.sdrName) : null;
      const mine = key ? (await loadSdrDashboard({ sdr: key, email })).sdr : null;
      if (!mine?.meetings.some((m) => m.id === id)) {
        return NextResponse.json({ error: "Solo puedes marcar tus propias reuniones." }, { status: 403 });
      }
    }

    const { error } = await supabaseAdmin().from("meetings")
      .update({ facturar: value, facturar_by: email, facturar_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      const missing = /facturar/.test(error.message);
      return NextResponse.json({ error: missing ? "Falta ejecutar la migración supabase/20261114_meetings_facturar.sql en Supabase." : error.message }, { status: missing ? 400 : 500 });
    }
    return NextResponse.json({ ok: true, value });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Error interno" }, { status: 500 });
  }
}
