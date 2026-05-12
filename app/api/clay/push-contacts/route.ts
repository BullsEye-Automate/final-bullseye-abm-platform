import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushContactToClay } from "@/lib/clayPushContact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Empuja a Clay todos los contactos pre-filter YES que aún no fueron empujados
// y siguen en bucket Pendientes (status pending, sin scoring de Clay todavía).
// Procesa secuencialmente para no saturar el webhook.
export async function POST() {
  const db = supabaseAdmin();
  const { data: pending, error } = await db
    .from("contacts")
    .select("id")
    .eq("prefilter_result", "yes")
    .eq("status", "pending")
    .is("clay_pushed_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (pending ?? []).map((c) => c.id);
  let pushed = 0;
  const errors: { contact_id: string; error: string }[] = [];

  for (const id of ids) {
    const r = await pushContactToClay(db, id);
    if (r.ok) {
      pushed += 1;
    } else if (r.skipped !== "already_pushed") {
      errors.push({ contact_id: r.contact_id, error: r.error });
    }
  }

  return NextResponse.json({ total: ids.length, pushed, errors });
}
