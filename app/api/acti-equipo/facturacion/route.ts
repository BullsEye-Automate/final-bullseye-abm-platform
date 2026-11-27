import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireInternalUser } from "@/lib/acti/server";
import { canEditPlans } from "@/lib/acti/permissions";
import { closeMonth, monthOverview } from "@/lib/acti/billingServer";
import { ActiFeedbackError, resolveDispute } from "@/lib/acti/meetings";
import { chileToday } from "@/lib/acti/home";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Facturación ACTI (equipo): resumen del mes por socio, revenue share de ACTI
// y reuniones en revisión. GET ?month=YYYY-MM
export async function GET(req: NextRequest) {
  const auth = await requireInternalUser();
  if (auth.response) return auth.response;
  const month = req.nextUrl.searchParams.get("month") ?? chileToday().slice(0, 7);
  if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Mes inválido" }, { status: 400 });
  const db = supabaseAdmin();
  const [overview, { data: disputes }] = await Promise.all([
    monthOverview(db, month),
    db.from("acti_meeting_feedback").select("meeting_id, client_id, comentario, disputa_at, meetings(empresa, fecha_reunion), clients(name)").eq("disputa", "en_revision").limit(200),
  ]);
  return NextResponse.json({ ...overview, disputes: disputes ?? [], canClose: canEditPlans(auth.email) });
}

// POST { action: "cerrar", month, uf? } (solo PLAN_EDITORS) ·
// POST { action: "disputa", meetingId, decision: "cobrar" | "no_cobrar" }
export async function POST(req: NextRequest) {
  const auth = await requireInternalUser();
  if (auth.response) return auth.response;
  const body = await req.json().catch(() => null);
  const db = supabaseAdmin();
  try {
    if (body?.action === "cerrar") {
      if (!canEditPlans(auth.email)) return NextResponse.json({ error: "No tienes permiso para cerrar la facturación" }, { status: 403 });
      if (!MONTH_RE.test(body.month ?? "")) return NextResponse.json({ error: "Mes inválido" }, { status: 400 });
      if (body.month >= chileToday().slice(0, 7)) return NextResponse.json({ error: "Solo se cierran meses terminados" }, { status: 400 });
      const uf = typeof body.uf === "number" && body.uf > 10000 && body.uf < 100000 ? body.uf : null;
      return NextResponse.json(await closeMonth(db, body.month, auth.email, { ufOverride: uf }));
    }
    if (body?.action === "disputa") {
      if (body.decision !== "cobrar" && body.decision !== "no_cobrar") return NextResponse.json({ error: "Decisión inválida" }, { status: 400 });
      await resolveDispute(db, String(body.meetingId ?? ""), body.decision, auth.email);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (e) {
    if (e instanceof ActiFeedbackError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("acti-equipo facturacion:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
