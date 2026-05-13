import { NextRequest, NextResponse } from "next/server";
import {
  ensureContactProperties,
  ensureCompanyProperties
} from "@/lib/hubspotProperties";
import { ensureList, LIST_DEFINITIONS } from "@/lib/hubspotLists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// One-shot endpoint para crear:
//   1. Custom properties wecad_* (incluye phone_lemlist, phone_lusha
//      que no se crearon todavía si no pusheaste contactos post-PR-#64).
//   2. Las 7 listas dinámicas que el SDR usa día a día (definidas en
//      lib/hubspotLists.ts).
//
// Idempotente: si las properties o listas ya existen, no las duplica.

export async function POST(_req: NextRequest) {
  // 1) Asegurar custom props con force=true (saltar cache de instancia,
  // útil cuando agregamos properties nuevas a CONTACT_PROPERTIES y
  // queremos que se creen retroactivamente).
  const contactProps = await ensureContactProperties({ force: true });
  const companyProps = await ensureCompanyProperties({ force: true });

  // 2) Crear listas.
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
