import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCompanyToClay } from "@/lib/clayPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Empuja a Clay todas las empresas approved que aún no fueron empujadas.
// Procesa secuencialmente para no saturar el webhook de Clay.
export async function POST() {
  const db = supabaseAdmin();
  const { data: pending, error } = await db
    .from("companies")
    .select("id")
    .eq("status", "approved")
    .is("clay_pushed_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (pending ?? []).map((c) => c.id);
  let pushed = 0;
  const errors: { company_id: string; error: string }[] = [];

  for (const id of ids) {
    const r = await pushCompanyToClay(db, id);
    if (r.ok) {
      pushed += 1;
    } else if (r.skipped !== "already_pushed") {
      errors.push({ company_id: r.company_id, error: r.error });
    }
  }

  return NextResponse.json({ total: ids.length, pushed, errors });
}
