import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HS = "https://api.hubapi.com";

function headers() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: "sin token" }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") ?? "contact_props";

  // ── Listar todas las propiedades de contacto
  if (mode === "contact_props") {
    const r = await fetch(`${HS}/crm/v3/properties/contacts?limit=500`, { headers: headers() });
    const d = await r.json();
    const props = (d.results ?? []).map((p: any) => ({
      name: p.name,
      label: p.label,
      type: p.type,
      groupName: p.groupName,
    }));
    return NextResponse.json({ total: props.length, props });
  }

  // ── Listar todas las propiedades de empresa
  if (mode === "company_props") {
    const r = await fetch(`${HS}/crm/v3/properties/companies?limit=500`, { headers: headers() });
    const d = await r.json();
    const props = (d.results ?? []).map((p: any) => ({
      name: p.name,
      label: p.label,
      type: p.type,
      groupName: p.groupName,
    }));
    return NextResponse.json({ total: props.length, props });
  }

  // ── Traer un contacto real con todas sus props populadas
  if (mode === "sample_contact") {
    const contactId = searchParams.get("id");
    if (!contactId) {
      // Buscar el último contacto modificado
      const search = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
          limit: 5,
          properties: ["firstname", "lastname", "email", "jobtitle", "phone", "lifecyclestage", "hs_lead_status", "associatedcompanyid"],
        }),
      });
      const d = await search.json();
      return NextResponse.json(d);
    }

    // Traer contacto específico con TODAS sus props no vacías
    const r = await fetch(`${HS}/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,jobtitle,phone,lifecyclestage,hs_lead_status,hs_linkedin_bio,notes_last_contacted,num_contacted_notes,hs_email_last_send_date,associatedcompanyid,bullseye_sdr_asignado,bullseye_estado_contacto,bullseye_canal_preferido,hs_content_membership_status&associations=companies,notes,emails`, {
      headers: headers(),
    });
    const d = await r.json();
    return NextResponse.json(d);
  }

  // ── Traer empresa asociada
  if (mode === "sample_company") {
    const companyId = searchParams.get("id");
    if (!companyId) return NextResponse.json({ error: "id requerido" });
    const r = await fetch(`${HS}/crm/v3/objects/companies/${companyId}?properties=name,domain,industry,numberofemployees,annualrevenue,city,country,description,linkedin_company_page,bullseye_company_id,pais_g,hs_lead_status,lifecyclestage,bullseye_icp_fit,bullseye_estado`, {
      headers: headers(),
    });
    const d = await r.json();
    return NextResponse.json(d);
  }

  // ── Traer notas de un contacto
  if (mode === "contact_notes") {
    const contactId = searchParams.get("id");
    if (!contactId) return NextResponse.json({ error: "id requerido" });
    const r = await fetch(`${HS}/crm/v3/objects/contacts/${contactId}/associations/notes`, {
      headers: headers(),
    });
    const assoc = await r.json();
    const noteIds = (assoc.results ?? []).slice(0, 5).map((n: any) => n.id);
    const notes = await Promise.all(noteIds.map((id: string) =>
      fetch(`${HS}/crm/v3/objects/notes/${id}?properties=hs_note_body,hs_timestamp,hubspot_owner_id`, { headers: headers() })
        .then(r => r.json())
    ));
    return NextResponse.json({ noteIds, notes });
  }

  // ── Propiedades bullseye custom (filtrar por prefijo)
  if (mode === "bullseye_props") {
    const [cr, cr2] = await Promise.all([
      fetch(`${HS}/crm/v3/properties/contacts?limit=500`, { headers: headers() }),
      fetch(`${HS}/crm/v3/properties/companies?limit=500`, { headers: headers() }),
    ]);
    const dc = await cr.json();
    const dc2 = await cr2.json();
    const contactBullseye = (dc.results ?? []).filter((p: any) => p.name.startsWith("bullseye_")).map((p: any) => ({ name: p.name, label: p.label, type: p.type }));
    const companyBullseye = (dc2.results ?? []).filter((p: any) => p.name.startsWith("bullseye_")).map((p: any) => ({ name: p.name, label: p.label, type: p.type }));
    return NextResponse.json({ contactBullseye, companyBullseye });
  }

  return NextResponse.json({ modes: ["contact_props", "company_props", "sample_contact", "sample_company", "contact_notes", "bullseye_props"] });
}
