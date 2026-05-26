import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-webhook-secret");
  if (process.env.CLAY_WEBHOOK_SECRET && secret !== process.env.CLAY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const companyId = body?.bullseye_company_id ?? body?.wecad_company_id;
  if (!companyId) {
    return NextResponse.json({ error: "bullseye_company_id requerido" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("companies")
    .update({ clay_no_contacts_at: new Date().toISOString() })
    .eq("id", companyId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, company_id: companyId });
}
