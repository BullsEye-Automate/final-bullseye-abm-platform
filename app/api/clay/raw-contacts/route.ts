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
// Formato recomendado (sin company_table_data):
//   {
//     "first_name": "...",
//     "last_name": "...",
//     "job_title": "...",
//     "linkedin_url": "...",              ← LinkedIn del contacto
//     "company_linkedin_url": "..."       ← LinkedIn de la empresa (chip de Company Table Data.linkedin_url)
//   }
//
// El endpoint resuelve bullseye_company_id en dos pasos:
//   1. Busca bullseye_company_id directo en el payload (compatibilidad hacia atrás)
//   2. Si no lo encuentra, busca la empresa en Supabase por company_linkedin_url

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type IncomingContact = RawContact & {
  bullseye_company_id?: string;
  company_table_data?: any;
  "Company Table Data"?: any;
  company_linkedin_url?: string;
};

// ── Búsqueda de empresa por LinkedIn URL ─────────────────────────────────────

// Extrae el slug de una URL de LinkedIn company (ej. "acme-corp" de ".../company/acme-corp").
function extractLinkedInSlug(url: string): string | null {
  const m = url.match(/\/company\/([A-Za-z0-9._%-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// Busca la empresa en Supabase comparando el slug del LinkedIn URL.
// LinkedIn URLs son globalmente únicas, por lo que no filtramos por client_id.
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

// ── Extracción de bullseye_company_id del payload (compatibilidad) ────────────

function pickCompanyIdFromObject(obj: Record<string, any>): string {
  // Paso 1: match exacto ignorando espacios/underscores/mayúsculas
  for (const [k, v] of Object.entries(obj)) {
    if (k.replace(/[\s_-]/g, "").toLowerCase() === "bullseyecompanyid") {
      const s = (v ?? "").toString().trim();
      if (s && UUID_RE.test(s)) return s;
    }
  }
  // Paso 2: cualquier key con "company"+"id" y valor UUID
  for (const [k, v] of Object.entries(obj)) {
    const norm = k.replace(/[\s_-]/g, "").toLowerCase();
    if (norm.includes("company") && norm.includes("id")) {
      const s = (v ?? "").toString().trim();
      if (s && UUID_RE.test(s)) return s;
    }
  }
  return "";
}

function pickCompanyIdFromString(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const fromObj = pickCompanyIdFromObject(parsed);
      if (fromObj) return fromObj;
    }
  } catch { /* continuar */ }

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

// Intenta extraer bullseye_company_id únicamente del payload (sin DB).
function extractCompanyIdFromPayload(item: IncomingContact): string {
  const direct = (item.bullseye_company_id ?? "").toString().trim();
  if (direct && UUID_RE.test(direct)) return direct;

  const ctd = item.company_table_data ?? item["Company Table Data"];
  if (ctd && typeof ctd === "object") {
    const fromObj = pickCompanyIdFromObject(ctd as Record<string, any>);
    if (fromObj) return fromObj;
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

// ── Parseo del body ────────────────────────────────────────────────────────────

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
  if (!expected) return { ok: true };
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
      bullseye_company_id:    body.bullseye_company_id    ?? (c as any).bullseye_company_id,
      company_table_data:     body.company_table_data     ?? (c as any).company_table_data,
      company_linkedin_url:   body.company_linkedin_url   ?? (c as any).company_linkedin_url,
    }));
  }
  if (Array.isArray(body.people)) {
    return (body.people as RawContact[]).map((c) => ({
      ...c,
      bullseye_company_id:    body.bullseye_company_id    ?? (c as any).bullseye_company_id,
      company_table_data:     body.company_table_data     ?? (c as any).company_table_data,
      company_linkedin_url:   body.company_linkedin_url   ?? (c as any).company_linkedin_url,
    }));
  }
  return [body as IncomingContact];
}

// ── Handler principal ──────────────────────────────────────────────────────────

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

  const items = normalize(parsed.body);
  if (items.length === 0) {
    return NextResponse.json({ error: "No contacts in payload" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Agrupa contactos por empresa, resolviendo el company ID en dos pasos.
  const byCompany = new Map<string, RawContact[]>();
  const noCompany: IncomingContact[] = [];

  for (const it of items) {
    // Paso 1: extrae del payload (compatibilidad hacia atrás)
    let cid = extractCompanyIdFromPayload(it);

    // Paso 2: busca en Supabase por company_linkedin_url si no se encontró en el payload
    if (!cid && it.company_linkedin_url) {
      cid = (await findCompanyByLinkedin(db, it.company_linkedin_url)) ?? "";
    }

    if (!cid) {
      noCompany.push(it);
      continue;
    }

    const arr = byCompany.get(cid) ?? [];
    const {
      bullseye_company_id:  _omit1,
      company_table_data:   _omit2,
      "Company Table Data": _omit3,
      company_linkedin_url: _omit4,
      ...rest
    } = it;
    arr.push(rest);
    byCompany.set(cid, arr);
  }

  const totals = { received: items.length, inserted: 0, yes: 0, no: 0, skipped: 0 };
  const errors: { bullseye_company_id: string; error: string }[] = [];

  for (const [companyId, contacts] of byCompany) {
    const r = await intakeContactsForCompany(db, companyId, contacts);
    if (!r.ok) {
      errors.push({ bullseye_company_id: companyId, error: r.error });
      continue;
    }
    totals.inserted += r.summary.inserted;
    totals.yes      += r.summary.yes;
    totals.no       += r.summary.no;
    totals.skipped  += r.summary.skipped;
  }

  if (noCompany.length > 0) {
    errors.push({
      bullseye_company_id: "",
      error: `${noCompany.length} contact(s) sin bullseye_company_id ni company_linkedin_url reconocible — no se persistieron`,
    });
  }

  return NextResponse.json({ ...totals, errors });
}
