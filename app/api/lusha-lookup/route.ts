import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { lookupLushaPerson } from "@/lib/lusha";
import { searchByProperty, updateObject } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Sprint 4 fase 2 (revisión) — lookup manual de teléfono vía Lusha.
//
// Flujo: el SDR pega un LinkedIn URL → buscamos el contacto en Supabase
// (fuente de verdad de los contactos que pasaron por la app); si no
// está, fallback a HubSpot search por hs_linkedinid (la propiedad
// donde la app guarda el LinkedIn URL al pushear). Si encontramos el
// contacto en algún lado, llamamos a Lusha; si Lusha devuelve phone,
// lo escribimos en HubSpot (PATCH /crm/v3/objects/contacts/{id}) y
// también en Supabase si existe.
//
// El SDR ve: phone encontrado + dónde está reflejado.

type LookupResult = {
  ok: boolean;
  status:
    | "not_found"          // ni Supabase ni HubSpot tienen el contacto
    | "phone_not_found"    // contacto encontrado pero Lusha no trajo phone
    | "already_has_phone"  // contacto ya tenía phone (no hacemos nada)
    | "enriched";          // phone nuevo de Lusha, persistido
  linkedin_url: string;
  contact?: {
    source: "supabase" | "hubspot";
    name: string | null;
    hubspot_contact_id: string | null;
    supabase_contact_id: string | null;
    existing_phone: string | null;
  };
  phone?: string | null;
  hubspot_updated?: boolean;
  supabase_updated?: boolean;
  lusha_debug?: unknown;
  hubspot_debug?: unknown;
  error?: string;
};

function normalizeLinkedinUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Acepta formas como linkedin.com/in/foo, www.linkedin.com/in/foo,
  // https://linkedin.com/in/foo/, https://www.linkedin.com/in/foo?utm=x.
  // Devuelve la forma canónica https://www.linkedin.com/in/<slug>/.
  let url = trimmed;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/linkedin\.com$/i.test(parsed.hostname) && !/\.linkedin\.com$/i.test(parsed.hostname)) {
    return null;
  }
  const match = parsed.pathname.match(/^\/in\/([^/]+)/i);
  if (!match) return null;
  const slug = match[1].toLowerCase();
  return `https://www.linkedin.com/in/${slug}/`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawUrl =
    typeof (body as { linkedin_url?: string }).linkedin_url === "string"
      ? (body as { linkedin_url: string }).linkedin_url
      : "";
  const normalized = normalizeLinkedinUrl(rawUrl);

  if (!normalized) {
    return NextResponse.json(
      {
        ok: false,
        status: "not_found",
        linkedin_url: rawUrl,
        error: "URL inválida. Esperaba algo como linkedin.com/in/<usuario>"
      } as LookupResult,
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  // 1) Buscar el contacto en Supabase. Probamos exact match, además
  // de un LIKE por slug, para tolerar variantes (con o sin trailing
  // slash, lowercase vs no).
  const slug = normalized.split("/in/")[1]?.replace(/\/$/, "") ?? "";
  const { data: rows } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, phone, linkedin_url, hubspot_contact_id, company_id"
    )
    .or(`linkedin_url.ilike.%${slug}%,linkedin_url.eq.${normalized}`)
    .limit(5);

  let supabaseContact = rows && rows.length > 0 ? rows[0] : null;
  // Si Supabase tiene varios, preferimos el que ya esté en HubSpot.
  if (rows && rows.length > 1) {
    const withHs = rows.find((r) => r.hubspot_contact_id);
    if (withHs) supabaseContact = withHs;
  }

  // 2) Si no está en Supabase, fallback a HubSpot por hs_linkedinid.
  let hubspotContactId: string | null = supabaseContact?.hubspot_contact_id ?? null;
  let hubspotName: string | null = null;
  let hubspotExistingPhone: string | null = null;

  if (!hubspotContactId) {
    const hsSearch = await searchByProperty("contacts", "hs_linkedinid", normalized);
    if (hsSearch.ok && hsSearch.data && hsSearch.data.results.length > 0) {
      const hs = hsSearch.data.results[0];
      hubspotContactId = hs.id;
      hubspotName =
        `${(hs.properties as Record<string, string>).firstname ?? ""} ${
          (hs.properties as Record<string, string>).lastname ?? ""
        }`.trim() || null;
    }
  }

  if (!supabaseContact && !hubspotContactId) {
    return NextResponse.json({
      ok: false,
      status: "not_found",
      linkedin_url: normalized,
      error:
        "No encontré ese LinkedIn en Supabase ni en HubSpot. Verificá que el contacto haya pasado por la app."
    } as LookupResult);
  }

  const existingPhone =
    supabaseContact?.phone ?? hubspotExistingPhone ?? null;

  // 3) Si ya tiene phone, devolvemos sin gastar crédito Lusha.
  if (existingPhone && existingPhone.trim().length > 4) {
    return NextResponse.json({
      ok: true,
      status: "already_has_phone",
      linkedin_url: normalized,
      contact: {
        source: supabaseContact ? "supabase" : "hubspot",
        name: supabaseContact
          ? `${supabaseContact.first_name ?? ""} ${supabaseContact.last_name ?? ""}`.trim() || null
          : hubspotName,
        hubspot_contact_id: hubspotContactId,
        supabase_contact_id: supabaseContact?.id ?? null,
        existing_phone: existingPhone
      },
      phone: existingPhone
    } as LookupResult);
  }

  // 4) Llamar a Lusha.
  const lusha = await lookupLushaPerson({
    linkedinUrl: normalized,
    firstName: supabaseContact?.first_name ?? null,
    lastName: supabaseContact?.last_name ?? null
  });

  if (!lusha.ok || !lusha.phone) {
    return NextResponse.json({
      ok: false,
      status: "phone_not_found",
      linkedin_url: normalized,
      contact: {
        source: supabaseContact ? "supabase" : "hubspot",
        name: supabaseContact
          ? `${supabaseContact.first_name ?? ""} ${supabaseContact.last_name ?? ""}`.trim() || null
          : hubspotName,
        hubspot_contact_id: hubspotContactId,
        supabase_contact_id: supabaseContact?.id ?? null,
        existing_phone: null
      },
      lusha_debug: lusha.ok
        ? { status: lusha.status, raw: lusha.raw, email_found: lusha.email }
        : { error: lusha.error, status: lusha.status, debug: (lusha as { debug?: unknown }).debug }
    } as LookupResult);
  }

  const newPhone = lusha.phone;

  // 5) PATCH a HubSpot.
  let hubspotUpdated = false;
  let hubspotDebug: unknown = undefined;
  if (hubspotContactId) {
    const upd = await updateObject("contacts", hubspotContactId, {
      phone: newPhone,
      wecad_phone_source: "lusha",
      wecad_phone_enrichment_status: "done_lusha"
    });
    if (upd.ok) {
      hubspotUpdated = true;
    } else {
      hubspotDebug = upd;
    }
  }

  // 6) Update Supabase si existe el contacto ahí.
  let supabaseUpdated = false;
  if (supabaseContact) {
    const { error: updErr } = await db
      .from("contacts")
      .update({
        phone: newPhone,
        phone_source: "lusha",
        phone_enriched_at: new Date().toISOString(),
        phone_enrichment_status: "done_lusha",
        lusha_lookup_at: new Date().toISOString()
      })
      .eq("id", supabaseContact.id);
    if (!updErr) supabaseUpdated = true;
  }

  return NextResponse.json({
    ok: true,
    status: "enriched",
    linkedin_url: normalized,
    contact: {
      source: supabaseContact ? "supabase" : "hubspot",
      name: supabaseContact
        ? `${supabaseContact.first_name ?? ""} ${supabaseContact.last_name ?? ""}`.trim() || null
        : hubspotName,
      hubspot_contact_id: hubspotContactId,
      supabase_contact_id: supabaseContact?.id ?? null,
      existing_phone: null
    },
    phone: newPhone,
    hubspot_updated: hubspotUpdated,
    supabase_updated: supabaseUpdated,
    hubspot_debug: hubspotDebug
  } as LookupResult);
}
