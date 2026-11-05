-- Pedido explícito del usuario (05-11-2026): poder distinguir, dentro de las
-- reuniones que nunca llegaron a analizarse, el caso puntual de "a Recall
-- nunca lo dejaron entrar a la sala de espera/lobby" (sub_code
-- timeout_exceeded_waiting_room) del resto de las causas de "no_show" (el
-- excel de metas dice que se reagendó, Deepgram no detectó ninguna palabra,
-- etc.) — para poder filtrar y ver qué está pasando en cada caso, no solo
-- que "no se realizó".
alter table meetings drop constraint if exists meetings_status_check;
alter table meetings add constraint meetings_status_check
  check (status in ('scheduled', 'captured', 'analyzed', 'no_show', 'bot_no_admitido'));
