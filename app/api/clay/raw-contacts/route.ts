import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany, RawContact } from "@/lib/contactsIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Webhook entrante de Clay con contactos crudos de "Find people at company".
// Formatos aceptados:
//   1) Un solo contacto:
//      { wecad_company_id, first_name, last_name, job_title, ... }
//      o { company_table_data: { wecad_company_id, ... }, first_name, ... }
//   2) Lote para una empresa:
//      { wecad_company_id, contacts: [ {first_name,...}, ... ] }
//      o { wecad_company_id, people: [...] }
//   3) Lote mixto (cada item con su propio wecad_company_id):
//      [ { wecad_company_id, ... }, { wecad_company_id, ... } ]
// El id de empresa se busca primero en wecad_company_id (flat). Si no está,
// se intenta extraer de company_table_data.wecad_company_id (objeto o JSON string).

type IncomingContact = RawContact & {
  wecad_company_id?: string;
  company_table_data?: any;
  "Company Table Data"?: any;
};

function extractCompanyId(item: IncomingContact): string {
  const direct = (item.wecad_company_id ?? "").toString().trim();
  if (direct) return direct;
  const ctd = item.company_table_data ?? item["Company Table Data"];
  if (ctd && typeof ctd === "object") {
    const fromObj = (ctd.wecad_company_id ?? "").toString().trim();
    if (fromObj) return fromObj;
  }
  if (typeof ctd === "string") {
    try {
      const parsed = JSON.parse(ctd);
      const fromStr = (parsed?.wecad_company_id ?? "").toString().trim();
      if (fromStr) return fromStr;
    } catch {
      // ignore
    }
  }
  return "";
}

function checkAuth(req: NextRequest): { ok: true } | { ok: false; error: string } {
  const expected = process.env.CLAY_WEBHOOK_SECRET;
  if (!expected) return { ok: true }; // auth opcional
  const hdr =
    req.headers.get("x-webhook-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (hdr !== expected) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

function normalize(body: any): IncomingContact[] {
  if (!body) return [];
  if (Array.isArray(body)) return body as IncomingContact[];
  if (Array.isArray(body.contacts)) {
    return (body.contacts as RawContact[]).map((c) => ({
      ...c,
      wecad_company_id: body.wecad_company_id ?? (c as any).wecad_company_id
    }));
  }
  if (Array.isArray(body.people)) {
    return (body.people as RawContact[]).map((c) => ({
      ...c,
      wecad_company_id: body.wecad_company_id ?? (c as any).wecad_company_id
    }));
  }
  // single contact
  return [body as IncomingContact];
}

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body == null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items = normalize(body);
  if (items.length === 0) {
    return NextResponse.json({ error: "No contacts in payload" }, { status: 400 });
  }

  // Agrupa por empresa.
  const byCompany = new Map<string, RawContact[]>();
  const noCompany: IncomingContact[] = [];
  for (const it of items) {
    const cid = extractCompanyId(it);
    if (!cid) {
      noCompany.push(it);
      continue;
    }
    const arr = byCompany.get(cid) ?? [];
    const {
      wecad_company_id: _omit,
      company_table_data: _omit2,
      "Company Table Data": _omit3,
      ...rest
    } = it;
    arr.push(rest);
    byCompany.set(cid, arr);
  }

  const db = supabaseAdmin();
  const totals = { received: items.length, inserted: 0, yes: 0, no: 0, skipped: 0 };
  const errors: { wecad_company_id: string; error: string }[] = [];

  for (const [companyId, contacts] of byCompany) {
    const r = await intakeContactsForCompany(db, companyId, contacts);
    if (!r.ok) {
      errors.push({ wecad_company_id: companyId, error: r.error });
      continue;
    }
    totals.inserted += r.summary.inserted;
    totals.yes += r.summary.yes;
    totals.no += r.summary.no;
    totals.skipped += r.summary.skipped;
  }

  if (noCompany.length > 0) {
    errors.push({
      wecad_company_id: "",
      error: `${noCompany.length} contact(s) sin wecad_company_id — no se persistieron`
    });
  }

  return NextResponse.json({ ...totals, errors });
}
