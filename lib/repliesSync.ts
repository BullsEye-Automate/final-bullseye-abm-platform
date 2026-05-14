// Sync de respuestas (replies) para el módulo /respuestas. Sprint 6 fase 2.
//
// Trabaja sobre lemlist_activities: las actividades de tipo reply ya quedan
// ahí cuando se sincroniza la campaña (lib/lemlistActivities.ts). Acá:
//   1) Extraemos el texto de la respuesta del payload crudo (raw) — Lemlist
//      lo mete en campos distintos según el canal, así que probamos varios.
//   2) Clasificamos con Claude las que tienen texto y no fueron analizadas.
//
// Idempotente: el texto se extrae una vez, el análisis corre solo si
// reply_analyzed_at está null.

import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeReply } from "./replyAnalyzer";

// Cap de análisis por run para no pasarnos del maxDuration del endpoint.
// Re-correr el sync levanta los que queden pendientes.
const MAX_ANALYZE_PER_RUN = 60;

export function isReplyType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("replied") || t.includes("answer") || t.includes("reply");
}

// Lemlist mete el cuerpo de la respuesta en campos distintos según el canal
// y la versión de la API. Probamos una lista de paths conocidos.
function extractReplyText(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, any>;
  const candidates: unknown[] = [
    obj.text,
    obj.body,
    obj.content,
    obj.message,
    obj.reply,
    obj.replyText,
    obj.messageText,
    obj.answer,
    obj.comment,
    obj.snippet,
    obj.emailReply,
    obj.email?.text,
    obj.email?.body,
    obj.email?.content,
    obj.message?.text,
    obj.message?.body,
    obj.reply?.text,
    obj.reply?.body,
    obj.data?.text,
    obj.data?.body,
    obj.data?.message
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

export type RepliesSyncResult = {
  ok: boolean;
  reply_activities: number; // filas de reply encontradas en lemlist_activities
  text_extracted: number; // a las que les pudimos sacar el texto
  analyzed: number; // clasificadas con Claude en este run
  errors: number;
  sample_errors: string[];
  error?: string;
};

type ReplyRow = {
  id: string;
  contact_id: string | null;
  channel: string | null;
  type: string;
  activity_at: string | null;
  raw: unknown;
  reply_text: string | null;
  reply_analyzed_at: string | null;
};

export async function syncReplies(
  db: SupabaseClient,
  opts: { analyze?: boolean; limit?: number } = {}
): Promise<RepliesSyncResult> {
  const analyze = opts.analyze !== false;
  const limit = Math.min(Math.max(opts.limit ?? 300, 1), 1000);

  const res: RepliesSyncResult = {
    ok: true,
    reply_activities: 0,
    text_extracted: 0,
    analyzed: 0,
    errors: 0,
    sample_errors: []
  };
  const pushErr = (m: string) => {
    res.errors += 1;
    if (res.sample_errors.length < 5) res.sample_errors.push(m);
  };

  // 1) Traer las actividades de tipo reply.
  const { data: rows, error } = await db
    .from("lemlist_activities")
    .select("id, contact_id, channel, type, activity_at, raw, reply_text, reply_analyzed_at")
    .or("type.ilike.%replied%,type.ilike.%answer%,type.ilike.%reply%")
    .order("activity_at", { ascending: false })
    .limit(limit);
  if (error) return { ...res, ok: false, error: error.message };

  const replies = ((rows ?? []) as unknown as ReplyRow[]).filter((r) =>
    isReplyType(String(r.type))
  );
  res.reply_activities = replies.length;
  if (replies.length === 0) return res;

  // 2) Extraer texto de las que todavía no lo tienen.
  for (const r of replies) {
    if (!r.reply_text) {
      const extracted = extractReplyText(r.raw);
      if (extracted) {
        const { error: updErr } = await db
          .from("lemlist_activities")
          .update({ reply_text: extracted })
          .eq("id", r.id);
        if (updErr) pushErr(`extract ${r.id}: ${updErr.message}`);
        else r.reply_text = extracted;
      }
    }
    if (r.reply_text) res.text_extracted += 1;
  }

  // 3) Clasificar con Claude las que tienen texto y no fueron analizadas.
  if (analyze) {
    const toAnalyze = replies
      .filter((r) => r.reply_text && !r.reply_analyzed_at)
      .slice(0, MAX_ANALYZE_PER_RUN);

    if (toAnalyze.length > 0) {
      // Join a contactos + empresas para darle contexto a Claude.
      const contactIds = [
        ...new Set(toAnalyze.map((r) => r.contact_id).filter(Boolean))
      ] as string[];
      const contactInfo = new Map<
        string,
        { name: string | null; job_title: string | null; company_id: string | null }
      >();
      const companyName = new Map<string, string>();
      if (contactIds.length > 0) {
        const { data: cs } = await db
          .from("contacts")
          .select("id, first_name, last_name, job_title, company_id")
          .in("id", contactIds);
        for (const c of cs ?? []) {
          contactInfo.set(c.id as string, {
            name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
            job_title: (c.job_title as string) ?? null,
            company_id: (c.company_id as string) ?? null
          });
        }
        const companyIds = [
          ...new Set(
            [...contactInfo.values()].map((v) => v.company_id).filter(Boolean)
          )
        ] as string[];
        if (companyIds.length > 0) {
          const { data: cos } = await db
            .from("companies")
            .select("id, company_name")
            .in("id", companyIds);
          for (const co of cos ?? []) {
            companyName.set(co.id as string, (co.company_name as string) ?? "");
          }
        }
      }

      for (const r of toAnalyze) {
        const info = r.contact_id ? contactInfo.get(r.contact_id) : null;
        try {
          const analysis = await analyzeReply({
            channel: r.channel ?? null,
            reply_text: r.reply_text as string,
            contact_name: info?.name ?? null,
            job_title: info?.job_title ?? null,
            company_name: info?.company_id
              ? companyName.get(info.company_id) ?? null
              : null
          });
          const { error: updErr } = await db
            .from("lemlist_activities")
            .update({
              reply_category: analysis.category,
              reply_sentiment: analysis.sentiment,
              reply_summary: analysis.summary,
              reply_suggested_step: analysis.suggested_next_step,
              reply_analysis_model: analysis.model_used,
              reply_analyzed_at: new Date().toISOString(),
              reply_analysis_error: null
            })
            .eq("id", r.id);
          if (updErr) pushErr(`analyze ${r.id}: ${updErr.message}`);
          else res.analyzed += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "analysis failed";
          await db
            .from("lemlist_activities")
            .update({ reply_analysis_error: msg })
            .eq("id", r.id);
          pushErr(`analyze ${r.id}: ${msg}`);
        }
      }
    }
  }

  return res;
}
