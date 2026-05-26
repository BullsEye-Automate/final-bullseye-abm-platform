import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["contacted", "replied", "enriched", "pending", "discarded"] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: { status: ValidStatus };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!body?.status || !VALID_STATUSES.includes(body.status as ValidStatus)) {
    return NextResponse.json(
      { error: `status debe ser uno de: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("contacts")
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select("id, status")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contact: data });
}
