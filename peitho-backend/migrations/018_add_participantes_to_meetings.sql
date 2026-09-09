-- Participantes reales de la llamada, extraídos del transcript de Recall
-- (nombre real por diarización de plataforma, no heurística) — array de
-- {nombre, palabras} ordenado de mayor a menor por cuánto habló cada uno.
-- Null para reuniones sin transcript de Recall (ej. flujo viejo de la
-- extensión de Chrome, que solo tiene "hablante 0/1" de Deepgram, sin
-- nombres reales que listar).
alter table meetings add column if not exists participantes jsonb;
