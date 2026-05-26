import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dispositions de HubSpot calls (UUIDs de sistema — los nombres son los standard)
// En la UI usamos etiquetas legibles; el valor real lo provee HubSpot
const DISPOSITION_LABELS: Record<string, string> = {
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "Conectado",
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Voicemail",
  "73a0d17f-1163-4015-bdd5-ec830791da20": "Sin respuesta",
  "17b47fee-58de-441e-a44c-c6300d46f273": "Número incorrecto"
};

type CallProperties = {
  hs_call_title?: string;
  hs_call_body?: string;
  hs_call_direction?: string;
  hs_call_duration?: string;
  hs_call_disposition?: string;
  hs_timestamp?: string;
  hs_call_status?: string;
};

type HubSpotCall = {
  id: string;
  properties: CallProperties;
  createdAt?: string;
  updatedAt?: string;
};

function formatCall(raw: HubSpotCall) {
  const p = raw.properties;
  const durationMs = parseInt(p.hs_call_duration ?? "0", 10);
  const durationSec = Math.floor(durationMs / 1000);
  return {
    id: raw.id,
    title: p.hs_call_title ?? "(sin título)",
    body: p.hs_call_body ?? "",
    direction: p.hs_call_direction ?? "OUTBOUND",
    duration_seconds: durationSec,
    disposition: p.hs_call_disposition ?? "",
    disposition_label:
      DISPOSITION_LABELS[p.hs_call_disposition ?? ""] ?? p.hs_call_disposition ?? "—",
    status: p.hs_call_status ?? "COMPLETED",
    timestamp: p.hs_timestamp ? new Date(parseInt(p.hs_timestamp, 10)).toISOString() : null,
    created_at: raw.createdAt ?? null
  };
}

export async function GET() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "HUBSPOT_ACCESS_TOKEN no configurado" },
      { status: 500 }
    );
  }

  // Obtener las últimas 50 llamadas ordenadas por fecha descendente
  const url = new URL("https://api.hubapi.com/crm/v3/objects/calls");
  url.searchParams.set(
    "properties",
    "hs_call_title,hs_call_body,hs_call_direction,hs_call_duration,hs_call_disposition,hs_timestamp,hs_call_status"
  );
  url.searchParams.set("limit", "50");
  url.searchParams.set("sort", "-hs_timestamp");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `HubSpot respondió ${res.status}: ${text.slice(0, 300)}` },
      { status: res.status }
    );
  }

  const data = await res.json();
  const calls = (data.results ?? []).map(formatCall);

  return NextResponse.json({ calls });
}

export async function POST(req: NextRequest) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "HUBSPOT_ACCESS_TOKEN no configurado" },
      { status: 500 }
    );
  }

  let body: {
    title: string;
    body: string;
    direction: "INBOUND" | "OUTBOUND";
    duration_seconds: number;
    disposition: string;
    contact_name?: string;
    company_name?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "El campo 'title' es requerido" }, { status: 400 });
  }

  // HubSpot almacena duración en milisegundos
  const durationMs = (body.duration_seconds ?? 0) * 1000;

  const properties: Record<string, string | number> = {
    hs_call_title: body.title,
    hs_call_body: body.body ?? "",
    hs_call_direction: body.direction ?? "OUTBOUND",
    hs_call_duration: durationMs,
    hs_call_disposition: body.disposition ?? "",
    hs_timestamp: Date.now(),
    hs_call_status: "COMPLETED"
  };

  // Agregar nombre de contacto/empresa en el body si se proveen
  if (body.contact_name || body.company_name) {
    const extra = [
      body.contact_name ? `Contacto: ${body.contact_name}` : null,
      body.company_name ? `Empresa: ${body.company_name}` : null
    ]
      .filter(Boolean)
      .join("\n");
    properties.hs_call_body = [body.body, extra].filter(Boolean).join("\n\n---\n");
  }

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `HubSpot respondió ${res.status}: ${text.slice(0, 300)}` },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json({ call: { id: data.id, properties: data.properties } });
}
