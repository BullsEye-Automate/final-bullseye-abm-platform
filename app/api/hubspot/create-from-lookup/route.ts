import { NextRequest, NextResponse } from "next/server";
import {
  createObject,
  searchByProperty,
  updateObject
} from "@/lib/hubspot";
import { ensureContactProperties } from "@/lib/hubspotProperties";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Crea un contacto en HubSpot a partir de los datos que el SDR levantó en
// /telefonos cuando ese contacto NO está en Supabase ni HubSpot. Pensado
// para flujos puntuales del SDR — no toca Supabase. Si después el contacto
// pasa por la app, el sync normal lo va a encontrar por hs_linkedinid.
//
// Idempotente: si ya existe un contacto con el mismo linkedin URL en
// HubSpot, devolvemos su id (no crea duplicados). Si HubSpot devuelve 409
// "Contact already exists" en el create por email, parseamos el ID y
// hacemos PATCH (mismo patrón que pushContactToHubSpot).

type Body = {
  linkedin_url: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  phone_lusha?: string | null;
  phone_lemlist?: string | null;
  job_title?: string | null;
  company_name?: string | null;
};

function extractExistingHubSpotId(errorMessage: string): string | null {
  const match = errorMessage.match(/Existing\s*ID:\s*(\d+)/i);
  return match ? match[1] : null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const linkedinUrl = (body.linkedin_url ?? "").trim();
  if (!linkedinUrl) {
    return NextResponse.json(
      { ok: false, error: "Falta linkedin_url" },
      { status: 400 }
    );
  }
  if (!body.first_name && !body.last_name) {
    return NextResponse.json(
      { ok: false, error: "Falta nombre o apellido" },
      { status: 400 }
    );
  }

  await ensureContactProperties();

  // 1) Ya existe en HubSpot? Busca por hs_linkedinid.
  const search = await searchByProperty(
    "contacts",
    "hs_linkedinid",
    linkedinUrl,
    ["firstname", "lastname", "phone"]
  );
  if (search.ok && search.data && search.data.results.length > 0) {
    const existing = search.data.results[0];
    // Hace PATCH para asegurar que las wecad_phone_* se llenen.
    const props: Record<string, string> = {};
    if (body.phone_lusha) props.wecad_phone_lusha = body.phone_lusha;
    if (body.phone_lemlist) props.wecad_phone_lemlist = body.phone_lemlist;
    if (body.phone) props.phone = body.phone;
    if (body.job_title) props.jobtitle = body.job_title;
    if (body.company_name) props.company = body.company_name;
    if (Object.keys(props).length > 0) {
      await updateObject("contacts", existing.id, props);
    }
    return NextResponse.json({
      ok: true,
      hubspot_contact_id: existing.id,
      created: false,
      message: "Ya existía en HubSpot — actualicé los teléfonos"
    });
  }

  // 2) Crear.
  const props: Record<string, string> = {
    firstname: body.first_name ?? "",
    lastname: body.last_name ?? "",
    hs_linkedinid: linkedinUrl
  };
  if (body.email) props.email = body.email;
  if (body.phone) props.phone = body.phone;
  if (body.phone_lusha) props.wecad_phone_lusha = body.phone_lusha;
  if (body.phone_lemlist) props.wecad_phone_lemlist = body.phone_lemlist;
  if (body.job_title) props.jobtitle = body.job_title;
  if (body.company_name) props.company = body.company_name;
  if (body.phone_lusha || body.phone_lemlist) {
    props.wecad_phone_enrichment_status = body.phone_lusha
      ? "done_lusha"
      : "done_lemlist";
  }
  if (body.phone_lusha) props.wecad_phone_source = "lusha";
  else if (body.phone_lemlist) props.wecad_phone_source = "lemlist";

  const create = await createObject("contacts", props);
  if (create.ok && create.data) {
    return NextResponse.json({
      ok: true,
      hubspot_contact_id: create.data.id,
      created: true
    });
  }

  // 3) 409 → PATCH al ID existente.
  if (!create.ok && create.status === 409) {
    const id = extractExistingHubSpotId(create.error);
    if (id) {
      const patchProps = { ...props };
      delete patchProps.hs_linkedinid; // unique constraint, no se sobreescribe
      const upd = await updateObject("contacts", id, patchProps);
      if (upd.ok) {
        return NextResponse.json({
          ok: true,
          hubspot_contact_id: id,
          created: false,
          message: "Ya existía con ese email — actualicé el contacto"
        });
      }
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: create.ok ? `HubSpot ${create.status}` : create.error,
      debug: create
    },
    { status: 500 }
  );
}
