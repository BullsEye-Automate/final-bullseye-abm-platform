// Diagnóstico de campañas de Lemlist. NO toca nada — solo lee.
//
// Disparador: en el bulk-regenerate-messages, getCampaignLeads(LEMLIST_
// CAMPAIGN_ID) devolvió "ok: true, leads: []" (snapshot vacío). Eso causó
// que el DELETE se saltara y todos los ADD fallaran como duplicate, porque
// los leads sí existen en la campaña — solo que el parser no los reconoció.
//
// Este endpoint hace un GET directo a los 2 URL patterns que prueba
// getCampaignLeads (v1 root y v2), captura la respuesta cruda (primeros
// 2000 chars) + headers + status code, y la expone. Con eso vemos qué
// shape devuelve realmente Lemlist y podemos ajustar el parser de
// lib/lemlist.ts (probablemente la key es distinta a "leads"/"data").

import { NextRequest, NextResponse } from "next/server";
import { getLemlistCampaignIds, getPrimaryLemlistCampaignId } from "@/lib/lemlistCampaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LEMLIST_API_BASE = process.env.LEMLIST_API_BASE_URL || "https://api.lemlist.com/api";

function buildAuthHeader(): string {
  const key = process.env.LEMLIST_API_KEY ?? "";
  const token = Buffer.from(`:${key}`).toString("base64");
  return `Basic ${token}`;
}

type Probe = {
  url: string;
  status: number;
  content_type: string | null;
  body_chars: number;
  body_preview: string;
  parsed_shape:
    | { type: "array"; length: number; first_item_keys: string[] }
    | { type: "object"; keys: string[]; array_keys: { key: string; length: number }[] }
    | { type: "other"; description: string }
    | null;
  parse_error: string | null;
};

async function probe(url: string): Promise<Probe> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: buildAuthHeader(), Accept: "application/json" },
      cache: "no-store"
    });
  } catch (err) {
    return {
      url,
      status: 0,
      content_type: null,
      body_chars: 0,
      body_preview: err instanceof Error ? err.message : "network error",
      parsed_shape: null,
      parse_error: "network"
    };
  }
  const text = await res.text();
  const contentType = res.headers.get("content-type");

  let parsedShape: Probe["parsed_shape"] = null;
  let parseError: string | null = null;
  if (text.trim()) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        parsedShape = {
          type: "array",
          length: parsed.length,
          first_item_keys:
            parsed.length > 0 && typeof parsed[0] === "object" && parsed[0]
              ? Object.keys(parsed[0]).slice(0, 30)
              : []
        };
      } else if (typeof parsed === "object" && parsed !== null) {
        const p = parsed as Record<string, unknown>;
        const keys = Object.keys(p);
        const arrayKeys: { key: string; length: number }[] = [];
        for (const k of keys) {
          if (Array.isArray((p as Record<string, unknown>)[k])) {
            arrayKeys.push({
              key: k,
              length: ((p as Record<string, unknown>)[k] as unknown[]).length
            });
          }
        }
        parsedShape = { type: "object", keys, array_keys: arrayKeys };
      } else {
        parsedShape = { type: "other", description: String(parsed).slice(0, 80) };
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : "JSON.parse failed";
    }
  }

  return {
    url,
    status: res.status,
    content_type: contentType,
    body_chars: text.length,
    body_preview: text.slice(0, 2000),
    parsed_shape: parsedShape,
    parse_error: parseError
  };
}

export async function GET(req: NextRequest) {
  // LEMLIST_CAMPAIGN_ID puede ser CSV (varias campañas activas). Si no se
  // pasa explícito por querystring, usamos la primaria (la primera del CSV).
  const explicit = req.nextUrl.searchParams.get("campaign_id");
  const fromEnv = getPrimaryLemlistCampaignId();
  const campaignId = explicit || fromEnv || "";

  if (!campaignId) {
    return NextResponse.json(
      { error: "Falta campaign_id (querystring o LEMLIST_CAMPAIGN_ID env)" },
      { status: 400 }
    );
  }
  if (!process.env.LEMLIST_API_KEY) {
    return NextResponse.json({ error: "LEMLIST_API_KEY no configurado" }, { status: 500 });
  }

  const id = encodeURIComponent(campaignId);
  const LIMIT = 5; // chico — solo para ver el shape

  // Probes a nivel campaña.
  const campaignProbes: Probe[] = await Promise.all([
    probe(`${LEMLIST_API_BASE}/campaigns/${id}/leads?limit=${LIMIT}&offset=0`),
    probe(`${LEMLIST_API_BASE}/v2/campaigns/${id}/leads?limit=${LIMIT}&offset=0`),
    probe(`${LEMLIST_API_BASE}/campaigns/${id}/leads`),
    probe(`${LEMLIST_API_BASE}/v2/campaigns/${id}/export/leads`),
    probe(`${LEMLIST_API_BASE}/campaigns/${id}`)
  ]);

  // Sacamos el primer leadId + contactId del primer probe exitoso con array
  // para hacer probes a nivel lead / contact (donde sospechamos que vive el
  // dato rico: email, linkedinUrl, firstName, etc.).
  let firstLeadId: string | null = null;
  let firstContactId: string | null = null;
  for (const p of campaignProbes) {
    if (!p.parsed_shape || p.parsed_shape.type !== "array") continue;
    if (p.parsed_shape.length === 0) continue;
    try {
      const arr = JSON.parse(p.body_preview);
      if (Array.isArray(arr) && arr.length > 0) {
        const first = arr[0] as Record<string, unknown>;
        firstLeadId =
          (typeof first._id === "string" && first._id) ||
          (typeof first.id === "string" && first.id) ||
          null;
        firstContactId =
          (typeof first.contactId === "string" && first.contactId) || null;
        break;
      }
    } catch {
      // ignore — el body_preview podría estar truncado
    }
  }

  const leadProbes: Probe[] = firstLeadId
    ? await Promise.all([
        probe(`${LEMLIST_API_BASE}/leads/${encodeURIComponent(firstLeadId)}`),
        probe(`${LEMLIST_API_BASE}/v2/leads/${encodeURIComponent(firstLeadId)}`)
      ])
    : [];

  const contactProbes: Probe[] = firstContactId
    ? await Promise.all([
        probe(`${LEMLIST_API_BASE}/contacts/${encodeURIComponent(firstContactId)}`),
        probe(`${LEMLIST_API_BASE}/v2/contacts/${encodeURIComponent(firstContactId)}`),
        probe(`${LEMLIST_API_BASE}/v1/contacts/${encodeURIComponent(firstContactId)}`)
      ])
    : [];

  return NextResponse.json({
    campaign_id: campaignId,
    env_var_used:
      getLemlistCampaignIds().includes(campaignId)
        ? "LEMLIST_CAMPAIGN_ID"
        : campaignId === process.env.LEMLIST_STAGING_CAMPAIGN_ID
        ? "LEMLIST_STAGING_CAMPAIGN_ID"
        : "(custom from querystring)",
    api_base: LEMLIST_API_BASE,
    sampled_lead_id: firstLeadId,
    sampled_contact_id: firstContactId,
    campaign_probes: campaignProbes,
    lead_probes: leadProbes,
    contact_probes: contactProbes
  });
}
