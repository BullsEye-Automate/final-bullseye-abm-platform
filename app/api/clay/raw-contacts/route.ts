import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany, RawContact } from "@/lib/contactsIntake";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Webhook entrante de Clay con contactos crudos de "Find people at company".
//
// Clay a veces envía JSON inválido con valores sin comillas:
//   {"first_name": Antti, "last_name": Kulpp, ...}
// El endpoint lee el body como texto y usa regex como fallback al JSON.parse().
//
// Body esperado desde Clay:
//   {
//     "first_name":           <chip>,
//     "last_name":            <chip>,
//     "job_title":            <chip>,
//     "linkedin_url":         <chip: linkedin_url del contacto>,
//     "company_linkedin_url": <chip: Company Table Data.linkedin_url>
//   }
//
// bullseye_company_id se resuelve en dos pasos:
//   1. Busca el campo directo en el payload (compatibilidad hacia atrás)
//   2. Si no lo encuentra, busca la empresa en Supabase por company_linkedin_url

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Campos que extraemos del body de Clay (soporta JSON válido e inválido)
const CLAY_FIELDS = [
  "first_name",
  "last_name",
  "job_title",
  "linkedin_headline",
  "seniority",
  "linkedin_url",
  "company_linkedin_url",
  "bullseye_company_id",
] as const;

type IncomingContact = RawContact & {
  bullseye_company_id?: string;
  company_table_data?: any;
  "Company Table Data"?: any;
  company_linkedin_url?: string;
};

// ── Parseo tolerante de texto ─────────────────────────────────────────────────

// Extrae el valor de un campo concreto de un texto que puede ser JSON válido
// o inválido (valores sin comillas). Maneja tanto "field": "value" como "field": value.
function extractFieldFromText(text: string, field: string): string {
  // Intento 1: valor entre comillas  "field": "value"
  const quotedRe = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "i");
  const quotedM = text.match(quotedRe);
  if (quotedM) return quotedM[1].trim();

  // Intento 2: valor sin comillas  "field": value  (para hasta coma, llave o fin)
  const unquotedRe = new RegExp(`"${field}"\\s*:\\s*([^\\s",}][^",}]*)`, "i");
  const unquotedM = text.match(unquotedRe);
  if (unquotedM) return unquotedM[1].trim();

  return "";
}

// Intenta extraer todos los campos conocidos del texto y devuelve un objeto plano.
// Funciona aunque el JSON esté malformado (valores sin comillas, truncados, etc.).
function extractFieldsFromText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of CLAY_FIELDS) {
    const val = extractFieldFromText(text, field);
    if (val) result[field] = val;
  }
  return result;
}

