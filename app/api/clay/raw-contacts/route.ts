import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany, RawContact } from "@/lib/contactsIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Webhook entrante de Clay con contactos crudos de "Find people at company".
// Formatos aceptados:
//   1) Un solo contacto:
//      { bullseye_company_id, first_name, last_name, job_title, ... }
//      o { company_table_data: { bullseye_company_id, ... }, first_name, ... }
//   2) Lote para una empresa:
//      { bullseye_company_id, contacts: [ {first_name,...}, ... ] }
//      o { bullseye_company_id, people: [...] }
//   3) Lote mixto (cada item con su propio bullseye_company_id):
//      [ { bullseye_company_id, ... }, { bullseye_company_id, ... } ]
// El id de empresa se busca primero en bullseye_company_id (flat). Si no está,
// se intenta extraer de company_table_data.bullseye_company_id (objeto o JSON string).

type IncomingContact = RawContact & {
  bullseye_company_id?: string;
  company_table_data?: any;
  "Company Table Data"?: any;
};

// Clay serializa los sub-campos de "Company Table Data" usando el display name
// (ej. "Bullseye Company Id") en vez del internal name (bullseye_company_id).
// Esta búsqueda normaliza keys ignorando espacios, underscores y mayúsculas.
function pickBullseyeCompanyId(obj: Record<string, any>): string {
  for (const [k, v] of Object.entries(obj)) {
    if (k.replace(/[\s_]/g, "").toLowerCase() === "bullseyecompanyid") {
      const s = (v ?? "").toString().trim();
      if (s) return s;
    }
  }
  return "";
}

function extractCompanyId(item: IncomingContact): string {
  const direct = (item.bullseye_company_id ?? "").toString().trim();
  if (direct) return direct;
  const ctd = item.company_table_data ?? item["Company Table Data"];
  if (ctd && typeof ctd === "object") {
    const fromObj = pickBullseyeCompanyId(ctd);
    if (fromObj) return fromObj;
  }
  if (typeof ctd === "string") {
    try {
      const parsed = JSON.parse(ctd);
      if (parsed && typeof parsed === "object") {
        const fromStr = pickBullseyeCompanyId(parsed);
        if (fromStr) return fromStr;
      }
    } catch {
      // ignore
    }
  }
  return "";
}

// Intenta extraer bullseye_company_id de un string mal formateado usando regex.
function regexCompanyId(text: string): string {
  const m = text.match(/bullseye_company_id["':\s]+([a-f0-9-]{36})/i)
    ?? text.match(/Bullseye Company Id["':\s]+([a-f0-9-]{36})/i);
  return m ? m[1] : "";
}

// Parsea el body HTTP: intenta JSON.parse(); si falla intenta extraer
// solo el bullseye_company_id con regex para devolver un error descriptivo.
async function parseBody(req: NextRequest): Promise<{ ok: true; body: any } | { ok: false; error: string; companyId: string }> {
  const text = await req.text().catch(() => "");
  if (!text) return { ok: false, error: "Empty body", companyId: "" };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch (e) {
    const companyId = regexCompanyId(text);
    return {
      ok: false,
      error: `Invalid JSON body: ${(e as Error).message}`,
      companyId,
    };
  }
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
      bullseye_company_id: body.bullseye_company_id ?? (c as any).bullseye_company_id
    }));
  }
  if (Array.isArray(body.people)) {
    return (body.people as RawContact[]).map((c) => ({
      ...c,
      bullseye_company_id: body.bullseye_company_id ?? (c as any).bullseye_company_id
    }));
  }
  // single contact
  return [body as IncomingContact];
}

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const parsed = await parseBody(req);
  if (!parsed.ok) {
    return NextResponse.json({
      error: parsed.error,
      hint: parsed.companyId
        ? `Detected bullseye_company_id=${parsed.companyId} via regex but could not parse contacts`
        : "Could not extract any data from body"
    }, { status: 400 });
  }
  const body = parsed.body;

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
      bullseye_company_id: _omit,
      company_table_data: _omit2,
      "Company Table Data": _omit3,
      ...rest
    } = it;
    arr.push(rest);
    byCompany.set(cid, arr);
  }

  const db = supabaseAdmin();
  const totals = { received: items.length, inserted: 0, yes: 0, no: 0, skipped: 0 };
  const errors: { bullseye_company_id: string; error: string }[] = [];

  for (const [companyId, contacts] of byCompany) {
    const r = await intakeContactsForCompany(db, companyId, contacts);
    if (!r.ok) {
      errors.push({ bullseye_company_id: companyId, error: r.error });
      continue;
    }
    totals.inserted += r.summary.inserted;
    totals.yes += r.summary.yes;
    totals.no += r.summary.no;
    totals.skipped += r.summary.skipped;
  }

  if (noCompany.length > 0) {
    errors.push({
      bullseye_company_id: "",
      error: `${noCompany.length} contact(s) sin bullseye_company_id — no se persistieron`
    });
  }

  return NextResponse.json({ ...totals, errors });
}
