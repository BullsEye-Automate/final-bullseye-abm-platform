// Cálculo del engagement score (0-100) de un contacto basado en sus
// interacciones con campañas (lemlist_activities) + llamadas (calls).
//
// Se recalcula al vuelo cada vez que el contacto se sincroniza a HubSpot
// (lib/hubspotPush.ts incluye este score como wecad_engagement_score).
//
// La fórmula está documentada en la descripción de la propiedad en
// hubspotProperties.ts. Cualquier cambio acá hay que reflejarlo allá.

import type { SupabaseClient } from "@supabase/supabase-js";

export type EngagementResult = {
  score: number; // 0-100
  last_activity_at: string | null;
  breakdown: {
    email: number;
    linkedin: number;
    calls: number;
    recency_boost: number;
  };
};

// Por categoría de interacción, puntos + cap por categoría.
const EMAIL_CAP = 50;
const LINKEDIN_CAP = 50;
const CALLS_CAP = 50;
const RECENCY_BOOST = 10;
const RECENCY_DAYS = 7;

const EMAIL_POINTS: Record<string, number> = {
  emailssent: 1,
  emailsopened: 5,
  emailsclicked: 15,
  // Resto de variantes que Lemlist puede mandar.
  emailclicked: 15
};
const EMAIL_REPLY_POINTS = 25; // por respuesta (type='repliedTo' channel='email')

const LINKEDIN_POINTS: Record<string, number> = {
  linkedininvite: 1,
  linkedinsend: 1,
  linkedinvisit: 1
};
const LINKEDIN_ACCEPTED_POINTS = 15;
const LINKEDIN_REPLY_POINTS = 30;

const CALL_POINTS: Record<string, number> = {
  interested: 50,
  callback_requested: 40,
  objection_timing: 25,
  objection_price: 15,
  objection_no_need: 5,
  objection_existing_solution: 5,
  objection_authority: 5,
  voicemail: 3,
  gatekeeper: 3,
  no_engagement: 1,
  not_interested: 0,
  wrong_number: 0,
  other: 0
};

function normalizeType(t: string | null | undefined): string {
  return (t ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

export async function computeEngagementScore(
  db: SupabaseClient,
  contactId: string
): Promise<EngagementResult> {
  const [actsRes, callsRes] = await Promise.all([
    db
      .from("lemlist_activities")
      .select("type, channel, activity_at, reply_category, reply_triage")
      .eq("contact_id", contactId)
      .order("activity_at", { ascending: false })
      .limit(500),
    db
      .from("calls")
      .select("customer_response_category, call_timestamp")
      .eq("contact_id", contactId)
      .order("call_timestamp", { ascending: false })
      .limit(100)
  ]);

  const activities = (actsRes.data ?? []) as Array<{
    type: string | null;
    channel: string | null;
    activity_at: string | null;
    reply_category: string | null;
    reply_triage: string | null;
  }>;
  const calls = (callsRes.data ?? []) as Array<{
    customer_response_category: string | null;
    call_timestamp: string | null;
  }>;

  let email = 0;
  let linkedin = 0;
  let callsScore = 0;
  let lastActivityAt: string | null = null;

  // Email: stack cada open/click/reply hasta el cap.
  let emailOpens = 0;
  let emailClicks = 0;
  let emailReplies = 0;
  let linkedinReplies = 0;
  let linkedinAccepted = false;

  for (const a of activities) {
    const t = normalizeType(a.type);
    const isReply = t === "repliedto";
    const ch = (a.channel ?? "").toLowerCase();

    if (a.activity_at) {
      if (!lastActivityAt || a.activity_at > lastActivityAt) {
        lastActivityAt = a.activity_at;
      }
    }

    if (isReply) {
      if (ch === "email") emailReplies++;
      else if (ch === "linkedin") linkedinReplies++;
      continue;
    }

    if (t === "invitationaccepted" || t === "linkedininviteaccepted") {
      linkedinAccepted = true;
      continue;
    }

    if (ch === "email") {
      const pts = EMAIL_POINTS[t];
      if (typeof pts === "number") {
        if (t.includes("opened")) emailOpens++;
        else if (t.includes("clicked")) emailClicks++;
        else email += pts;
      }
    } else if (ch === "linkedin") {
      const pts = LINKEDIN_POINTS[t];
      if (typeof pts === "number") linkedin += pts;
    }
  }

  // Aplicar caps por sub-categoría de email/linkedin replies.
  email += Math.min(15, emailOpens * 5); // max 15 por opens
  email += Math.min(30, emailClicks * 15); // max 30 por clicks
  email += Math.min(50, emailReplies * EMAIL_REPLY_POINTS); // max 50 por replies
  email = Math.min(EMAIL_CAP, email);

  if (linkedinAccepted) linkedin += LINKEDIN_ACCEPTED_POINTS;
  linkedin += Math.min(60, linkedinReplies * LINKEDIN_REPLY_POINTS);
  linkedin = Math.min(LINKEDIN_CAP, linkedin);

  for (const c of calls) {
    const cat = (c.customer_response_category ?? "").toLowerCase().replace(/[\s_-]/g, "");
    // Buscar coincidencia con keys del map (sin guiones/espacios).
    for (const [key, pts] of Object.entries(CALL_POINTS)) {
      if (cat === key.replace(/_/g, "")) {
        callsScore = Math.max(callsScore, pts); // mejor call gana, no acumula
        break;
      }
    }
    if (c.call_timestamp) {
      if (!lastActivityAt || c.call_timestamp > lastActivityAt) {
        lastActivityAt = c.call_timestamp;
      }
    }
  }
  callsScore = Math.min(CALLS_CAP, callsScore);

  let recencyBoost = 0;
  if (lastActivityAt) {
    const diffMs = Date.now() - new Date(lastActivityAt).getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays <= RECENCY_DAYS) recencyBoost = RECENCY_BOOST;
  }

  const total = Math.min(100, email + linkedin + callsScore + recencyBoost);

  return {
    score: Math.round(total),
    last_activity_at: lastActivityAt,
    breakdown: {
      email,
      linkedin,
      calls: callsScore,
      recency_boost: recencyBoost
    }
  };
}
