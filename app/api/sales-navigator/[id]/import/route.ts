import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { intakeContactsForCompany, type RawContact } from "@/lib/contactsIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pre-filtro de Claude por cada contacto — puede tardar con varios.
export const maxDuration = 300;

// POST /api/sales-navigator/[id]/import   ([id] = company id)
//   body { contacts: [{ first_name?, last_name?, job_title?, linkedin_url?, linkedin_headline?, email? }] }
//
// Importa los contactos que el usuario encontró en Sales Navigator. Pasa por
// el pipeline compartido intakeContactsForCompany (pre-filtro Claude + dedup
// + insert). Al insertar cualquier fila, ese pipeline limpia
// clay_no_contacts_at + sales_nav_status → la empresa sale del módulo.
//
// Devuelve los contactos YES recién importados (pendientes, sin push) para
// que el módulo los muestre inline con el botón "Directo a Lemlist".
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const rawContacts = (body as { contacts?: unknown }).contacts;
  if (!Array.isArray(rawContacts) || rawContacts.length === 0) {
    return NextResponse.json({ error: "No hay contactos para importar" }, { status: 400 });
  }

  const contacts: RawContact[] = [];
  for (const c of rawContacts) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const linkedin = str(o.linkedin_url);
    const first = str(o.first_name);
    const last = str(o.last_name);
    // Cada contacto necesita al menos URL de LinkedIn o un nombre.
    if (!linkedin && !first && !last) continue;
    contacts.push({
      first_name: first || null,
      last_name: last || null,
      job_title: str(o.job_title) || null,
      linkedin_headline: str(o.linkedin_headline) || null,
      linkedin_url: linkedin || null,
      email: str(o.email) || null
    });
  }
  if (contacts.length === 0) {
    return NextResponse.json(
      {
        error:
          "Los contactos no tienen ni URL de LinkedIn ni nombre — no hay nada para importar."
      },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const result = await intakeContactsForCompany(db, params.id, contacts);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Contactos YES recién importados (esta empresa estaba en "Por revisar", o
  // sea sin contactos previos, así que estos son los de este import).
  const { data: fresh } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, linkedin_url, email, prefilter_result, " +
        "status, fit_action, lemlist_pushed_at, lemlist_push_error, clay_pushed_at, created_at"
    )
    .eq("company_id", params.id)
    .eq("prefilter_result", "yes")
    .is("lemlist_pushed_at", null)
    .is("clay_pushed_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ ok: true, summary: result.summary, contacts: fresh ?? [] });
}
