-- Fase H — se reemplaza Deepgram (transcripción propia sobre el audio
-- descargado) por el transcript nativo de Recall (recording_config.transcript,
-- provider deepgram_async), que trae el nombre real de cada hablante en vez
-- de la heurística "el primero que habla es el ejecutivo". Se guarda ya
-- armado como texto (mismo formato que antes le pasábamos a Claude), no el
-- JSON crudo de Recall — no hace falta reprocesarlo después.
alter table meetings add column if not exists transcript_text text;
