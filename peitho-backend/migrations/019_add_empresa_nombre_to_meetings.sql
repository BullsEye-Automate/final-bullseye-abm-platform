-- Nombre real de la empresa según el excel de metas (ej. "CodersLab"), a
-- diferencia de empresa_contraparte (el dominio derivado del calendario/email,
-- ej. "coderslab.io" — se sigue usando para el matching y como base de la URL
-- del link, pero no es un nombre presentable). Null si la reunión no hizo
-- match en el excel todavía.
alter table meetings add column if not exists empresa_nombre text;
