import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { syncContactToHubSpot } from "@/lib/hubspotContactSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s: si Clay manda un batch grande, el push a HubSpot por contacto suma.
export const maxDuration = 300;

// Webhook entrante de Clay con el resultado de la columna Lead Scoring AI.
// Acepta single o array. Cada item identifica el contacto por wecad_contact_id
// y trae al menos fit_action. El resto de campos es opcional.
//
// Shape mínimo:
//   { wecad_contact_id, fit_action }
// Shape recomendado:
//   {
//     wecad_contact_id,
//     fit_score, fit, fit_reason, fit_action,
//     linkedin_icebreaker, email_subject, email_body
//   }
//
// Clay serializa los chips con display name (espacios, Title Case). Aceptamos
// keys case-insensitive ignorando espacios/underscores.

type IncomingScore = {
  wecad_contact_id?: string;
  fit_score?: number | string | null;
  fit?: string | boolean | null;
  fit_reason?: string | null;
  fit_action?: string | null;
  linkedin_icebreaker?: string | null;
  email_subject?: string | null;
  email_body?: string | null;
  [key: string]: any;
};

const ACTION_VALUES = new Set(["enrich", "manual_review", "discard"]);

function checkAuth(req: NextRequest): { ok: true } | { ok: false; error: string } {
  const expected = process.env.CLAY_WEBHOOK_SECRET;
  if (!expected) return { ok: true };
  const hdr =
    req.headers.get("x-webhook-secret") ??
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (hdr !== expected) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

function normalizeKey(k: string): string {
  return k.replace(/[\s_]/g, "").toLowerCase();
}

function pickField(obj: Record<string, any>, internalName: string): any {
  const target = normalizeKey(internalName);
  for (const [k, v] of Object.entries(obj)) {
    if (normalizeKey(k) === target) return v;
  }
  return undefined;
}

function parseAction(raw: any): "enrich" | "manual_review" | "discard" | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (s === "enriquecer") return "enrich";
  if (s === "revision_manual" || s === "manualreview" || s === "manual") return "manual_review";
  if (s === "descartar") return "discard";
  if (ACTION_VALUES.has(s)) return s as any;
  return null;
}

function parseFitScore(raw: any): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, Math.min(10, Math.round(n)));
  return null;
}

function parseFit(raw: any): string | null {
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw ? "true" : "false";
  const s = String(raw).trim().toLowerCase();
  return s || null;
}

function statusFor(action: "enrich" | "manual_review" | "discard" | null, current: string): string {
  if (action === "discard") return "discarded";
  return current;
}

function normalizeItem(it: IncomingScore): {
  wecad_contact_id: string;
  patch: Record<string, any>;
} | null {
  const wecadId = (pickField(it, "wecad_contact_id") ?? "").toString().trim();
  if (!wecadId) return null;

  const action = parseAction(pickField(it, "fit_action"));
  const score = parseFitScore(pickField(it, "fit_score"));
  const fit = parseFit(pickField(it, "fit"));
  const reason = pickField(it, "fit_reason");
  const icebreaker = pickField(it, "linkedin_icebreaker");
  const subject = pickField(it, "email_subject");
  const body = pickField(it, "email_body");

  const patch: Record<string, any> = {};
  if (score !== null) patch.fit_score = score;
  if (fit !== null) patch.fit = fit;
  if (reason != null && reason !== "") patch.fit_reason = String(reason);
  if (action !== null) patch.fit_action = action;
  if (icebreaker != null && icebreaker !== "") patch.linkedin_icebreaker = String(icebreaker);
  if (subject != null && subject !== "") patch.email_subject = String(subject);
  if (body != null && body !== "") patch.email_body = String(body);

  return { wecad_contact_id: wecadId, patch };
}

export async function POST(req: NextRequest) {
  const auth = checkAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body == null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items: IncomingScore[] = Array.isArray(body) ? body : [body];
  if (items.length === 0) {
    return NextResponse.json({ error: "No items in payload" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const totals = { received: items.length, updated: 0, skipped: 0, hubspot_synced: 0 };
  const errors: { wecad_contact_id: string; error: string }[] = [];

  for (const it of items) {
    const norm = normalizeItem(it);
    if (!norm) {
      totals.skipped += 1;
      errors.push({ wecad_contact_id: "", error: "Missing wecad_contact_id" });
      continue;
    }
    if (Object.keys(norm.patch).length === 0) {
      totals.skipped += 1;
      continue;
    }

    const { data: existing, error: fetchErr } = await db
      .from("contacts")
      .select("id, status")
      .eq("id", norm.wecad_contact_id)
      .maybeSingle();
    if (fetchErr) {
      errors.push({ wecad_contact_id: norm.wecad_contact_id, error: fetchErr.message });
      continue;
    }
    if (!existing) {
      errors.push({ wecad_contact_id: norm.wecad_contact_id, error: "Contact not found" });
      totals.skipped += 1;
      continue;
    }

    const finalStatus = statusFor(norm.patch.fit_action ?? null, existing.status);
    if (finalStatus !== existing.status) norm.patch.status = finalStatus;

    const { error: updateErr } = await db
      .from("contacts")
      .update(norm.patch)
      .eq("id", norm.wecad_contact_id);
    if (updateErr) {
      errors.push({ wecad_contact_id: norm.wecad_contact_id, error: updateErr.message });
      continue;
    }
    totals.updated += 1;

    // fit_action='enrich' → Clay corre "Add Lead to Campaign" y el contacto
    // entra a la campaña de Lemlist. Regla del producto: a HubSpot van los
    // contactos que entran a campaña, así que lo sincronizamos acá. La app
    // es la fuente de verdad — no dependemos de la integración nativa de
    // Lemlist, que sincroniza de forma poco confiable. Idempotente.
    if (norm.patch.fit_action === "enrich") {
      const hs = await syncContactToHubSpot(db, norm.wecad_contact_id);
      if (hs.ok) {
        totals.hubspot_synced += 1;
      } else {
        errors.push({
          wecad_contact_id: norm.wecad_contact_id,
          error: `HubSpot sync: ${hs.error}`
        });
      }
    }
  }

  return NextResponse.json({ ...totals, errors });
}
