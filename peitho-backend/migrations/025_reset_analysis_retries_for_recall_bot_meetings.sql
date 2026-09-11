-- Reset puntual de analysis_retries (11-09-2026) — 3 reuniones reales
-- reportadas por el usuario seguían pegadas en status='captured' pese al fix
-- de la migración 024. Causa: la primera versión de retryStuckAnalyses (ver
-- postMeetingAnalysis.ts, ahora movida a routes/webhooks.ts) llamaba directo
-- a analyzeMeetingAudio(), que depende de audio_path — un archivo en el disco
-- LOCAL de Railway (uploads/), borrado en cada redeploy. Esas 3 reuniones ya
-- habían agotado su tope de 3 reintentos con un camino que nunca iba a
-- funcionar para ellas, así que quedaban excluidas para siempre por la
-- condición `analysis_retries < 3`, aunque el fix ya estuviera desplegado.
-- retryStuckAnalyses ahora usa processRecallDone (re-descarga fresca desde
-- Recall) para toda reunión con recall_bot_id — este reset les da una
-- oportunidad real de reintentar con el camino correcto.
update meetings
set analysis_retries = 0, updated_at = now()
where status = 'captured'
  and recall_bot_id is not null
  and analysis_retries > 0;
