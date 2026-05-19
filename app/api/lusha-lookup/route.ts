import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { lookupLushaPerson } from "@/lib/lusha";
import { searchByProperty, updateObject } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Lookup manual de teléfono vía Lusha + Lemlist.
//
// Flujo (sesión 2026-05-19b):
//   1. Pega el LinkedIn URL → normalizamos.
//   2. Buscamos el contacto en Supabase y HubSpot.
//   3. Llamamos a Lusha SIEMPRE (incluso si no está en sistema). Lusha
//      devuelve phone + email + nombre/cargo/empresa (best-effort).
//   4. Si el contacto vive en Supabase → ya tenemos phone_lemlist
//      (sincronizado por el botón "Levantar teléfonos de Lemlist").
//      Si no vive, no podemos consultar Lemlist por linkedin URL en
//      una sola llamada — Lemlist no expone search-by-linkedin. El
//      SDR ve solo lo de Lusha en ese caso.
//   5. Si el contacto NO está en Supabase ni HubSpot, devolvemos los
//      datos igual con not_in_system=true. La UI ofrece "Crear en
//      HubSpot" para insertarlo con un click.
//
// Reglas de escritura (ya implementadas):
//   - phone principal NO se toca con Lusha — siempre va a wecad_phone_lusha
//     (HubSpot) y phone_lusha (Supabase). Así Lemlist y Lusha conviven.

