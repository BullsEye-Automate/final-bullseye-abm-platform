import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireActiUser } from "@/lib/acti/server";
import { attachFit, peopleFor, rowToCard } from "@/lib/acti/search";
import { decodeRef } from "@/lib/unifiedSearch";

export const dynamic = "force-dynamic";

// Empresas guardadas por el socio (acti_saved_companies)
export async function GET() {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const db = supabaseAdmin();
  const { data: saved } = await db.from("acti_saved_companies").select("hs_id").eq("client_id", s.user.clientId).order("created_at", { ascending: false }).limit(300);
  const ids = ((saved ?? []) as { hs_id: string }[]).map((x) => x.hs_id);
  if (!ids.length) return NextResponse.json({ cards: [] });
  const [{ data: rows }, { data: reqs }] = await Promise.all([
    db.from("hubspot_company_pool").select("hs_id, name, domain, properties").in("hs_id", ids),
    db.from("acti_requests").select("hs_id").eq("client_id", s.user.clientId).neq("status", "cancelada").in("hs_id", ids),
  ]);
  const pp = await peopleFor(db, ((rows ?? []) as { domain: string | null }[]).map((r) => r.domain));
  const requested = new Set(((reqs ?? []) as { hs_id: string }[]).map((r) => r.hs_id));
  const byId = new Map(((rows ?? []) as { hs_id: string; name: string; domain: string | null; properties: Record<string, unknown> }[]).map((r) => [r.hs_id, r]));
  const cards = ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => rowToCard({ ...r, ...(r.domain ? pp.get(r.domain) : undefined) }));
  await attachFit(db, s.user.clientId, cards, false);
  return NextResponse.json({ cards: cards.map((c) => ({ ...c, saved: true, requested: requested.has(c.hsId) })) });
}

// POST { ref } guarda · DELETE { ref } quita
export async function POST(req: NextRequest) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const id = decodeRef((await req.json().catch(() => null))?.ref);
  if (!id || id.source !== "hubspot") return NextResponse.json({ error: "Empresa inválida" }, { status: 400 });
  const db = supabaseAdmin();
  const { data: row } = await db.from("hubspot_company_pool").select("hs_id, name, domain").eq("hs_id", id.key).maybeSingle();
  if (!row) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  const { error } = await db.from("acti_saved_companies").upsert(
    { client_id: s.user.clientId, hs_id: row.hs_id, company_name: row.name, domain: row.domain, saved_by: s.user.email },
    { onConflict: "client_id,hs_id", ignoreDuplicates: true }
  );
  if (error) return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { s, response } = await requireActiUser();
  if (response) return response;
  const id = decodeRef((await req.json().catch(() => null))?.ref);
  if (!id) return NextResponse.json({ error: "Empresa inválida" }, { status: 400 });
  await supabaseAdmin().from("acti_saved_companies").delete().eq("client_id", s.user.clientId).eq("hs_id", id.key);
  return NextResponse.json({ ok: true });
}
