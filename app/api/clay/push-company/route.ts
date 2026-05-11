import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  company_id: string;
  force?: boolean;
};

// Mapea el company_type interno a los values que espera el select de Clay.
// Clay: lab / clinic / DSO. Nuestro DB: lab / multi_clinic / dso / other.
function mapCompanyTypeForClay(t: string | null): string | null {
  if (!t) return null;
  if (t === "lab") return "lab";
  if (t === "multi_clinic") return "clinic";
  if (t === "dso") return "DSO";
  return null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.company_id) {
    return NextResponse.json({ error: "Body must be { company_id }" }, { status: 400 });
  }

  const webhookUrl = process.env.CLAY_COMPANIES_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "CLAY_COMPANIES_WEBHOOK_URL is not configured" },
      { status: 500 }
    );
  }

  const db = supabaseAdmin();
  const { data: company, error: fetchErr } = await db
    .from("companies")
    .select(
      "id, company_name, company_website, company_linkedin_url, company_city, company_size, company_type, cad_software, scanner_technology, fit_signals, fit_score, status, clay_pushed_at, approved_by, approved_at"
    )
    .eq("id", body.company_id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  if (company.status !== "approved") {
    return NextResponse.json(
      { error: "Only approved companies can be pushed to Clay" },
      { status: 400 }
    );
  }

  if (company.clay_pushed_at && !body.force) {
    return NextResponse.json(
      { error: "Company already pushed to Clay", clay_pushed_at: company.clay_pushed_at },
      { status: 409 }
    );
  }

  const payload = {
    company_name: company.company_name,
    company_website: company.company_website ?? "",
    company_city: company.company_city ?? "",
    company_size: company.company_size ?? null,
    company_type: mapCompanyTypeForClay(company.company_type),
    cad_software: company.cad_software ?? "",
    scanner_technology: company.scanner_technology ?? "",
    fit_signals: company.fit_signals ?? "",
    fit_score: company.fit_score ?? null,
    linkedin_url: company.company_linkedin_url ?? "",
    approved_by: company.approved_by ?? "",
    approved_at: company.approved_at ?? "",
    status: "approved",
    wecad_company_id: company.id
  };

  let clayRes: Response;
  try {
    clayRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
  } catch (err: any) {
    const message = err?.message ?? "Network error pushing to Clay";
    await db
      .from("companies")
      .update({ clay_push_error: message })
      .eq("id", company.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!clayRes.ok) {
    const text = await clayRes.text().catch(() => "");
    const message = `Clay responded ${clayRes.status}: ${text.slice(0, 300) || "no body"}`;
    await db
      .from("companies")
      .update({ clay_push_error: message })
      .eq("id", company.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const pushedAt = new Date().toISOString();
  const { data: updated, error: updateErr } = await db
    .from("companies")
    .update({ clay_pushed_at: pushedAt, clay_push_error: null })
    .eq("id", company.id)
    .select("id, clay_pushed_at, clay_push_error")
    .single();
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, company: updated });
}
