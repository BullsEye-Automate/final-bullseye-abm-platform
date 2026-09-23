-- Estado "no_show" (23-09-2026, pedido explícito del usuario) — confirmado
-- real viendo la grabación en el dashboard de Recall (reunión de MAX
-- Service/Jenny Contreras): un audio sin ninguna palabra detectable por
-- Deepgram casi siempre es un prospecto que nunca llegó a la cita, no un
-- fallo técnico. Antes esto tiraba error y quedaba pegado en status='captured'
-- reintentando hasta agotar los 3 intentos (ver analyzeMeetingAudio en
-- postMeetingAnalysis.ts), con apariencia de reunión "rota" en vez de dejar
-- claro que no hubo conversación.
alter table meetings drop constraint if exists meetings_status_check;
alter table meetings add constraint meetings_status_check
  check (status in ('scheduled', 'captured', 'analyzed', 'no_show'));
