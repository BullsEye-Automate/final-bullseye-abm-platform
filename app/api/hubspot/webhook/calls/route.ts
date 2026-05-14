// HubSpot CRM webhook receiver — call events.
//
// Setup en HubSpot:
//   1. Settings → Integrations → Private Apps → tu app → tab "Webhooks".
//   2. Target URL: https://wecad-prospecting.vercel.app/api/hubspot/webhook/calls
//   3. Create subscriptions:
//        - "Call created"
//        - "Call property change" con properties:
//            hs_call_body, hs_call_disposition, hs_call_status,
//            hs_call_transcription, hs_call_duration, hs_call_recording_url
//   4. Activar subscriptions.
//
// Variable de entorno requerida: HUBSPOT_APP_SECRET (Client Secret de la
// Private App, visible en tab "Auth"). Sin esto el webhook rechaza todas
// las requests con 401 (anti-spoofing).
//
// Diseño:
//   - HubSpot puede mandar batches de hasta 100 events en un POST.
//   - Mismo call.id puede aparecer múltiples veces (cada property change).
//   - Sacamos los unique objectIds y procesamos en lote (1 batch read).
//   - NO corremos análisis IA acá: queda para "Analizar pendientes"
//     manual desde la UI para controlar costo.
//   - Respondemos 200 OK rápido (HubSpot reintenta si tarda demasiado).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { processCallIds } from "@/lib/callsSync";
import { verifyHubSpotSignatureV3, type HubSpotWebhookEvent } from "@/lib/hubspotWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RELEVANT_TYPES = new Set(["call.creation", "call.propertyChange", "call.deletion"]);

export async function POST(req: NextRequest) {
  const appSecret = process.env.HUBSPOT_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json(
      { error: "HUBSPOT_APP_SECRET not configured" },
      { status: 500 }
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hubspot-signature-v3");
  const timestamp = req.headers.get("x-hubspot-request-timestamp");

  // HubSpot llama por https; reconstruimos la URL canónica. Vercel
  // expone el host real en x-forwarded-host.
  const forwardedHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  const url = `${forwardedProto}://${forwardedHost}${new URL(req.url).pathname}`;

  const verify = verifyHubSpotSignatureV3({
    appSecret,
    method: "POST",
    url,
    rawBody,
    signature,
    timestamp
  });
  if (!verify.ok) {
    return NextResponse.json({ error: `Invalid signature: ${verify.reason}` }, { status: 401 });
  }

  let events: HubSpotWebhookEvent[];
  try {
    const parsed = JSON.parse(rawBody);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const callEvents = events.filter((e) => RELEVANT_TYPES.has(e.subscriptionType));
  const creationEvents = callEvents.filter((e) => e.subscriptionType !== "call.deletion");
  const deletionEvents = callEvents.filter((e) => e.subscriptionType === "call.deletion");

  const uniqueIds = Array.from(new Set(creationEvents.map((e) => String(e.objectId))));

  const db = supabaseAdmin();
  const result: {
    received: number;
    relevant: number;
    upserted: number;
    deleted: number;
    errors: Array<{ stage: string; message: string }>;
  } = {
    received: events.length,
    relevant: callEvents.length,
    upserted: 0,
    deleted: 0,
    errors: []
  };

  if (uniqueIds.length > 0) {
    try {
      const processed = await processCallIds(db, uniqueIds);
      result.upserted = processed.upserted;
      result.errors.push(...processed.errors);
    } catch (err) {
      result.errors.push({
        stage: "process",
        message: err instanceof Error ? err.message : "Unknown error"
      });
    }
  }

  if (deletionEvents.length > 0) {
    const ids = deletionEvents.map((e) => String(e.objectId));
    const { error: delErr, count } = await db
      .from("calls")
      .delete({ count: "exact" })
      .in("hubspot_call_id", ids);
    if (delErr) {
      result.errors.push({ stage: "delete", message: delErr.message });
    } else {
      result.deleted = count ?? 0;
    }
  }

  return NextResponse.json(result, { status: 200 });
}
