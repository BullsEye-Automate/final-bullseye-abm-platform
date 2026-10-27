import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS = "https://api.hubapi.com";
function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ contacts: [] });

  const body = {
    filterGroups: [
      { filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: q }] },
      { filters: [{ propertyName: "lastname", operator: "CONTAINS_TOKEN", value: q }] },
      { filters: [{ propertyName: "email", operator: "CONTAINS_TOKEN", value: q }] },
      { filters: [{ propertyName: "company", operator: "CONTAINS_TOKEN", value: q }] },
    ],
    properties: [
      "firstname", "lastname", "email", "jobtitle", "phone",
      "lifecyclestage", "hs_lead_status",
      "bullseye_estado_contacto", "bullseye_sdr_asignado", "bullseye_canal_preferido",
      "associatedcompanyid", "lastmodifieddate", "num_contacted_notes",
      "notes_last_contacted",
    ],
    sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
    limit: 10,
  };

  const r = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify(body),
  });
  const d = await r.json();
  const contacts = (d.results ?? []).map((c: any) => ({
    id: c.id,
    firstname: c.properties.firstname ?? "",
    lastname: c.properties.lastname ?? "",
    email: c.properties.email ?? "",
    jobtitle: c.properties.jobtitle ?? "",
    phone: c.properties.phone ?? "",
    lifecyclestage: c.properties.lifecyclestage ?? "",
    estado_contacto: c.properties.bullseye_estado_contacto ?? "",
    sdr_asignado: c.properties.bullseye_sdr_asignado ?? "",
    canal_preferido: c.properties.bullseye_canal_preferido ?? "",
    associatedcompanyid: c.properties.associatedcompanyid ?? "",
    num_contacted: c.properties.num_contacted_notes ?? "",
    last_contacted: c.properties.notes_last_contacted ?? "",
  }));
  return NextResponse.json({ contacts });
}
