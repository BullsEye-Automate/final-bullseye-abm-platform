-- Fase H — bot de Recall.ai que reemplaza a la extensión de Chrome. Guarda el
-- id del bot creado en Recall para esta reunión, para poder correlacionar el
-- webhook de "grabación lista" con la fila correcta de `meetings`.
alter table meetings add column if not exists recall_bot_id text;

create index if not exists idx_meetings_recall_bot_id on meetings (recall_bot_id);
