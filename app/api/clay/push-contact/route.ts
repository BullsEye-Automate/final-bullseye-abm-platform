import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { pushContactToClay } from "@/lib/clayPushContact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  contact_id: string;
  force?: boolean;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.contact_id) {
    return NextResponse.json({ error: "Body must be { contact_id }" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const result = await pushContactToClay(db, body.contact_id, { force: body.force });

  if (!result.ok) {
    const payload: Record<string, unknown> = { error: result.error };
    if (result.skipped === "already_pushed") {
      const { data } = await db
        .from("contacts")
        .select("clay_pushed_at")
        .eq("id", body.contact_id)
        .maybeSingle();
      payload.clay_pushed_at = data?.clay_pushed_at;
    }
    return NextResponse.json(payload, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    contact: { id: result.contact_id, clay_pushed_at: result.clay_pushed_at }
  });
}
