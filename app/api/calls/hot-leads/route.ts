import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveRange, isValidRangeKey, type RangeKey } from "@/lib/dashboardRanges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/calls/hot-leads?range=this_month&owner=<hubspot_owner_id>
//
// Identifica contactos con mayor probabilidad de convertir en cliente
// basándose en sus llamadas dentro del rango. Heurística:
//   - Última llamada dentro del rango tuvo respuesta positiva
//     (interested / callback_requested / objection_timing).
//   - El contacto NO está descartado/rechazado.
//   - Score compuesto:
//       signal de la respuesta (interested=50, callback=35, objection_timing=20)
//       + fit_score del contacto × 4 (0-40 pts)
//       + bonus por tener phone (5)
//       + bonus por estar en Lemlist (5)
//       + bonus por estar en HubSpot (5)

type CallSlim = {
  id: string;
  contact_id: string | null;
  call_timestamp: string | null;
  customer_response_category: string | null;
  customer_response_summary: string | null;
  recommended_next_step: string | null;
  owner_name: string | null;
  hubspot_owner_id: string | null;
};

type ContactSlim = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  fit_score: number | null;
  fit_action: string | null;
  status: string | null;
  human_decision: string | null;
  lemlist_pushed_at: string | null;
  hubspot_contact_id: string | null;
  company: { id: string; company_name: string; company_size: number | null; company_type: string | null } | null;
};

const POSITIVE_CATEGORIES = ["interested", "callback_requested", "objection_timing"] as const;

function signalFromCategory(cat: string | null): number {
  switch (cat) {
    case "interested":
      return 50;
    case "callback_requested":
      return 35;
    case "objection_timing":
      return 20;
    case "objection_price":
      return 10;
    default:
      return 0;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range") ?? "this_month";
  const owner = url.searchParams.get("owner");
  const key: RangeKey = isValidRangeKey(rangeParam) ? rangeParam : "this_month";
  const range = resolveRange(key);

  const db = supabaseAdmin();

  // 1. Calls positivas en el rango con contact_id no nulo
  let q = db
    .from("calls")
    .select(
      "id, contact_id, call_timestamp, customer_response_category, " +
        "customer_response_summary, recommended_next_step, owner_name, hubspot_owner_id"
    )
    .in("customer_response_category", POSITIVE_CATEGORIES as unknown as string[])
    .not("contact_id", "is", null)
    .gte("call_timestamp", range.start.toISOString())
    .lte("call_timestamp", range.end.toISOString())
    .order("call_timestamp", { ascending: false, nullsFirst: false })
    .limit(500);
  if (owner) q = q.eq("hubspot_owner_id", owner);

  const { data: callsRaw, error: callsErr } = await q;
  if (callsErr) return NextResponse.json({ error: callsErr.message }, { status: 500 });
  const calls = (callsRaw ?? []) as unknown as CallSlim[];

  // 2. Quedarse con la call más reciente por contacto
  const latestByContact = new Map<string, CallSlim>();
  for (const c of calls) {
    if (!c.contact_id) continue;
    if (!latestByContact.has(c.contact_id)) {
      latestByContact.set(c.contact_id, c);
    }
  }
  if (latestByContact.size === 0) {
    return NextResponse.json({ leads: [] });
  }

  // 3. Traer info de los contactos
  const contactIds = Array.from(latestByContact.keys());
  const { data: contactsRaw, error: cErr } = await db
    .from("contacts")
    .select(
      "id, first_name, last_name, job_title, linkedin_url, email, phone, fit_score, " +
        "fit_action, status, human_decision, lemlist_pushed_at, hubspot_contact_id, " +
        "company:companies(id, company_name, company_size, company_type)"
    )
    .in("id", contactIds);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  const contacts = (contactsRaw ?? []) as unknown as ContactSlim[];

  const leads = contacts
    .filter((c) => c.status !== "discarded" && c.human_decision !== "rejected")
    .map((c) => {
      const call = latestByContact.get(c.id)!;
      const signal = signalFromCategory(call.customer_response_category);
      const fitPts = c.fit_score != null ? Math.min(Math.max(c.fit_score, 0), 10) * 4 : 0;
      const phoneBonus = c.phone ? 5 : 0;
      const lemlistBonus = c.lemlist_pushed_at ? 5 : 0;
      const hsBonus = c.hubspot_contact_id ? 5 : 0;
      const score = signal + fitPts + phoneBonus + lemlistBonus + hsBonus;
      return {
        contact_id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        full_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
        job_title: c.job_title,
        linkedin_url: c.linkedin_url,
        email: c.email,
        phone: c.phone,
        fit_score: c.fit_score,
        fit_action: c.fit_action,
        lemlist_pushed: !!c.lemlist_pushed_at,
        hubspot_pushed: !!c.hubspot_contact_id,
        company: c.company,
        last_call: {
          id: call.id,
          timestamp: call.call_timestamp,
          category: call.customer_response_category,
          summary: call.customer_response_summary,
          next_step: call.recommended_next_step,
          owner_name: call.owner_name
        },
        score
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  return NextResponse.json({ leads });
}
