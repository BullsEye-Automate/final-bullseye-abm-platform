import { NextRequest, NextResponse } from "next/server";
import { getAlloCallDetail } from "@/lib/allo";
import { searchHSContactsByPhones } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

// Detalle de una llamada puntual (transcript, resumen, tags) para el modal
// que se abre al hacer clic en una llamada del listado.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const call = await getAlloCallDetail(params.id);
    const hsMatches = await searchHSContactsByPhones([call.contact_number]);
    const hs = hsMatches.get(call.contact_number);

    return NextResponse.json({
      call: {
        ...call,
        contact_name: hs?.name ?? call.extracted_contact.name,
        contact_job_title: hs?.job_title ?? call.extracted_contact.job_title,
        contact_company: hs?.company_name ?? call.extracted_contact.company,
        hubspot_contact_id: hs?.contact_id ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error consultando Allo" }, { status: 500 });
  }
}