type LookupResult = {
  ok: boolean;
  status:
    | "not_in_system_no_phone"
    | "not_in_system_with_phone"
    | "phone_not_found"
    | "already_has_phone"
    | "enriched";
  linkedin_url: string;
  not_in_system?: boolean;
  contact?: {
    source: "supabase" | "hubspot" | "lusha";
    name: string | null;
    hubspot_contact_id: string | null;
    supabase_contact_id: string | null;
    existing_phone: string | null;
    phone_lemlist: string | null;
    phone_lusha: string | null;
    // Solo se llenan cuando el contacto NO está en sistema y los
    // recuperamos de Lusha — la UI los usa para pre-llenar el form
    // "Crear en HubSpot".
    suggested_first_name?: string | null;
    suggested_last_name?: string | null;
    suggested_email?: string | null;
    suggested_job_title?: string | null;
    suggested_company_name?: string | null;
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
  const force = !!(body as { force?: boolean }).force;
  const normalized = normalizeLinkedinUrl(rawUrl);

  if (!normalized) {
    return NextResponse.json(
      {
        ok: false,
        status: "not_in_system_no_phone",
        linkedin_url: rawUrl,
        error: "URL inválida. Esperaba algo como linkedin.com/in/<usuario>"
      } as LookupResult,
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  // 1) Buscar el contacto en Supabase.
  const slug = normalized.split("/in/")[1]?.replace(/\/$/, "") ?? "";
  const { data: rows } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, phone, phone_lemlist, phone_lusha, phone_source, linkedin_url, hubspot_contact_id, company_id"
    )
    .or(`linkedin_url.ilike.%${slug}%,linkedin_url.eq.${normalized}`)
    .limit(5);

  let supabaseContact = rows && rows.length > 0 ? rows[0] : null;
  if (rows && rows.length > 1) {
    const withHs = rows.find((r) => r.hubspot_contact_id);
    if (withHs) supabaseContact = withHs;
  }

  // 2) Fallback HubSpot search. También recuperamos wecad_phone_lemlist
  //    para mostrarlo cuando el contacto vive solo en HubSpot.
  let hubspotContactId: string | null = supabaseContact?.hubspot_contact_id ?? null;
  let hubspotName: string | null = null;
  let hubspotPhone: string | null = null;
  let hubspotPhoneLemlist: string | null = null;

  if (!hubspotContactId) {
    const hsSearch = await searchByProperty("contacts", "hs_linkedinid", normalized, [
      "firstname",
      "lastname",
      "phone",
      "wecad_phone_lemlist",
      "wecad_phone_lusha"
    ]);
    if (hsSearch.ok && hsSearch.data && hsSearch.data.results.length > 0) {
      const hs = hsSearch.data.results[0];
      const props = hs.properties as Record<string, string>;
      hubspotContactId = hs.id;
      hubspotName =
        `${props.firstname ?? ""} ${props.lastname ?? ""}`.trim() || null;
      hubspotPhone = props.phone ?? null;
      hubspotPhoneLemlist = props.wecad_phone_lemlist ?? null;
    }
  }

  const inSystem = !!(supabaseContact || hubspotContactId);
  const existingPhone =
    supabaseContact?.phone ?? hubspotPhone ?? null;
  const existingPhoneLemlist =
    supabaseContact?.phone_lemlist ?? hubspotPhoneLemlist ?? null;
  const existingPhoneLusha = supabaseContact?.phone_lusha ?? null;
  const contactName = supabaseContact
    ? `${supabaseContact.first_name ?? ""} ${supabaseContact.last_name ?? ""}`.trim() || null
    : hubspotName;

  // 3) Si está en sistema y ya tiene phone y NO forzaron → devolvemos sin
  //    gastar Lusha.
  if (inSystem && !force && existingPhone && existingPhone.trim().length > 4) {
    return NextResponse.json({
      ok: true,
      status: "already_has_phone",
      linkedin_url: normalized,
      not_in_system: false,
      contact: {
        source: supabaseContact ? "supabase" : "hubspot",
        name: contactName,
        hubspot_contact_id: hubspotContactId,
        supabase_contact_id: supabaseContact?.id ?? null,
        existing_phone: existingPhone,
        phone_lemlist: existingPhoneLemlist,
        phone_lusha: existingPhoneLusha
      },
      phone: existingPhone
    } as LookupResult);
  }

  // 4) Llamar a Lusha (siempre, esté o no en sistema).
  const lusha = await lookupLushaPerson({
    linkedinUrl: normalized,
    firstName: supabaseContact?.first_name ?? null,
    lastName: supabaseContact?.last_name ?? null
  });

  // 4.a) Lusha sin phone.
  if (!lusha.ok || !lusha.phone) {
    // Caso 1: contacto no está en sistema y Lusha tampoco encontró nada
    // útil → mostramos sugerencias (nombre/cargo/empresa) si Lusha las dio
    // para que el SDR pueda crearlo a mano con esa data parcial.
    if (!inSystem) {
      const suggested = lusha.ok ? lusha : null;
      return NextResponse.json({
        ok: true,
        status: "not_in_system_no_phone",
        linkedin_url: normalized,
        not_in_system: true,
        contact: {
          source: "lusha",
          name:
            suggested?.first_name || suggested?.last_name
              ? `${suggested?.first_name ?? ""} ${suggested?.last_name ?? ""}`.trim()
              : null,
          hubspot_contact_id: null,
          supabase_contact_id: null,
          existing_phone: null,
          phone_lemlist: null,
          phone_lusha: null,
          suggested_first_name: suggested?.first_name ?? null,
          suggested_last_name: suggested?.last_name ?? null,
          suggested_email: suggested?.email ?? null,
          suggested_job_title: suggested?.job_title ?? null,
          suggested_company_name: suggested?.company_name ?? null
        },
        lusha_debug: lusha.ok
          ? { status: lusha.status, raw: lusha.raw }
          : { error: lusha.error, status: lusha.status, debug: (lusha as { debug?: unknown }).debug }
      } as LookupResult);
    }
    // Caso 2: contacto SÍ en sistema, Lusha no encontró phone.
    return NextResponse.json({
      ok: true,
      status: "phone_not_found",
      linkedin_url: normalized,
      not_in_system: false,
      contact: {
        source: supabaseContact ? "supabase" : "hubspot",
        name: contactName,
        hubspot_contact_id: hubspotContactId,
        supabase_contact_id: supabaseContact?.id ?? null,
        existing_phone: existingPhone,
        phone_lemlist: existingPhoneLemlist,
        phone_lusha: existingPhoneLusha
      },
      lusha_debug: lusha.ok
        ? { status: lusha.status, raw: lusha.raw, email_found: lusha.email }
        : { error: lusha.error, status: lusha.status, debug: (lusha as { debug?: unknown }).debug }
    } as LookupResult);
  }

  const lushaPhone = lusha.phone;

  // 4.b) Lusha SÍ encontró phone, pero el contacto no está en sistema —
  //      devolvemos todo para que el SDR cree el contacto en HubSpot.
  if (!inSystem) {
    return NextResponse.json({
      ok: true,
      status: "not_in_system_with_phone",
      linkedin_url: normalized,
      not_in_system: true,
      contact: {
        source: "lusha",
        name:
          lusha.first_name || lusha.last_name
            ? `${lusha.first_name ?? ""} ${lusha.last_name ?? ""}`.trim()
            : null,
        hubspot_contact_id: null,
        supabase_contact_id: null,
        existing_phone: null,
        phone_lemlist: null,
        phone_lusha: lushaPhone,
        suggested_first_name: lusha.first_name,
        suggested_last_name: lusha.last_name,
        suggested_email: lusha.email,
        suggested_job_title: lusha.job_title,
        suggested_company_name: lusha.company_name
      },
      phone: lushaPhone
    } as LookupResult);
  }

  // 5) Contacto en sistema + Lusha con phone → persistimos en wecad_phone_lusha
  //    SOLO. El campo principal NO se toca (preserva Lemlist).
  let hubspotUpdated = false;
  let hubspotDebug: unknown = undefined;
  if (hubspotContactId) {
    const props: Record<string, string> = {
      wecad_phone_lusha: lushaPhone,
      wecad_phone_enrichment_status: "done_lusha"
    };
    const upd = await updateObject("contacts", hubspotContactId, props);
    if (upd.ok) {
      hubspotUpdated = true;
    } else {
      hubspotDebug = upd;
    }
  }

  let supabaseUpdated = false;
  if (supabaseContact) {
    const updFields: Record<string, unknown> = {
      phone_lusha: lushaPhone,
      phone_enrichment_status: "done_lusha",
      lusha_lookup_at: new Date().toISOString()
    };
    const { error: updErr } = await db
      .from("contacts")
      .update(updFields)
      .eq("id", supabaseContact.id);
    if (!updErr) supabaseUpdated = true;
  }

  return NextResponse.json({
    ok: true,
    status: "enriched",
    linkedin_url: normalized,
    not_in_system: false,
    contact: {
      source: supabaseContact ? "supabase" : "hubspot",
      name: contactName,
      hubspot_contact_id: hubspotContactId,
      supabase_contact_id: supabaseContact?.id ?? null,
      existing_phone: existingPhone,
      phone_lemlist: existingPhoneLemlist,
      phone_lusha: lushaPhone
    },
    phone: lushaPhone,
    hubspot_updated: hubspotUpdated,
    supabase_updated: supabaseUpdated,
    hubspot_debug: hubspotDebug
  } as LookupResult);
}
