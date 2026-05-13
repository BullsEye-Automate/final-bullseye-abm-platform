import { NextRequest, NextResponse } from "next/server";
import {
  ensureContactProperties,
  ensureCompanyProperties
} from "@/lib/hubspotProperties";
import { ensureList, LIST_DEFINITIONS } from "@/lib/hubspotLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Endpoint one-shot para crear las 6 listas dinámicas que el SDR usa.
// Idempotente: si la lista ya existe (búsqueda por nombre exacto), no la
// duplica. Antes de crearlas, asegura que existan todas las custom
// properties (wecad_fit_score, wecad_phone_enrichment_status, etc.) que
// las listas referencian — si no, los filtros tirarían 400.

export async function POST(_req: NextRequest) {
  // 1) Asegurar custom props (contacts + companies). Forzamos saltarse el
  // cache de instance porque el usuario puede correr esto para crear
  // properties nuevas que se agregaron en commits posteriores.
  const contactProps = await ensureContactProperties({ force: true });
  const companyProps = await ensureCompanyProperties({ force: true });

  // 2) Crear las listas.
  const results: Array<{
    name: string;
    ok: boolean;
    created: boolean;
    listId?: string;
    error?: string;
    debug?: unknown;
  }> = [];
  for (const def of LIST_DEFINITIONS) {
    const r = await ensureList(def);
    if (r.ok) {
      results.push({
        name: def.name,
        ok: true,
        created: r.data?.created ?? false,
        listId: r.data?.list.listId
      });
    } else {
      results.push({
        name: def.name,
        ok: false,
        created: false,
        error: r.error,
        debug: r.debug
      });
    }
  }

  return NextResponse.json({
    properties: {
      contacts: contactProps,
      companies: companyProps
    },
    lists: results,
    summary: {
      total: results.length,
      created: results.filter((r) => r.created).length,
      already_existed: results.filter((r) => r.ok && !r.created).length,
      failed: results.filter((r) => !r.ok).length
    }
  });
}
