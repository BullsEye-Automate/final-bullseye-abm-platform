import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPrefilter } from "@/lib/prefilter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RawContact = {
  first_name?: string | null;
  last_name?: string | null;
  job_title?: string | null;
  linkedin_headline?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  phone?: string | null;
  seniority?: string | null;
  tenure?: string | null;
};

type Body = {
  company_id: string;
  contacts: RawContact[];
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.company_id || !Array.isArray(body.contacts)) {
    return NextResponse.json({ error: "Body must be { company_id, contacts: [...] }" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: company, error: cErr } = await db
    .from("companies")
    .select("id, company_type, company_name")
    .eq("id", body.company_id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const { data: existing, error: exErr } = await db
    .from("contacts")
    .select("linkedin_url")
    .eq("company_id", body.company_id);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  const existingLinkedins = new Set(
    (existing ?? [])
      .map((r) => (r.linkedin_url ?? "").toLowerCase().trim())
      .filter(Boolean)
  );

  const results: { yes: number; no: number; skipped: number } = { yes: 0, no: 0, skipped: 0 };
  const rows: any[] = [];

  for (const c of body.contacts) {
    const linkedin = (c.linkedin_url ?? "").toLowerCase().trim();
    if (linkedin && existingLinkedins.has(linkedin)) {
      results.skipped += 1;
      continue;
    }
    if (linkedin) existingLinkedins.add(linkedin);

    let prefilter: "yes" | "no" = "no";
    try {
      prefilter = await runPrefilter({
        job_title: c.job_title ?? null,
        linkedin_headline: c.linkedin_headline ?? null,
        company_type: company.company_type ?? null
      });
    } catch (err) {
      // Si Claude falla, marcamos yes para no descartar el contacto por error de infra.
      prefilter = "yes";
    }
    if (prefilter === "yes") results.yes += 1;
    else results.no += 1;

    rows.push({
      company_id: body.company_id,
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      job_title: c.job_title ?? null,
      linkedin_headline: c.linkedin_headline ?? null,
      linkedin_url: c.linkedin_url ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      seniority: c.seniority ?? null,
      tenure: c.tenure ?? null,
      prefilter_result: prefilter,
      status: prefilter === "yes" ? "pending" : "discarded"
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, ...results });
  }

  const { error: insertErr } = await db.from("contacts").insert(rows);
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ inserted: rows.length, ...results });
}
