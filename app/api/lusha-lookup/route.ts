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
// está, fallback a HubSpot search por hs_linkedinid. Si encontramos el
// contacto:
//   - Si ya tiene phone y force=false → devolvemos already_has_phone.
//   - Si force=true o sin phone → llamamos Lusha. Si Lusha devuelve
//     phone, lo escribimos a HubSpot (wecad_phone_lusha + phone
//     principal) y a Supabase (phone_lusha + phone principal). Si el
//     contacto ya tenía phone (de Lemlist), también guardamos ese
//     valor en wecad_phone_lemlist / phone_lemlist como snapshot
//     para que no se pierda.
//
// Resultado: el SDR puede ver ambos teléfonos lado a lado en HubSpot.

type LookupResult = {
  ok: boolean;
  status:
    | "not_found"
    | "phone_not_found"
    | "already_has_phone"
    | "enriched";
  linkedin_url: string;
  contact?: {
    source: "supabase" | "hubspot";
    name: string | null;
    hubspot_contact_id: string | null;
    supabase_contact_id: string | null;
    existing_phone: string | null;
    phone_lemlist: string | null;
    phone_lusha: string | null;
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
        status: "not_found",
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

  // 2) Fallback HubSpot search.
  let hubspotContactId: string | null = supabaseContact?.hubspot_contact_id ?? null;
  let hubspotName: string | null = null;

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

  const existingPhone = supabaseContact?.phone ?? null;
  const existingPhoneLemlist = supabaseContact?.phone_lemlist ?? null;
  const existingPhoneLusha = supabaseContact?.phone_lusha ?? null;
  const existingSource = supabaseContact?.phone_source ?? null;
  const contactName = supabaseContact
    ? `${supabaseContact.first_name ?? ""} ${supabaseContact.last_name ?? ""}`.trim() || null
    : hubspotName;

  // 3) Si ya tiene phone y NO forzaron → devolvemos sin gastar Lusha.
  if (!force && existingPhone && existingPhone.trim().length > 4) {
    return NextResponse.json({
      ok: true,
      status: "already_has_phone",
      linkedin_url: normalized,
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

  // 5) Decidir si rescatamos el phone existente como "Lemlist phone".
  // Si el phone actual no es de Lusha (= probablemente vino de Lemlist
  // o de la sync nativa) Y todavía no tenemos phone_lemlist guardado,
  // lo snapshotteamos antes de sobreescribir.
  const shouldSnapshotLemlist =
    !!existingPhone &&
    existingPhone.trim().length > 4 &&
    existingSource !== "lusha" &&
    !existingPhoneLemlist;
  const newPhoneLemlist = shouldSnapshotLemlist
    ? existingPhone
    : existingPhoneLemlist;

  // 6) PATCH a HubSpot.
  let hubspotUpdated = false;
  let hubspotDebug: unknown = undefined;
  if (hubspotContactId) {
    const props: Record<string, string> = {
      phone: lushaPhone,
      wecad_phone_lusha: lushaPhone,
      wecad_phone_source: "lusha",
      wecad_phone_enrichment_status: "done_lusha"
    };
    if (shouldSnapshotLemlist && existingPhone) {
      props.wecad_phone_lemlist = existingPhone;
    }
    const upd = await updateObject("contacts", hubspotContactId, props);
    if (upd.ok) {
      hubspotUpdated = true;
    } else {
      hubspotDebug = upd;
    }
  }

  // 7) Update Supabase.
  let supabaseUpdated = false;
  if (supabaseContact) {
    const updFields: Record<string, unknown> = {
      phone: lushaPhone,
      phone_lusha: lushaPhone,
      phone_source: "lusha",
      phone_enriched_at: new Date().toISOString(),
      phone_enrichment_status: "done_lusha",
      lusha_lookup_at: new Date().toISOString()
    };
    if (shouldSnapshotLemlist && existingPhone) {
      updFields.phone_lemlist = existingPhone;
    }
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
    contact: {
      source: supabaseContact ? "supabase" : "hubspot",
      name: contactName,
      hubspot_contact_id: hubspotContactId,
      supabase_contact_id: supabaseContact?.id ?? null,
      existing_phone: existingPhone,
      phone_lemlist: newPhoneLemlist,
      phone_lusha: lushaPhone
    },
    phone: lushaPhone,
    hubspot_updated: hubspotUpdated,
    supabase_updated: supabaseUpdated,
    hubspot_debug: hubspotDebug
  } as LookupResult);
}
