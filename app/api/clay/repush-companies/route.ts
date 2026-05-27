import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushCompanyToClay } from "@/lib/clayPush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Re-pushea a Clay todas las empresas ya pusheadas (force=true) para actualizar campos nuevos.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const clientId: string | undefined = body.client_id;

  const db = supabaseAdmin();

  let q = db
    .from("companies")
    .select("id")
    .eq("status", "approved")
    .not("clay_pushed_at", "is", null);

  if (clientId) q = q.eq("client_id", clientId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data ?? []).map((c) => c.id);
  let repushed = 0;
  const errors: { company_id: string; error: string }[] = [];

  for (const id of ids) {
    const r = await pushCompanyToClay(db, id, { force: true });
    if (r.ok) {
      repushed++;
    } else {
      errors.push({ company_id: r.company_id, error: r.error });
    }
  }

  return NextResponse.json({ total: ids.length, repushed, errors });
}
