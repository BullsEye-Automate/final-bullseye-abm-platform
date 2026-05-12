import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany, RawContact } from "@/lib/contactsIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  company_id: string;
  contacts: RawContact[];
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.company_id || !Array.isArray(body.contacts)) {
    return NextResponse.json(
      { error: "Body must be { company_id, contacts: [...] }" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const result = await intakeContactsForCompany(db, body.company_id, body.contacts);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.summary);
}
