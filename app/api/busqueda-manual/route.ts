import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Cola de empresas ya aprobadas donde Clay no pudo prospectar, en 3 buckets:
// sin contactos, con solo 1 contacto, y sin contactos fit (marcadas a mano).
export async function GET(req: NextRequest) {
  const clientId      = req.nextUrl.searchParams.get("client_id") || null;
  const includeRecent = req.nextUrl.searchParams.get("include_recent") === "1";
  const db = supabaseAdmin();

  let q = db
    .from("companies")
    .select("id, company_name, company_website, company_linkedin_url, company_city, company_country, company_size, company_type, cad_software, scanner_technology, fit_signals, research_summary, fit_score, clay_pushed_at, clay_no_contacts_at, sales_nav_status, created_at")
    .not("clay_pushed_at", "is", null);
  if (clientId) q = q.eq("client_id", clientId);
  const { data: allCompanies } = await q.order("clay_pushed_at", { ascending: false }).limit(500);

  let cq = db.from("contacts").select("company_id").neq("status", "discarded");
  if (clientId) cq = cq.eq("client_id", clientId);
  const { data: contactRows } = await cq;
  const contactCountMap = new Map<string, number>();
  for (const r of contactRows ?? []) {
    if (r.company_id) contactCountMap.set(r.company_id, (contactCountMap.get(r.company_id) ?? 0) + 1);
  }

  const GRACE_HOURS = includeRecent ? 0 : 24;
  const now = new Date();

  const no_contacts: unknown[] = [];
  const one_contact: unknown[] = [];
  const no_fit: unknown[] = [];

  for (const c of allCompanies ?? []) {
    const count = contactCountMap.get(c.id) ?? 0;

    if (c.sales_nav_status === "no_fit") {
      no_fit.push({ company: c, contact_count: count });
      continue;
    }

    const hasExplicitSignal = c.clay_no_contacts_at != null;
    const pushedHoursAgo = c.clay_pushed_at
      ? (now.getTime() - new Date(c.clay_pushed_at).getTime()) / 3600000
      : 0;
    const isInferred = !hasExplicitSignal && pushedHoursAgo > GRACE_HOURS && count === 0;

    if (count === 0 && (hasExplicitSignal || isInferred)) {
      no_contacts.push({
        company: c,
        contact_count: 0,
        signal: hasExplicitSignal ? "clay" : "inferred",
        recent: pushedHoursAgo < GRACE_HOURS
      });
    } else if (count === 1 && c.sales_nav_status == null) {
      one_contact.push({ company: c, contact_count: count });
    }
  }

  return NextResponse.json({ no_contacts, one_contact, no_fit });
}
