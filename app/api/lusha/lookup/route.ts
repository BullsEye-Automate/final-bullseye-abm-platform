import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeLinkedInUrl } from "@/lib/normalizeLinkedIn";
import { searchHSContact, patchHSContact } from "@/lib/hubspot";

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

  // Llamar a Lusha API — primero POST v2, luego GET legacy como fallback
  let lushaData: any = null;
  let lushaError: string | null = null;

  try {
    const postRes = await fetch("https://api.lusha.com/v2/person", {
      method: "POST",
      headers: {
        api_token: lushaKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ linkedinUrl: canonicalUrl }),
      cache: "no-store",
    });

    if (postRes.ok) {
      const json = await postRes.json();
      if (json?.status === "success" && json?.data) {
        lushaData = json.data;
      } else if (json?.data) {
        // Algunos endpoints no incluyen status explícito
        lushaData = json.data;
      } else {
        lushaError = json?.message ?? "Lusha no devolvió datos";
      }
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
    });
  }

  // Extraer teléfonos
  const phones: Array<{ localizedType: string; number: string }> =
    lushaData.phoneNumbers ?? [];

  if (phones.length === 0) {
    return NextResponse.json({
      found: false,
      message: "Sin resultados en Lusha para esta URL. No se consumió crédito.",
    });
  }

  const firstPhone = phones[0];

  // Extraer email
  const emails: Array<{ emailAddress: string; type?: string }> =
    lushaData.emailAddresses ?? [];
  const firstEmail = emails[0]?.emailAddress ?? null;

  // Extraer empresa
  const companyName: string | null = lushaData.company?.name ?? null;

  const result = {
    found: true,
    phone: firstPhone.number,
    phone_type: firstPhone.localizedType ?? null,
    email: firstEmail,
    first_name: lushaData.firstName ?? null,
    last_name: lushaData.lastName ?? null,
    job_title: lushaData.jobTitle ?? null,
    company_name: companyName,
  };

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
