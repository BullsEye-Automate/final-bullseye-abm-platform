-- Pedido explícito del usuario (17-11-2026): no hay forma de ver cuánto
-- duró la reunión sin ir a buscarla al dashboard de Recall (y para
-- reuniones capturadas por la extensión de Chrome, ni siquiera eso — Recall
-- nunca estuvo involucrado). Deepgram ya calcula la duración real del audio
-- al transcribir (ver transcribeAudio en postMeetingAnalysis.ts,
-- metadata.duration) — hasta ahora se usaba solo una vez, de paso, para
-- redactar el prompt de análisis, y se descartaba después. Esta columna la
-- persiste para poder mostrarla en la ficha de la reunión.
alter table meetings add column if not exists audio_duration_seconds integer;
