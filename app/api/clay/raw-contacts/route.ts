import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany, RawContact } from "@/lib/contactsIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Webhook entrante de Clay con contactos crudos de "Find people at company".
//
// Formatos aceptados para bullseye_company_id:
//   A) Campo directo (recomendado — configurar en Clay así):
//      { "bullseye_company_id": "uuid", "first_name": "...", ... }
//
//   B) Dentro de company_table_data como objeto:
//      { "company_table_data": { "Bullseye Company Id": "uuid" }, ... }
//
//   C) Dentro de company_table_data como JSON string (Clay a veces serializa así):
//      { "company_table_data": "{\"Bullseye Company Id\":\"uuid\"}", ... }
//
//   D) String truncado o malformado — se extrae con regex como último recurso.
//
// Para usar la opción A desde Clay: en el body del HTTP API action añadir un campo
//   bullseye_company_id  =  {{Company Table Data.Bullseye Company Id}}
// Esto chipea solo el sub-campo y evita enviar el objeto completo.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type IncomingContact = RawContact & {
  bullseye_company_id?: string;
  company_table_data?: any;
  "Company Table Data"?: any;
};

// Busca bullseye_company_id en un objeto ya parseado.
// Paso 1: match exacto (ignora espacios, underscores y mayúsculas).
// Paso 2: cualquier key que contenga "company" e "id" y cuyo valor sea un UUID.
function pickCompanyIdFromObject(obj: Record<string, any>): string {
  // Paso 1 — match exacto "bullseyecompanyid"
  for (const [k, v] of Object.entries(obj)) {
    if (k.replace(/[\s_-]/g, "").toLowerCase() === "bullseyecompanyid") {
      const s = (v ?? "").toString().trim();
      if (s && UUID_RE.test(s)) return s;
    }
  }
  // Paso 2 — cualquier key con "company" + "id" y valor UUID
  for (const [k, v] of Object.entries(obj)) {
    const norm = k.replace(/[\s_-]/g, "").toLowerCase();
    if (norm.includes("company") && norm.includes("id")) {
      const s = (v ?? "").toString().trim();
      if (s && UUID_RE.test(s)) return s;
    }
  }
  return "";
}

// Extrae bullseye_company_id de un string (JSON o malformado) usando tres estrategias.
function pickCompanyIdFromString(text: string): string {
  // Estrategia 1: JSON.parse + búsqueda en objeto
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const fromObj = pickCompanyIdFromObject(parsed);
      if (fromObj) return fromObj;
    }
  } catch { /* continuar */ }

  // Estrategia 2: regex sobre el texto crudo (funciona con JSON truncado o malformado)
  const patterns = [
    /bullseye_company_id["'\s:]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /Bullseye\s+Company\s+Id["'\s:]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /company[_\s-]?id["'\s:]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }

  return "";
}

function extractCompanyId(item: IncomingContact): string {
  // A) campo directo bullseye_company_id
  const direct = (item.bullseye_company_id ?? "").toString().trim();
  if (direct && UUID_RE.test(direct)) return direct;

  // B/C/D) company_table_data como objeto o string
  const ctd = item.company_table_data ?? item["Company Table Data"];
  if (ctd && typeof ctd === "object") {
    const fromObj = pickCompanyIdFromObject(ctd as Record<string, any>);
    if (fromObj) return fromObj;
    // Si el objeto tiene valores string, buscar en ellos también
    for (const v of Object.values(ctd as Record<string, any>)) {
      if (typeof v === "string") {
        const fromStr = pickCompanyIdFromString(v);
        if (fromStr) return fromStr;
      }
    }
  }
  if (typeof ctd === "string" && ctd.trim()) {
    const fromStr = pickCompanyIdFromString(ctd);
    if (fromStr) return fromStr;
  }

  return "";
}

// Parsea el body HTTP: intenta JSON.parse(); si falla extrae bullseye_company_id
// con regex para devolver un error descriptivo en lugar de un 500 genérico.
async function parseBody(
  req: NextRequest
): Promise<{ ok: true; body: any } | { ok: false; error: string; companyId: string }> {
  const text = await req.text().catch(() => "");
  if (!text) return { ok: false, error: "Empty body", companyId: "" };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch (e) {
    const companyId = pickCompanyIdFromString(text);
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
      bullseye_company_id: body.bullseye_company_id ?? (c as any).bullseye_company_id,
      company_table_data: body.company_table_data ?? (c as any).company_table_data,
    }));
  }
  if (Array.isArray(body.people)) {
    return (body.people as RawContact[]).map((c) => ({
      ...c,
      bullseye_company_id: body.bullseye_company_id ?? (c as any).bullseye_company_id,
      company_table_data: body.company_table_data ?? (c as any).company_table_data,
    }));
  }
  // contacto único
  return [body as IncomingContact];
}

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const parsed = await parseBody(req);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: parsed.error,
        hint: parsed.companyId
          ? `Detected bullseye_company_id=${parsed.companyId} via regex but could not parse contacts`
          : "Could not extract any data from body",
      },
      { status: 400 }
    );
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
      error: `${noCompany.length} contact(s) sin bullseye_company_id — no se persistieron`,
    });
  }

  return NextResponse.json({ ...totals, errors });
}
