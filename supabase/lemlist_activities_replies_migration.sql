-- Sprint 6 fase 2 — Respuestas: anotación de los eventos de reply de Lemlist
--
-- El módulo /respuestas trabaja sobre lemlist_activities (las actividades de
-- tipo reply ya quedan ahí cuando se sincroniza la campaña). Estas columnas
-- guardan, SOLO para las filas de reply, el texto de la respuesta, la
-- clasificación de Claude y el estado de triage del manager.
--
-- Pega esto en el SQL editor de Supabase y ejecuta. Idempotente.

alter table lemlist_activities add column if not exists reply_text            text;
alter table lemlist_activities add column if not exists reply_category        text;   -- IA: interested / meeting_request / referral / objection / not_interested / unsubscribe / auto_reply / question / other
alter table lemlist_activities add column if not exists reply_sentiment       text;   -- IA: positive / neutral / negative
alter table lemlist_activities add column if not exists reply_summary         text;   -- IA: 1 frase en español
alter table lemlist_activities add column if not exists reply_suggested_step  text;   -- IA: próximo paso sugerido
alter table lemlist_activities add column if not exists reply_analyzed_at     timestamptz;
alter table lemlist_activities add column if not exists reply_analysis_model  text;
alter table lemlist_activities add column if not exists reply_analysis_error  text;
alter table lemlist_activities add column if not exists reply_triage          text;   -- humano (override): pending / interested / not_interested / objection / meeting / handled
alter table lemlist_activities add column if not exists reply_handled_at      timestamptz;

-- Índice para listar respuestas rápido (filas con reply_text o tipo reply).
create index if not exists idx_lemlist_activities_reply_at
  on lemlist_activities(activity_at)
  where reply_text is not null;
