import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";
import { searchHSContact, searchHSContactByLinkedinUrl, patchHSContact } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Extrae el slug de LinkedIn (ej. "juan-garcia") desde cualquier formato de URL.
 */
function extractLinkedInSlug(url: string): string | null {
  const clean = url.replace(/[?#].*$/, "").replace(/\/$/, "");
  const match = clean.match(/linkedin\.com\/in\/([^/]+)/i);
  return match ? match[1] : null;
}

/**
 * POST /api/lusha/lookup
 * Body: { linkedin_url: string, contact_id?: string }
 *
 * 1. Normaliza la URL de LinkedIn y extrae el slug.
 * 2. Consulta la API de Lusha.
 * 3. Si devuelve teléfono y se proporcionó contact_id, actualiza Supabase.
 * 4. Retorna el resultado.
 */
export async function POST(req: NextRequest) {
  // Verificar API key de Lusha
  const lushaKey = process.env.LUSHA_API_KEY;
  if (!lushaKey) {
    return NextResponse.json(
      { error: "LUSHA_API_KEY no está configurada en el entorno" },
      { status: 500 }
    );
  }

  let body: { linkedin_url?: string; contact_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (!body.linkedin_url?.trim()) {
    return NextResponse.json(
      { error: "Se requiere linkedin_url en el body" },
      { status: 400 }
    );
  }

  // Extraer slug y reconstruir URL canónica
  const slug = extractLinkedInSlug(body.linkedin_url);
  if (!slug) {
    return NextResponse.json(
      { error: "No se pudo extraer el slug de LinkedIn de la URL proporcionada" },
      { status: 400 }
    );
  }

  const canonicalUrl = `https://www.linkedin.com/in/${slug}`;

  // Lusha v2 NO acepta linkedinUrl directo — requiere email O firstName+lastName+companies.
  // Si no nos pasaron esos datos, intentar resolverlos desde Supabase por linkedin_url.
  let firstName: string | undefined = body.first_name;
  let lastName:  string | undefined = body.last_name;
  let email:     string | undefined = body.email;
  let companyName: string | undefined = body.company_name;

  if (!email && (!firstName || !lastName || !companyName)) {
    const db = supabaseAdmin();
    const { data: matched } = await db
      .from("contacts")
      .select("first_name, last_name, email, company_id")
      .eq("linkedin_url", canonicalUrl)
      .limit(1)
      .maybeSingle();
    if (matched) {
      firstName ||= matched.first_name  ?? undefined;
      lastName  ||= matched.last_name   ?? undefined;
      email     ||= matched.email       ?? undefined;
      if (!companyName && matched.company_id) {
        const { data: co } = await db
          .from("companies")
          .select("company_name")
          .eq("id", matched.company_id)
          .maybeSingle();
        companyName ||= co?.company_name ?? undefined;
      }
    }
  }

  const hasEmail   = Boolean(email);
  const hasNameCo  = Boolean(firstName && lastName && companyName);

  // Debug que vuelve en la respuesta para diagnosticar desde la UI sin Vercel logs.
  const debug: Record<string, any> = {
    canonical_url: canonicalUrl,
    inputs:        { hasEmail, hasNameCo, firstName, lastName, companyName, email },
    attempts:      [] as Array<Record<string, any>>,
  };

  if (!hasEmail && !hasNameCo) {
    return NextResponse.json({
      found: false,
      message: "Lusha API requiere email o nombre+empresa. Este contacto no está en BullsEye con esos datos.",
      debug,
    });
  }

  let lushaData: any = null;
  let lushaError: string | null = null;

  try {
    // Lusha API v2: body con array `contacts`. Incluimos linkedinUrl SIEMPRE como signal adicional,
    // junto con email O nombre+empresa. Si v2 lo rechaza, reintenta sin él.
    const baseContact: Record<string, unknown> = { contactId: "lookup-1" };
    if (hasEmail)    baseContact.email     = email;
    if (firstName)   baseContact.firstName = firstName;
    if (lastName)    baseContact.lastName  = lastName;
    if (companyName) baseContact.companies = [{ name: companyName }];

    async function callLusha(includeLinkedin: boolean): Promise<{ status: number; ok: boolean; body: string }> {
      const contact = includeLinkedin ? { ...baseContact, linkedinUrl: canonicalUrl } : baseContact;
      const payload = { contacts: [contact] };
      const r = await fetch("https://api.lusha.com/v2/person", {
        method: "POST",
        headers: { api_key: lushaKey!, api_token: lushaKey!, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const text = await r.text().catch(() => "");
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch {}
      debug.attempts.push({
        includeLinkedin,
        payload,
        status:        r.status,
        response_body: text.slice(0, 1500),
        response_json: parsed,
      });
      return { status: r.status, ok: r.ok, body: text };
    }

    let resp = await callLusha(true);
    if (resp.status === 400 && /linkedinUrl/i.test(resp.body)) {
      resp = await callLusha(false);
    }
    const postRes  = { status: resp.status, ok: resp.ok };
    const postBody = resp.body;

    if (postRes.ok) {
      let json: any = null;
      try { json = JSON.parse(postBody); } catch {}
      // v2 bulk: { contacts: { "lookup-1": { data: {...} } } }
      const bulkData = json?.contacts?.["lookup-1"]?.data ?? null;
      if (bulkData) {
        lushaData = bulkData;
      } else if (json?.status === "success" && json?.data) {
        lushaData = json.data;
      } else if (json?.data) {
        lushaData = json.data;
      } else {
        lushaError = json?.message ?? "Lusha no devolvió datos";
      }
    } else if (postRes.status === 404) {
      // Lusha 404 en v2 = no encontró el contacto
      return NextResponse.json({ found: false, message: "Lusha no encontró este contacto", debug });
    } else {
      // Fallback: GET legacy
      const encodedUrl = encodeURIComponent(canonicalUrl);
      const getRes = await fetch(
        `https://api.lusha.com/person?linkedinUrl=${encodedUrl}&api_token=${lushaKey}`,
        { cache: "no-store" }
      );

      if (getRes.ok) {
        const json = await getRes.json();
        if (json?.data) {
          lushaData = json.data;
        } else {
          lushaError = json?.message ?? "Lusha no devolvió datos (GET fallback)";
        }
      } else if (getRes.status === 404) {
        // Lusha 404 = no encontró el contacto, no es error
        return NextResponse.json({ found: false, message: "Lusha no encontró este contacto", debug });
      } else {
        const errText = await getRes.text().catch(() => "");
        lushaError = `Lusha respondió ${getRes.status}: ${errText.slice(0, 200)}`;
      }
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: `Error de red al consultar Lusha: ${err?.message ?? "desconocido"}` },
      { status: 502 }
    );
  }

  // Sin datos de Lusha
  if (!lushaData) {
    return NextResponse.json({
      found: false,
      message: lushaError ?? "Sin teléfono en Lusha",
      debug,
    });
  }

  // Extraer teléfonos
  const phones: Array<{ localizedType: string; number: string }> =
    lushaData.phoneNumbers ?? [];

  if (phones.length === 0) {
    return NextResponse.json({
      found: false,
      message: "Sin resultados en Lusha para esta URL. No se consumió crédito.",
      debug: { ...debug, lusha_data: lushaData },
    });
  }

  const firstPhone = phones[0];

  // Extraer email
  const emails: Array<{ emailAddress: string; type?: string }> =
    lushaData.emailAddresses ?? [];
  const firstEmail = emails[0]?.emailAddress ?? null;

  // Extraer empresa devuelta por Lusha
  const lushaCompanyName: string | null = lushaData.company?.name ?? null;

  const result: Record<string, unknown> = {
    found: true,
    phone: firstPhone.number,
    phone_type: firstPhone.localizedType ?? null,
    email: firstEmail,
    first_name: lushaData.firstName ?? null,
    last_name: lushaData.lastName ?? null,
    job_title: lushaData.jobTitle ?? null,
    company_name: lushaCompanyName,
    hubspot_updated: false,
  };

  // Auto-update HubSpot si el LinkedIn URL matchea un contacto existente (cualquier contacto en HubSpot, no solo BullsEye)
  try {
    const hsId = (await searchHSContactByLinkedinUrl(canonicalUrl).catch(() => null))
              ?? (firstEmail ? await searchHSContact(firstEmail).catch(() => null) : null);
    if (hsId) {
      await patchHSContact(hsId, { bullseye_telefono_lusha: firstPhone.number });
      result.hubspot_updated = true;
      console.log(`[lusha-lookup] HubSpot actualizado hsId=${hsId} telefono_lusha=${firstPhone.number}`);
    }
  } catch (err: any) {
    console.error("[lusha-lookup] HubSpot update error:", err?.message);
  }

  // Si se proporcionó contact_id, actualizar Supabase y HubSpot
  if (body.contact_id) {
    try {
      const db = supabaseAdmin();
      await db
        .from("contacts")
        .update({ phone: firstPhone.number, phone_source: "lusha" })
        .eq("id", body.contact_id);

      // Actualizar bullseye_telefono_lusha en HubSpot si el contacto ya fue sincronizado
      if (firstEmail) {
        const hsContactId = await searchHSContact(firstEmail).catch(() => null);
        if (hsContactId) {
          await patchHSContact(hsContactId, { bullseye_telefono_lusha: firstPhone.number });
        }
      }
    } catch (dbErr: any) {
      console.error("[lusha/lookup] Error actualizando Supabase/HubSpot:", dbErr?.message);
    }
  }

  return NextResponse.json(result);
}
