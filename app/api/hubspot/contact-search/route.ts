import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS = "https://api.hubapi.com";
function hsHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function resolveToken(clientId: string | null): Promise<string> {
  const defaultToken = process.env.HUBSPOT_ACCESS_TOKEN ?? "";
  if (!clientId) return defaultToken;
  const db = supabaseAdmin();
  const { data } = await db
    .from("client_configs")
    .select("hubspot_access_token")
    .eq("client_id", clientId)
    .single();
  return data?.hubspot_access_token || defaultToken;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ contacts: [] });

  const clientId = req.nextUrl.searchParams.get("clientId");
  const token = await resolveToken(clientId);

  const isEmail = q.includes("@");
  const tokens = q.trim().split(/\s+/);

  // HubSpot limita a 3 filterGroups por request — hay que priorizar
  let filterGroups: object[];
  if (isEmail) {
    // Email: solo EQ exacto — el fallback por usuario local da falsos positivos
    filterGroups = [
      { filters: [{ propertyName: "email", operator: "EQ", value: q.toLowerCase() }] },
    ];
  } else if (tokens.length >= 2) {
    // Nombre completo: priorizar combinación firstname+lastname
    filterGroups = [
      {
        filters: [
          { propertyName: "firstname", operator: "CONTAINS_TOKEN", value: tokens[0] },
          { propertyName: "lastname",  operator: "CONTAINS_TOKEN", value: tokens.slice(1).join(" ") },
        ],
      },
      { filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: q }] },
      { filters: [{ propertyName: "company",   operator: "CONTAINS_TOKEN", value: q }] },
    ];
  } else {
    // Una sola palabra: buscar en los campos principales
    filterGroups = [
      { filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: q }] },
      { filters: [{ propertyName: "lastname",  operator: "CONTAINS_TOKEN", value: q }] },
      { filters: [{ propertyName: "email",     operator: "CONTAINS_TOKEN", value: q }] },
    ];
  }

  const body = {
    filterGroups,
    properties: [
      "firstname", "lastname", "email", "jobtitle", "phone",
      "lifecyclestage", "hs_lead_status",
      "bullseye_estado_contacto", "bullseye_sdr_asignado", "bullseye_canal_preferido",
      "company", "associatedcompanyid", "lastmodifieddate", "num_contacted_notes",
      "notes_last_contacted",
    ],
    sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
    limit: 10,
  };

  const r = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: hsHeaders(token),
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) {
    console.error("HubSpot contact-search error:", JSON.stringify(d));
    return NextResponse.json({ contacts: [], error: d?.message });
  }
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
    company: c.properties.company ?? "",
    associatedcompanyid: c.properties.associatedcompanyid ?? "",
    num_contacted: c.properties.num_contacted_notes ?? "",
    last_contacted: c.properties.notes_last_contacted ?? "",
  }));
  return NextResponse.json({ contacts });
}
