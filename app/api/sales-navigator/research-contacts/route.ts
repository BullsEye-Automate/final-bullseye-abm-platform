import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  researchContactFromLinkedin,
  isLinkedinProfileUrl,
  type ContactDraft
} from "@/lib/salesNavContactResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Research con Perplexity + Claude por cada URL — lento si son varias.
export const maxDuration = 300;

// POST /api/sales-navigator/research-contacts
//   body { company_id: string, linkedin_urls: string[] }
//
// Para cada URL de perfil de LinkedIn, intenta sacar nombre + cargo con IA.
// NO inserta nada — devuelve `drafts` para que el usuario revise/edite en la
// UI antes de importar. Best-effort: LinkedIn bloquea scraping (ver
// lib/salesNavContactResearch.ts).
const MAX_URLS = 12;
const CHUNK = 3;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const companyId =
    typeof (body as { company_id?: unknown }).company_id === "string"
      ? ((body as { company_id: string }).company_id).trim()
      : "";
  const rawUrls = (body as { linkedin_urls?: unknown }).linkedin_urls;

  if (!companyId) {
    return NextResponse.json({ error: "Falta company_id" }, { status: 400 });
  }
  if (!Array.isArray(rawUrls)) {
    return NextResponse.json(
      { error: "linkedin_urls debe ser un array de strings" },
      { status: 400 }
    );
  }

  // Normalizar + dedup + validar que sean URLs de perfil.
  const urls = [
    ...new Set(
      rawUrls
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter((u) => u && isLinkedinProfileUrl(u))
    )
  ].slice(0, MAX_URLS);

  if (urls.length === 0) {
    return NextResponse.json(
      {
        error:
          "No se encontró ninguna URL de perfil de LinkedIn válida (formato linkedin.com/in/...)."
      },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { data: company, error: cErr } = await db
    .from("companies")
    .select("company_name, company_type")
    .eq("id", companyId)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!company) {
    return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });
  }

  // Research en chunks paralelos de 3 (mismo patrón que el import de CSV).
  const drafts: ContactDraft[] = [];
  for (let i = 0; i < urls.length; i += CHUNK) {
    const slice = urls.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map((url) =>
        researchContactFromLinkedin({
          linkedin_url: url,
          company_name: company.company_name ?? null,
          company_type: company.company_type ?? null
        })
      )
    );
    drafts.push(...results);
  }

  return NextResponse.json({
    ok: true,
    requested: urls.length,
    found: drafts.filter((d) => d.found).length,
    drafts
  });
}
