import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mapa de UUIDs de disposition de HubSpot a etiquetas en español
const DISPOSITION_MAP: Record<string, string> = {
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "Conectado",
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Mensaje en vivo",
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "Buzón de voz",
  "b2cf5968-33bf-4679-a702-c29ab3c3d270": "Sin respuesta",
  "73a0d17f-1163-4015-bdd5-ec830791da20": "Número incorrecto",
  "17b47fee-58de-441e-a44c-463173ac8a57": "No califica",
};

// Elimina tags HTML y decodifica entidades básicas
function stripHtml(str: string): string {
  return str
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// Extrae el nombre del contacto del título de HubSpot ("Call with [nombre]")
function extractContactName(title: string): string {
  if (title.startsWith("Call with ")) {
    return title.replace(/^Call with /, "").trim();
  }
  return title.trim();
}

export async function POST(req: NextRequest) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "HUBSPOT_ACCESS_TOKEN no configurado" },
      { status: 500 }
    );
  }

  let body: { client_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Body opcional
  }

  // 1. Obtener llamadas de HubSpot
  const callsUrl = new URL("https://api.hubapi.com/crm/v3/objects/calls");
  callsUrl.searchParams.set(
    "properties",
    "hs_call_title,hs_call_body,hs_call_direction,hs_call_duration,hs_call_disposition,hs_timestamp,hs_call_status,hubspot_owner_id"
  );
  callsUrl.searchParams.set("limit", "100");
  callsUrl.searchParams.set("sort", "-hs_timestamp");

  const callsRes = await fetch(callsUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!callsRes.ok) {
    const text = await callsRes.text().catch(() => "");
    return NextResponse.json(
      { error: `HubSpot respondió ${callsRes.status}: ${text.slice(0, 300)}` },
      { status: callsRes.status }
    );
  }

  const callsData = await callsRes.json();
  const rawCalls: Array<{ id: string; properties: Record<string, string> }> =
    callsData.results ?? [];

  // 2. Obtener owners de HubSpot para mapear IDs a nombres
  const ownersUrl = new URL("https://api.hubapi.com/crm/v3/owners");
  ownersUrl.searchParams.set("limit", "100");
  ownersUrl.searchParams.set("archived", "false");

  const ownersRes = await fetch(ownersUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const ownerMap: Record<string, string> = {};
  if (ownersRes.ok) {
    const ownersData = await ownersRes.json();
    for (const owner of ownersData.results ?? []) {
      const fullName = [owner.firstName, owner.lastName]
        .filter(Boolean)
        .join(" ");
      ownerMap[String(owner.id)] = fullName || owner.email || String(owner.id);
    }
  }

  // 3. Procesar y hacer upsert de cada llamada
  const db = supabaseAdmin();
  let synced = 0;

  for (const raw of rawCalls) {
    const p = raw.properties;

    const title = p.hs_call_title ?? "";
    const bodyRaw = p.hs_call_body ?? "";
    const bodyClean = stripHtml(bodyRaw);
    const contactName = extractContactName(title);
    const durationMs = parseInt(p.hs_call_duration ?? "0", 10) || 0;
    const dispositionKey = p.hs_call_disposition ?? "";
    const dispositionLabel = DISPOSITION_MAP[dispositionKey] ?? dispositionKey;
    const ownerId = p.hubspot_owner_id ?? "";
    const sdrName = ownerId ? (ownerMap[ownerId] ?? ownerId) : null;

    // Timestamp: HubSpot puede enviar milisegundos en hs_timestamp
    let calledAt: string | null = null;
    if (p.hs_timestamp) {
      const tsNum = parseInt(p.hs_timestamp, 10);
      calledAt = isNaN(tsNum)
        ? p.hs_timestamp
        : new Date(tsNum).toISOString();
    }

    const record = {
      hubspot_call_id: raw.id,
      client_id: body.client_id ?? null,
      contact_name: contactName || null,
      company_name: null, // HubSpot no expone la empresa en el call object directamente
      direction: p.hs_call_direction === "INBOUND" ? "INBOUND" : "OUTBOUND",
      duration_ms: durationMs,
      disposition: dispositionKey || null,
      disposition_label: dispositionLabel || null,
      notes_raw: bodyRaw || null,
      notes_clean: bodyClean || null,
      called_at: calledAt,
      hubspot_owner_id: ownerId || null,
      sdr_name: sdrName,
    };

    const { error } = await db
      .from("calls")
      .upsert(record, { onConflict: "hubspot_call_id" });

    if (!error) synced++;
  }

  return NextResponse.json({ synced, total: rawCalls.length });
}
