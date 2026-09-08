-- Peitho — Fase F: categorías en la Base de conocimiento (Módulo 3).
-- Antes de esto, todos los documentos de un cliente vivían en una sola
-- lista sin categorizar. Categorías fijas (no una tabla aparte — son las
-- mismas para todos los clientes, definidas por el usuario con una captura
-- de referencia: "Empresa" → Propuesta de valor / ICP y perfiles, "Ventas" →
-- Presentaciones / Casos de éxito / Manejo de objeciones, "Multimedia" →
-- Videos comerciales / Imágenes-Logos). Null = documento subido antes de
-- este cambio (o sin categorizar a propósito) — se muestra agrupado como
-- "Sin categorizar" dentro de "Todo el material".
alter table knowledge_base_documents
  add column if not exists category text
  check (category is null or category in (
    'propuesta_valor',
    'icp_perfiles',
    'presentaciones',
    'casos_exito',
    'manejo_objeciones',
    'videos_comerciales',
    'imagenes_logos'
  ));