// Parsea el body: JSON.parse primero; si falla, regex campo a campo.
async function parseBody(
  req: NextRequest
): Promise<{ ok: true; body: any } | { ok: false; error: string }> {
  const text = await req.text().catch(() => "");
  if (!text) return { ok: false, error: "Empty body" };

  // Intento 1: JSON válido
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch { /* continuar */ }

  // Intento 2: extracción por regex (Clay sin comillas en los valores)
  const extracted = extractFieldsFromText(text);
  if (Object.keys(extracted).length > 0) {
    return { ok: true, body: extracted };
  }

  return { ok: false, error: "Invalid JSON body — no se pudieron extraer campos" };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(req: NextRequest): { ok: true } | { ok: false; error: string } {
  const expected = process.env.CLAY_WEBHOOK_SECRET;
  if (!expected) return { ok: true };
  const hdr =
    req.headers.get("x-webhook-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (hdr !== expected) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

// ── Lookup empresa por LinkedIn URL ───────────────────────────────────────────

function extractLinkedInSlug(url: string): string | null {
  const m = url.match(/\/company\/([A-Za-z0-9._%-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

async function findCompanyByLinkedin(
  db: SupabaseClient,
  rawUrl: string
): Promise<string | null> {
  const normalized = normalizeLinkedInUrl(rawUrl);
  if (!normalized) return null;
  const slug = extractLinkedInSlug(normalized);
  if (!slug) return null;

  const { data } = await db
    .from("companies")
    .select("id")
    .ilike("company_linkedin_url", `%/company/${slug}%`)
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

// ── Extracción de bullseye_company_id del payload ─────────────────────────────

function pickCompanyIdFromObject(obj: Record<string, any>): string {
  for (const [k, v] of Object.entries(obj)) {
    if (k.replace(/[\s_-]/g, "").toLowerCase() === "bullseyecompanyid") {
      const s = (v ?? "").toString().trim();
      if (s && UUID_RE.test(s)) return s;
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    const norm = k.replace(/[\s_-]/g, "").toLowerCase();
    if (norm.includes("company") && norm.includes("id")) {
      const s = (v ?? "").toString().trim();
      if (s && UUID_RE.test(s)) return s;
    }
  }
  return "";
}

function extractCompanyIdFromPayload(item: IncomingContact): string {
  const direct = (item.bullseye_company_id ?? "").toString().trim();
  if (direct && UUID_RE.test(direct)) return direct;

  const ctd = item.company_table_data ?? item["Company Table Data"];
  if (ctd && typeof ctd === "object") {
    const fromObj = pickCompanyIdFromObject(ctd as Record<string, any>);
    if (fromObj) return fromObj;
  }
  if (typeof ctd === "string" && ctd.trim()) {
    try {
      const parsed = JSON.parse(ctd);
      if (parsed && typeof parsed === "object") {
        const fromStr = pickCompanyIdFromObject(parsed);
        if (fromStr) return fromStr;
      }
    } catch { /* continuar */ }
  }
  return "";
}

// ── Normalización del body ────────────────────────────────────────────────────

function normalize(body: any): IncomingContact[] {
  if (!body) return [];
  if (Array.isArray(body)) return body as IncomingContact[];
  if (Array.isArray(body.contacts)) {
    return (body.contacts as RawContact[]).map((c) => ({
      ...c,
      bullseye_company_id:  body.bullseye_company_id  ?? (c as any).bullseye_company_id,
      company_table_data:   body.company_table_data   ?? (c as any).company_table_data,
      company_linkedin_url: body.company_linkedin_url ?? (c as any).company_linkedin_url,
    }));
  }
  if (Array.isArray(body.people)) {
    return (body.people as RawContact[]).map((c) => ({
      ...c,
      bullseye_company_id:  body.bullseye_company_id  ?? (c as any).bullseye_company_id,
      company_table_data:   body.company_table_data   ?? (c as any).company_table_data,
      company_linkedin_url: body.company_linkedin_url ?? (c as any).company_linkedin_url,
    }));
  }
  return [body as IncomingContact];
}

// ── Handler principal ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const parsed = await parseBody(req);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const items = normalize(parsed.body);
  if (items.length === 0) {
    return NextResponse.json({ error: "No contacts in payload" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const byCompany = new Map<string, RawContact[]>();
  const noCompany: IncomingContact[] = [];

  for (const it of items) {
    // Paso 1: extraer del payload
    let cid = extractCompanyIdFromPayload(it);

    // Paso 2: buscar en Supabase por LinkedIn URL
    if (!cid && it.company_linkedin_url) {
      cid = (await findCompanyByLinkedin(db, it.company_linkedin_url)) ?? "";
    }

    if (!cid) {
      noCompany.push(it);
      continue;
    }

    const arr = byCompany.get(cid) ?? [];
    const {
      bullseye_company_id:  _1,
      company_table_data:   _2,
      "Company Table Data": _3,
      company_linkedin_url: _4,
      ...rest
    } = it;
    arr.push(rest);
    byCompany.set(cid, arr);
  }

  const totals = { received: items.length, inserted: 0, yes: 0, no: 0, skipped: 0 };
  const errors:  { bullseye_company_id: string; error: string }[] = [];
  const debug:   { step: string; detail: string }[] = [];

  // Diagnóstico: qué campos llegaron
  const firstItem = items[0] as any;
  debug.push({ step: "fields_received", detail: Object.keys(firstItem).join(", ") });
  debug.push({ step: "company_linkedin_url", detail: firstItem.company_linkedin_url ?? "(vacío)" });

  for (const [companyId, contacts] of byCompany) {
    debug.push({ step: "company_found", detail: companyId });
    const r = await intakeContactsForCompany(db, companyId, contacts);
    if (!r.ok) {
      errors.push({ bullseye_company_id: companyId, error: r.error });
      debug.push({ step: "intake_error", detail: r.error });
      continue;
    }
    totals.inserted += r.summary.inserted;
    totals.yes      += r.summary.yes;
    totals.no       += r.summary.no;
    totals.skipped  += r.summary.skipped;
    debug.push({ step: "intake_ok", detail: `inserted=${r.summary.inserted} yes=${r.summary.yes} no=${r.summary.no} skipped=${r.summary.skipped}` });
    for (const p of r.pushDetails) {
      debug.push({ step: `push_${p.result}`, detail: `id=${p.contact_id}${p.skipped ? ` skipped=${p.skipped}` : ""}${p.error ? ` error=${p.error}` : ""}` });
    }
  }

  if (noCompany.length > 0) {
    debug.push({ step: "company_not_found", detail: `company_linkedin_url="${firstItem.company_linkedin_url}" — no coincide con ninguna empresa en Supabase` });
    errors.push({
      bullseye_company_id: "",
      error: `${noCompany.length} contact(s) sin empresa identificable — no se persistieron`,
    });
  }

  return NextResponse.json({ ...totals, errors, debug });
}
