import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshCompanyPeople } from "@/lib/acti/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron: perfiles disponibles por empresa para ACTI (acti_company_people),
// desde la Base de contactos. Solo conteos y tipos de cargo, sin datos personales.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await refreshCompanyPeople(supabaseAdmin()));
  } catch (e) {
    console.error("[acti-perfiles]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
