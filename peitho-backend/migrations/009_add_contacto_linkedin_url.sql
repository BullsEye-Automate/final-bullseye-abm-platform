-- Peitho — permite pegar a mano la URL de LinkedIn del contacto cuando el
-- research no logra encontrar el perfil por búsqueda (ej. nombres homónimos).

alter table meetings
  add column if not exists contacto_linkedin_url text;
