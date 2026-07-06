import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const reason: string | undefined = body?.reason;
  const db = supabaseAdmin();

  const { error } = await db
    .from("contacts")
    .update({ status: "discarded", human_decision: "rejected" })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db
    .from("contact_feedback")
    .insert({ contact_id: params.id, human_action: "rejected", human_reason: reason ?? null, reviewer: "user" })
    .catch(() => {});

  return NextResponse.json({ ok: true });
}
