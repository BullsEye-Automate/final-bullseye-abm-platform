import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Webhook entrante de Clay: se dispara cuando Find People devuelve 0
// contactos para una empresa. Marca companies.clay_no_contacts_at para
// que la UI de /empresas muestre el aviso y el usuario sepa que tiene
// que buscar contactos por otra vía (ej. "Buscar contactos en la web").
//
// Setup en Clay (tabla Companies): agregar una columna HTTP API con
// run condition que detecte "Find People result count = 0", apuntando a:
//   POST https://wecad-prospecting.vercel.app/api/clay/company-no-contacts
//   Headers: Content-Type: application/json, x-webhook-secret: <CLAY_WEBHOOK_SECRET>
//   Body: { "wecad_company_id": <chip wecad_company_id> }
//
// Acepta single o array. Keys case-insensitive (mismo trato que
// raw-contacts / scored-contacts — Clay serializa con display name).

type Incoming = { wecad_company_id?: string; [key: string]: unknown };

function checkAuth(req: NextRequest): { ok: true } | { ok: false; error: string } {
  const expected = process.env.CLAY_WEBHOOK_SECRET;
  if (!expected) return { ok: true };
  const hdr =
    req.headers.get("x-webhook-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (hdr !== expected) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

function normalizeKey(k: string): string {
  return k.replace(/[\s_]/g, "").toLowerCase();
}

function pickField(obj: Record<string, unknown>, internalName: string): unknown {
  const target = normalizeKey(internalName);
  for (const [k, v] of Object.entries(obj)) {
    if (normalizeKey(k) === target) return v;
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body == null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const items: Incoming[] = Array.isArray(body) ? body : [body];

  const db = supabaseAdmin();
  const totals = { received: items.length, marked: 0, skipped: 0 };
  const errors: { wecad_company_id: string; error: string }[] = [];

  for (const it of items) {
    const wecadId = (pickField(it, "wecad_company_id") ?? "").toString().trim();
    if (!wecadId) {
      totals.skipped += 1;
      errors.push({ wecad_company_id: "", error: "Missing wecad_company_id" });
      continue;
    }

    const { data: existing, error: fetchErr } = await db
      .from("companies")
      .select("id")
      .eq("id", wecadId)
      .maybeSingle();
    if (fetchErr) {
      errors.push({ wecad_company_id: wecadId, error: fetchErr.message });
      continue;
    }
    if (!existing) {
      totals.skipped += 1;
      errors.push({ wecad_company_id: wecadId, error: "Company not found" });
      continue;
    }

    const { error: updErr } = await db
      .from("companies")
      .update({ clay_no_contacts_at: new Date().toISOString() })
      .eq("id", wecadId);
    if (updErr) {
      errors.push({ wecad_company_id: wecadId, error: updErr.message });
      continue;
    }
    totals.marked += 1;
  }

  return NextResponse.json({ ...totals, errors });
}
