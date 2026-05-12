import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Borrado masivo por bucket. Útil para limpiar de un saque cuando el
// pre-filter dejó pasar muchos no-buyers (ej. cambios del prompt) o
// cuando Clay envió data de mala calidad.
//
// Body: { bucket: "pending" | "manual_review" | "enriched" | "discarded" }
//
// Aplica las mismas reglas de filtrado que GET /api/contacts. contact_feedback
// se preserva (FK on delete set null).

type Body = { bucket?: string };

const ALLOWED = new Set(["pending", "manual_review", "enriched", "discarded"]);

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const bucket = body?.bucket;
  if (!bucket || !ALLOWED.has(bucket)) {
    return NextResponse.json(
      { error: "bucket debe ser uno de pending / manual_review / enriched / discarded" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  // Resolvemos los ids del bucket aplicando el mismo filtro que el GET.
  let q = db.from("contacts").select("id");
  if (bucket === "pending") {
    q = q.eq("prefilter_result", "yes").is("fit_action", null).eq("status", "pending");
  } else if (bucket === "manual_review") {
    q = q.eq("fit_action", "manual_review").is("human_decision", null);
  } else if (bucket === "enriched") {
    q = q.or("status.in.(enriched,contacted,replied),fit_action.eq.enrich");
  } else if (bucket === "discarded") {
    q = q.or(
      "prefilter_result.eq.no,fit_action.eq.discard,status.eq.discarded,human_decision.eq.rejected"
    );
  }

  const { data: rows, error: selErr } = await q;
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  const ids = (rows ?? []).map((r) => r.id);
  if (ids.length === 0) {
    return NextResponse.json({ deleted: 0, bucket });
  }

  // Borrado en batches para no pegar límites de longitud de query.
  const BATCH = 500;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const { error: delErr } = await db.from("contacts").delete().in("id", slice);
    if (delErr) {
      return NextResponse.json(
        { error: delErr.message, deleted },
        { status: 500 }
      );
    }
    deleted += slice.length;
  }

  return NextResponse.json({ deleted, bucket });
}
