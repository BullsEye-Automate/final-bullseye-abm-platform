import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

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

// Si Clay dice "manual_review" pero el cargo es uno de los decisores fuertes
// (CEO, COO, President, Owner, Director of Operations, Lab Director, etc.) Y
// la empresa ya fue aprobada por el SDR, lo promovemos a "enrich" automático.
// La empresa ya pasó el filtro de fit; un cargo top como CEO/Director de
// Operaciones de un lab/DSO aprobado es decisor por definición. Sin esto,
// Clay deja en revisión manual a decenas de cargos 100% fit porque "el perfil
// no muestra afinidad técnica con CAD/CAM" — pero esa afinidad no se
// requiere a nivel de CEO/Operations.
const STRONG_DECISION_MAKER_PATTERNS: RegExp[] = [
  /\bceo\b/,
  /\bchief executive\b/,
  /\bcoo\b/,
  /\bchief operating\b/,
  /\bchief dental officer\b/,
  /\bchief clinical officer\b/,
  /\bpresident\b/,
  /\bowner\b/,
  /\bfounder\b/,
  /\bmanaging partner\b/,
  /\bgeneral manager\b/,
  /\b(vp|vice president)( of)? operations\b/,
  /\b(director|head) of operations\b/,
  /\boperations director\b/,
  /\bregional (director|manager) of operations\b/,
  /\bregional operations (director|manager)\b/,
  /\bdirector of (laboratory|lab|production)\b/,
  /\b(laboratory|lab) director\b/,
  /\b(production|lab|laboratory) manager\b/,
  /\bpractice owner\b/
];

// Exclusiones: roles que aunque sean senior NO son decisores del flujo CAD/CAM
// (no tienen autoridad sobre outsourcing de diseño). El pre-filter Claude ya
// debería haberlos descartado, pero defensive matching.
const EXCLUDE_PATTERNS = /\b(marketing|finance|financial|cfo|hr|human resources|talent|legal|compliance|software engineer|data|patient services)\b/;

function isStrongDecisionMakerRole(jobTitle: string | null): boolean {
  if (!jobTitle) return false;
  const t = jobTitle.toLowerCase().trim();
  if (!t) return false;
  if (EXCLUDE_PATTERNS.test(t)) return false;
  return STRONG_DECISION_MAKER_PATTERNS.some((r) => r.test(t));
}

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
  // NOTA: ignoramos linkedin_icebreaker, email_subject y email_body de Clay
  // a propósito. La app es la única fuente de verdad para los mensajes IA
  // (controlados por el módulo /entrenar-modelo). Cuando un contacto pasa a
  // enrich, el SDR lo revisa en la app y el push a Lemlist genera los
  // mensajes con la config activa, NO con los que Clay produjo.
  // Históricamente esos campos venían en el webhook; los aceptamos pero no
  // los persistimos, para que cuando se acepte un contacto se regeneren.

  const patch: Record<string, any> = {};
  if (score !== null) patch.fit_score = score;
  if (fit !== null) patch.fit = fit;
  if (reason != null && reason !== "") patch.fit_reason = String(reason);
  if (action !== null) patch.fit_action = action;

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
      .select("id, status, job_title")
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

    // Auto-promote a enrich si Clay dejó en manual_review pero el cargo es
    // decisor fuerte (CEO/COO/President/Owner/Operations leadership). La
    // empresa ya fue aprobada por el SDR — un cargo top no necesita "afinidad
    // CAD" explícita en su LinkedIn para ser fit.
    if (
      norm.patch.fit_action === "manual_review" &&
      isStrongDecisionMakerRole(existing.job_title)
    ) {
      norm.patch.fit_action = "enrich";
      if (norm.patch.fit_reason) {
        norm.patch.fit_reason =
          norm.patch.fit_reason + " · Auto-promovido a enrich por cargo decisor en empresa aprobada.";
      } else {
        norm.patch.fit_reason = "Auto-promovido a enrich por cargo decisor en empresa aprobada.";
      }
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

    // Antes acá hacíamos syncContactToHubSpot cuando fit_action='enrich'
    // porque Clay pusheaba el contacto a Lemlist automáticamente con la
    // columna "Add Lead to Campaign". Ahora ese push lo hace la app
    // cuando el SDR aprueba desde el bucket "Por aprobar" en /contactos.
    // El sync a HubSpot pasa a ser parte de ese flujo (pushApprovedToLemlist
    // ya invoca syncContactToHubSpot). Acá solo persistimos el scoring.
  }

  return NextResponse.json({ ...totals, errors });
}
