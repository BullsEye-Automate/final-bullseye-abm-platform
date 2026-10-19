import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requirePortalUser } from "@/lib/portalAuth";
import { normalizeDomain } from "@/lib/hubspotPool";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 5000;

// GET — lista de exclusión del cliente
export async function GET() {
  const { user, response } = await requirePortalUser();
  if (!user) return response;
  const { data, error } = await supabaseAdmin()
    .from("client_exclusions")
    .select("id, kind, company_name, domain, keyword, reason, created_by_email, created_at")
    .eq("client_id", user.clientId)
    .order("created_at", { ascending: false })
    .limit(10_000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

// POST — { companies?: [{ name?, domain? }], keywords?: string[], reason? }
// Agrega empresas (a mano o desde Excel) y/o palabras clave. Las empresas se
// copian también a excluded_companies para que la prospección interna de
// BullsEye las omita. Duplicados se ignoran.
export async function POST(req: NextRequest) {
  const { user, response } = await requirePortalUser();
  if (!user) return response;

  const body = await req.json().catch(() => null);
  const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 200) : null;
  const rawCompanies = (Array.isArray(body?.companies) ? body.companies : []).slice(0, MAX_ITEMS) as Record<string, unknown>[];
  const rawKeywords = (Array.isArray(body?.keywords) ? body.keywords : []).slice(0, 200) as unknown[];

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("client_exclusions")
    .select("kind, company_name, domain, keyword")
    .eq("client_id", user.clientId)
    .limit(20_000);
  const seenDomains = new Set((existing ?? []).filter((e) => e.domain).map((e) => e.domain as string));
  const seenNames = new Set((existing ?? []).filter((e) => e.company_name).map((e) => (e.company_name as string).toLowerCase()));
  const seenKeywords = new Set((existing ?? []).filter((e) => e.keyword).map((e) => (e.keyword as string).toLowerCase()));

  const base = { client_id: user.clientId, reason, created_by: user.portalUserId, created_by_email: user.email };
  const rows: Record<string, unknown>[] = [];
  for (const c of rawCompanies) {
    const name = typeof c?.name === "string" && c.name.trim() ? c.name.trim().slice(0, 200) : null;
    const domain = normalizeDomain(typeof c?.domain === "string" ? c.domain : null);
    if (!name && !domain) continue;
    if (domain ? seenDomains.has(domain) : seenNames.has(name!.toLowerCase())) continue;
    if (domain) seenDomains.add(domain);
    if (name) seenNames.add(name.toLowerCase());
    rows.push({ ...base, kind: "company", company_name: name, domain });
  }
  for (const k of rawKeywords) {
    const kw = String(k ?? "").trim().slice(0, 80);
    if (kw.length < 2 || seenKeywords.has(kw.toLowerCase())) continue;
    seenKeywords.add(kw.toLowerCase());
    rows.push({ ...base, kind: "keyword", keyword: kw });
  }
  if (!rows.length) return NextResponse.json({ ok: true, added: 0 });

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("client_exclusions").insert(rows.slice(i, i + 500));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Copia a la lista interna de BullsEye (la usa la prospección/discovery)
  const { data: internal } = await db.from("excluded_companies").select("company_name").eq("client_id", user.clientId).limit(50_000);
  const internalNames = new Set((internal ?? []).map((r) => (r.company_name as string).toLowerCase()));
  const toInternal = rows
    .filter((r) => r.kind === "company")
    .map((r) => ({ client_id: user.clientId, company_name: (r.company_name ?? r.domain) as string, company_website: (r.domain as string | null) ?? null }))
    .filter((r) => {
      const k = r.company_name.toLowerCase();
      if (internalNames.has(k)) return false;
      internalNames.add(k);
      return true;
    });
  for (let i = 0; i < toInternal.length; i += 500) {
    await db.from("excluded_companies").insert(toInternal.slice(i, i + 500));
  }

  return NextResponse.json({ ok: true, added: rows.length });
}
