import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";
import { listAlloNumbers, searchAlloCalls, listAlloTags, getAlloOutboundAnalytics, type AlloUserRef } from "@/lib/allo";
import { searchHSContactsByPhones } from "@/lib/hubspot";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

function toDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest, { params }: Params) {
  const rangeParam = req.nextUrl.searchParams.get("range") ?? "";
  const key: RangeKey = isValidRangeKey(rangeParam) ? rangeParam : "this_month";
  const range = resolveRange(key);

  const db = supabaseAdmin();
  // "__all__" es el sentinel que usa el resto de la app para "todos los
  // clientes" (ver app/api/dashboard/route.ts) — en ese caso se agregan los
  // números asignados de todos los clientes en vez de filtrar por uno.
  const isAllClients = params.id === "__all__";
  let assignedQuery = db.from("client_allo_numbers").select("allo_number, allo_number_name");
  if (!isAllClients) assignedQuery = assignedQuery.eq("client_id", params.id);
  const { data: assigned, error: assignedErr } = await assignedQuery;

  if (assignedErr) return NextResponse.json({ error: assignedErr.message }, { status: 500 });

  const assignedNumbers = (assigned ?? []).map((r) => r.allo_number);
  if (assignedNumbers.length === 0) {
    return NextResponse.json({
      no_numbers: true,
      calls: [],
      sdrs: [],
      tags: [],
      numbers: [],
      connected_by_number: null,
      stats: { llamadas_realizadas: 0, conectados: 0, reuniones_agendadas: 0, contactos: 0, empresas: 0 },
    });
  }

  try {
    const dateFrom = toDateParam(range.start);
    const dateTo = toDateParam(range.end);

    const [callsByNumber, allNumbers, tags, analyticsByNumber] = await Promise.all([
      Promise.all(
        assignedNumbers.map((n) =>
          searchAlloCalls({ allo_number: n, date_from: dateFrom, date_to: dateTo, direction: "OUTBOUND" })
        )
      ),
      listAlloNumbers(),
      listAlloTags(),
      Promise.all(assignedNumbers.map((n) => getAlloOutboundAnalytics({ allo_number: n, date_from: dateFrom, date_to: dateTo }))),
    ]);

    const calls = callsByNumber.flat();

    // "Conectados" no se puede sacar del campo `result` de la llamada: Allo
    // marca como ANSWERED incluso llamadas que cayeron a buzón de voz. Este
    // número viene del clasificador propio de Allo (el mismo que alimenta su
    // dashboard), agregado por número y por SDR para poder respetar los
    // filtros de número/SDR sin volver a pedirlo. Si Allo no pudo responder
    // para algún número, se marca todo como no disponible en vez de mostrar
    // un total parcial que se vea como definitivo.
    const connectedByNumber = analyticsByNumber.every((a) => a !== null)
      ? assignedNumbers.map((allo_number, i) => ({
          allo_number,
          connected: analyticsByNumber[i]!.connected,
          by_user: analyticsByNumber[i]!.by_user,
        }))
      : null;

    // SDRs que gestionan la cuenta = usuarios asignados a los números de este cliente en Allo.
    const sdrMap = new Map<string, AlloUserRef>();
    for (const n of allNumbers) {
      if (!assignedNumbers.includes(n.number)) continue;
      for (const u of n.users) sdrMap.set(u.id, u);
    }
    const sdrs = Array.from(sdrMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    // Enriquecer con HubSpot: nombre / cargo / empresa por teléfono.
    const uniquePhones = Array.from(new Set(calls.map((c) => c.contact_number)));
    const hsMatches = await searchHSContactsByPhones(uniquePhones);

    const enrichedCalls = calls.map((c) => {
      const hs = hsMatches.get(c.contact_number);
      return {
        ...c,
        contact_name: hs?.name ?? c.extracted_contact.name,
        contact_job_title: hs?.job_title ?? c.extracted_contact.job_title,
        contact_company: hs?.company_name ?? c.extracted_contact.company,
        hubspot_contact_id: hs?.contact_id ?? null,
      };
    });

    // Fallback si el endpoint de analíticas de Allo no respondió: estimación
    // a partir de `result`, sabiendo que sobreestima (cuenta buzones de voz
    // marcados como ANSWERED). El frontend avisa cuando está en este modo.
    const connectedFallback = enrichedCalls.filter((c) => c.result === "ANSWERED" || c.result === "TRANSFERRED").length;
    const connectedTotal = connectedByNumber
      ? connectedByNumber.reduce((sum, n) => sum + n.connected, 0)
      : connectedFallback;
    const meetings = enrichedCalls.filter((c) => c.tags.includes("meeting_booked"));
    const uniqueContacts = new Set(enrichedCalls.map((c) => c.contact_number));
    const uniqueCompanies = new Set(
      enrichedCalls
        .map((c) => c.contact_company)
        .filter((c): c is string => !!c)
        .map((c) => c.trim().toLowerCase())
    );

    return NextResponse.json({
      no_numbers: false,
      range: { key, start: range.start, end: range.end, label: range.label },
      calls: enrichedCalls,
      sdrs,
      tags,
      numbers: assigned ?? [],
      connected_by_number: connectedByNumber,
      stats: {
        llamadas_realizadas: enrichedCalls.length,
        conectados: connectedTotal,
        reuniones_agendadas: meetings.length,
        contactos: uniqueContacts.size,
        empresas: uniqueCompanies.size,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Error consultando Allo" }, { status: 500 });
  }
}
