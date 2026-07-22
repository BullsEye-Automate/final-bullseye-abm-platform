import { NextRequest, NextResponse } from "next/server";
import { listAllHSCompanies, mergeHSCompanies, type HSCompanyRecord } from "@/lib/hubspot";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Group = {
  bullseye_company_id: string;
  name: string | null | undefined;
  primary: HSCompanyRecord;
  toMerge: HSCompanyRecord[];
};

// Solo se fusionan grupos que comparten el MISMO bullseye_company_id (property propia,
// seteada por nuestra app) -- es la única señal que garantiza que son la misma empresa
// real y no dos empresas distintas que coinciden de nombre. El más antiguo (createdate)
// se deja como primario; el resto se fusiona dentro de él (HubSpot mueve asociaciones
// y contactos automáticamente al primario, y archiva los duplicados).
//
// GET  -> dry-run: reporta qué se fusionaría, sin tocar HubSpot.
// POST ?confirm=1 -> ejecuta las fusiones. Es IRREVERSIBLE.
async function buildPlan(): Promise<{ groups: Group[]; manualReview: { name: string; ids: string[] }[] }> {
  const all = await listAllHSCompanies();

  const byBullseyeId = new Map<string, HSCompanyRecord[]>();
  for (const c of all) {
    const id = c.properties.bullseye_company_id?.trim();
    if (!id) continue;
    if (!byBullseyeId.has(id)) byBullseyeId.set(id, []);
    byBullseyeId.get(id)!.push(c);
  }

  const groups: Group[] = [];
  for (const [bullseyeId, companies] of byBullseyeId) {
    if (companies.length < 2) continue;
    const sorted = [...companies].sort((a, b) =>
      (a.properties.createdate ?? "").localeCompare(b.properties.createdate ?? "")
    );
    groups.push({
      bullseye_company_id: bullseyeId,
      name: sorted[0].properties.name,
      primary: sorted[0],
      toMerge: sorted.slice(1),
    });
  }

  // Empresas con el mismo nombre pero sin bullseye_company_id (o distinto) --
  // no se tocan automáticamente, solo se reportan para revisión manual.
  const byName = new Map<string, HSCompanyRecord[]>();
  for (const c of all) {
    const name = c.properties.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(c);
  }
  const mergedIds = new Set(groups.flatMap((g) => [g.primary.id, ...g.toMerge.map((c) => c.id)]));
  const manualReview = [...byName.values()]
    .filter((companies) => companies.length > 1 && companies.some((c) => !mergedIds.has(c.id)))
    .map((companies) => ({ name: companies[0].properties.name ?? "", ids: companies.map((c) => c.id) }));

  return { groups, manualReview };
}

function serializeGroups(groups: Group[]) {
  return groups.map((g) => ({
    bullseye_company_id: g.bullseye_company_id,
    name: g.name,
    primary: { id: g.primary.id, createdate: g.primary.properties.createdate ?? null },
    merged_into_primary: g.toMerge.map((c) => ({ id: c.id, createdate: c.properties.createdate ?? null })),
  }));
}

export async function GET() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_ACCESS_TOKEN no configurado" }, { status: 500 });

  const { groups, manualReview } = await buildPlan();
  const extraRecords = groups.reduce((sum, g) => sum + g.toMerge.length, 0);

  return NextResponse.json({
    mode: "dry_run",
    note: "Nada fue modificado. Repetí esta llamada como POST ?confirm=1 para ejecutar las fusiones.",
    eligible_groups: groups.length,
    extra_records_to_merge: extraRecords,
    groups: serializeGroups(groups),
    requires_manual_review: manualReview,
  });
}

export async function POST(req: NextRequest) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_ACCESS_TOKEN no configurado" }, { status: 500 });

  const confirm = req.nextUrl.searchParams.get("confirm") === "1";
  const { groups, manualReview } = await buildPlan();

  if (!confirm) {
    const extraRecords = groups.reduce((sum, g) => sum + g.toMerge.length, 0);
    return NextResponse.json({
      mode: "dry_run",
      note: "Agregá ?confirm=1 a la URL para ejecutar. Esta acción fusiona empresas en HubSpot y NO se puede deshacer.",
      eligible_groups: groups.length,
      extra_records_to_merge: extraRecords,
      groups: serializeGroups(groups),
      requires_manual_review: manualReview,
    });
  }

  const db = supabaseAdmin();
  const results: { bullseye_company_id: string; name: string | null | undefined; primary_id: string; merged: { id: string; ok: boolean; error?: string }[] }[] = [];

  for (const g of groups) {
    const merged: { id: string; ok: boolean; error?: string }[] = [];
    for (const dup of g.toMerge) {
      const r = await mergeHSCompanies(g.primary.id, dup.id);
      merged.push({ id: dup.id, ok: r.ok, error: r.error });
    }
    results.push({ bullseye_company_id: g.bullseye_company_id, name: g.name, primary_id: g.primary.id, merged });

    if (merged.some((m) => m.ok)) {
      await db.from("companies").update({ hubspot_company_id: g.primary.id }).eq("id", g.bullseye_company_id);
    }
  }

  const mergedOk = results.reduce((sum, r) => sum + r.merged.filter((m) => m.ok).length, 0);
  const mergedFailed = results.reduce((sum, r) => sum + r.merged.filter((m) => !m.ok).length, 0);

  return NextResponse.json({
    mode: "executed",
    groups_processed: results.length,
    merged_ok: mergedOk,
    merged_failed: mergedFailed,
    results,
    requires_manual_review: manualReview,
  });
}
