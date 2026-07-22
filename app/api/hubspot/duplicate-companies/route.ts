import { NextRequest, NextResponse } from "next/server";
import { norm, listAllHSCompanies, type HSCompanyRecord } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Escanea TODAS las empresas del portal (solo lectura) y agrupa por nombre normalizado
// para detectar duplicados generados por la integración BullsEye Prospecting App.
export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_ACCESS_TOKEN no configurado" }, { status: 500 });

  const onlyIntegration = req.nextUrl.searchParams.get("all") !== "1";

  let all;
  try {
    all = await listAllHSCompanies();
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error listando empresas" }, { status: 502 });
  }

  const pool = onlyIntegration
    ? all.filter((c) => c.properties.hs_object_source_label === "INTEGRATION")
    : all;

  const groups = new Map<string, HSCompanyRecord[]>();
  for (const c of pool) {
    const name = c.properties.name?.trim();
    if (!name) continue;
    const key = norm(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const duplicates = [...groups.entries()]
    .filter(([, companies]) => companies.length > 1)
    .map(([, companies]) => ({
      name: companies[0].properties.name,
      count: companies.length,
      companies: companies
        .map((c) => ({
          id: c.id,
          bullseye_company_id: c.properties.bullseye_company_id ?? null,
          createdate: c.properties.createdate ?? null,
          hubspot_url: `https://app.hubspot.com/contacts/companies/${c.id}`,
        }))
        .sort((a, b) => (a.createdate ?? "").localeCompare(b.createdate ?? "")),
    }))
    .sort((a, b) => b.count - a.count);

  const extraRecords = duplicates.reduce((sum, d) => sum + (d.count - 1), 0);

  return NextResponse.json({
    scanned_companies: all.length,
    scanned_pool: pool.length,
    filter: onlyIntegration ? "hs_object_source_label=INTEGRATION (usa ?all=1 para escanear todas)" : "todas las empresas",
    duplicate_groups: duplicates.length,
    extra_duplicate_records: extraRecords,
    duplicates,
  });
}
