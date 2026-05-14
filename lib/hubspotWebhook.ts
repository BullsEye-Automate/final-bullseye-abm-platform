// HubSpot webhook signature verification (v3).
//
// HubSpot firma cada webhook con HMAC-SHA256 sobre la concatenación:
//   sourceString = httpMethod + requestUri + requestBody + timestamp
//
// Donde:
//   - httpMethod: "POST"
//   - requestUri: la URL completa que HubSpot usó para llamar (con esquema y host)
//   - requestBody: body crudo (UTF-8)
//   - timestamp: el valor del header X-HubSpot-Request-Timestamp
//
// La firma viene en el header X-HubSpot-Signature-v3 como base64.
// Validamos también que el timestamp no esté más de 5 minutos en el pasado
// (anti replay).
//
// Ver: https://developers.hubspot.com/docs/api/webhooks/validating-requests

import { createHmac, timingSafeEqual } from "crypto";

const MAX_AGE_MS = 5 * 60 * 1000;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyHubSpotSignatureV3(args: {
  appSecret: string;
  method: string;
  url: string;
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
}): VerifyResult {
  const { appSecret, method, url, rawBody, signature, timestamp } = args;

  if (!signature) return { ok: false, reason: "missing X-HubSpot-Signature-v3 header" };
  if (!timestamp) return { ok: false, reason: "missing X-HubSpot-Request-Timestamp header" };

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "invalid timestamp" };
  const age = Date.now() - tsNum;
  if (age > MAX_AGE_MS) return { ok: false, reason: "timestamp older than 5 minutes" };
  if (age < -MAX_AGE_MS) return { ok: false, reason: "timestamp in the future" };

  const sourceString = method + url + rawBody + timestamp;
  const expected = createHmac("sha256", appSecret).update(sourceString, "utf8").digest("base64");

  // timingSafeEqual requiere buffers del mismo length
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return { ok: false, reason: "signature length mismatch" };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

// Shape de cada evento que HubSpot manda en el body (array).
// Ver: https://developers.hubspot.com/docs/api/webhooks
export type HubSpotWebhookEvent = {
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string; // "call.creation" | "call.propertyChange" | "call.deletion"
  attemptNumber: number;
  objectId: number;
  changeSource?: string;
  changeFlag?: string;
  propertyName?: string;
  propertyValue?: string;
};
