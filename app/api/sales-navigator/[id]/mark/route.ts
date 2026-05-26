import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body   = await req.json().catch(() => null);
  const status = body?.status ?? null;
  const db     = supabaseAdmin();

  const { data, error } = await db
    .from("companies")
    .update({ sales_nav_status: status, sales_nav_checked_at: new Date().toISOString() })
    .eq("id", params.id)
    .select("id, sales_nav_status")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ company: data });
}
