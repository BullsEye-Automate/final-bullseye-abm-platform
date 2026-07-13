import { NextRequest, NextResponse } from "next/server";
import { norm } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS = "https://api.hubapi.com";

type HSCompany = {
  id: string;
  properties: {
    name?: string;
    bullseye_company_id?: string;
    createdate?: string;
    hs_object_source_label?: string;
  };
};

// Escanea TODAS las empresas del portal (solo lectura) y agrupa por nombre normalizado
// para detectar duplicados generados por la integración BullsEye Prospecting App.
export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_ACCESS_TOKEN no configurado" }, { status: 500 });

  const onlyIntegration = req.nextUrl.searchParams.get("all") !== "1";

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const all: HSCompany[] = [];
  let after: string | undefined;
  let pages = 0;
  const MAX_PAGES = 300; // hasta 30k empresas, suficiente margen de seguridad

  do {
    const url = new URL(`${HS}/crm/v3/objects/companies`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("properties", "name,bullseye_company_id,createdate,hs_object_source_label");
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `HubSpot ${res.status}`, detail: text.slice(0, 300), scanned: all.length }, { status: 502 });
    }
    const data = await res.json();
    all.push(...(data.results ?? []));
    after = data.paging?.next?.after;
    pages++;
  } while (after && pages < MAX_PAGES);

  const pool = onlyIntegration
    ? all.filter((c) => c.properties.hs_object_source_label === "INTEGRATION")
    : all;

  const groups = new Map<string, HSCompany[]>();
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
