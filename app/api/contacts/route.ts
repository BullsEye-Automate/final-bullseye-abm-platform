import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTACT_COLUMNS =
  "id, company_id, first_name, last_name, job_title, linkedin_headline, linkedin_url, email, phone, seniority, tenure, prefilter_result, prefilter_reason, fit_score, fit, fit_reason, fit_action, linkedin_icebreaker, email_subject, email_body, status, human_decision, clay_row_id, clay_pushed_at, clay_push_error, lemlist_lead_id, lemlist_pushed_at, hubspot_contact_id, created_at, updated_at";

export async function GET(req: NextRequest) {
  const bucket    = req.nextUrl.searchParams.get("bucket")     ?? "pending";
  const companyId = req.nextUrl.searchParams.get("company_id");
  const clientId  = req.nextUrl.searchParams.get("client_id")  || null;
  const search    = req.nextUrl.searchParams.get("search")?.trim();
  const limit     = parseInt(req.nextUrl.searchParams.get("limit") ?? "500", 10);
  const db = supabaseAdmin();

  // Modo búsqueda para el Laboratorio: busca en nombre, apellido y cargo, con join a companies
  if (search) {
    const term = `%${search}%`;
    const { data, error } = await db
      .from("contacts")
      .select("id, first_name, last_name, job_title, email, company_id, companies(company_name)")
      .eq("client_id", clientId ?? "")
      .or(`first_name.ilike.${term},last_name.ilike.${term},job_title.ilike.${term}`)
      .limit(limit);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const contacts = (data ?? []).map((c: any) => ({
      id:           c.id,
      first_name:   c.first_name,
      last_name:    c.last_name,
      job_title:    c.job_title,
      email:        c.email,
      company_name: Array.isArray(c.companies) ? (c.companies[0]?.company_name ?? null) : (c.companies?.company_name ?? null),
    }));
    return NextResponse.json({ contacts });
  }

  function applyFilters(q: any) {
    if (companyId) q = q.eq("company_id", companyId);
    if (clientId)  q = q.eq("client_id",  clientId);
    return q;
  }

  let q = applyFilters(db.from("contacts").select(CONTACT_COLUMNS));

  // Buckets:
  //   pending          → prefilter='yes', fit_action IS NULL, status='pending'
  //   manual_review    → fit_action='manual_review', status='pending' (Clay evaluó score 4-6, necesita decisión humana)
  //   approved_pending → fit_action='enrich', lemlist_pushed_at IS NULL, status != 'discarded'
  //   enriched         → lemlist_pushed_at IS NOT NULL
  //   discarded        → prefilter='no' OR fit_action='discard' OR status='discarded' OR human_decision='rejected'
  if (bucket === "pending") {
    q = q.eq("prefilter_result", "yes").is("fit_action", null).eq("status", "pending");
  } else if (bucket === "manual_review") {
    q = q.eq("fit_action", "manual_review").eq("status", "pending");
  } else if (bucket === "approved_pending") {
    q = q.eq("fit_action", "enrich").is("lemlist_pushed_at", null).neq("status", "discarded");
  } else if (bucket === "enriched") {
    q = q.not("lemlist_pushed_at", "is", null);
  } else if (bucket === "discarded") {
    q = q.or("prefilter_result.eq.no,fit_action.eq.discard,status.eq.discarded,human_decision.eq.rejected");
  }

  const { data, error } = await q
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  function countFor(bucketQ: (q: any) => any) {
    return bucketQ(applyFilters(db.from("contacts").select("id", { count: "exact", head: true })));
  }

  const [pendingRes, manualReviewRes, approvedPendingRes, enrichedRes, discardedRes] = await Promise.all([
    countFor((q) => q.eq("prefilter_result", "yes").is("fit_action", null).eq("status", "pending")),
    countFor((q) => q.eq("fit_action", "manual_review").eq("status", "pending")),
    countFor((q) => q.eq("fit_action", "enrich").is("lemlist_pushed_at", null).neq("status", "discarded")),
    countFor((q) => q.not("lemlist_pushed_at", "is", null)),
    countFor((q) => q.or("prefilter_result.eq.no,fit_action.eq.discard,status.eq.discarded,human_decision.eq.rejected"))
  ]);

  return NextResponse.json(
    {
      contacts: data ?? [],
      counts: {
        pending:          pendingRes.count          ?? 0,
        manual_review:    manualReviewRes.count     ?? 0,
        approved_pending: approvedPendingRes.count  ?? 0,
        enriched:         enrichedRes.count         ?? 0,
        discarded:        discardedRes.count        ?? 0
      }
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
