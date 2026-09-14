-- El correo real del invitado externo se descartaba en favor de su nombre
-- para mostrar ("contraparte" pasó a ser displayName ?? email) — pero eso
-- significa que una vez que Google trae un nombre, ya no queda registrado
-- el correo exacto en ninguna parte. Sirve como identificador para matchear
-- contra la columna "Correo" del excel de metas (ver metasSheet.ts) cuando
-- la fecha registrada ahí quedó desactualizada (ej. tras un reagendamiento)
-- y el nombre de la empresa no tiene ninguna relación de texto con el
-- dominio del contacto — el correo exacto no depende de ninguna de las dos.
alter table meetings add column if not exists contraparte_email text;
