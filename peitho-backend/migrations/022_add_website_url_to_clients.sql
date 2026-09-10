-- URL del sitio web del cliente — pedido explícito del usuario (10-09-2026):
-- se usa para traer contenido real de la empresa (a qué se dedica, ICP,
-- diferenciadores) y sumarlo a la base de conocimiento, igual que un
-- documento subido a mano (ver fetchAndStoreWebsiteContent en
-- knowledgeBase.ts) — así el research pre-reunión y el análisis post-reunión
-- lo usan automático, sin cambios en esos prompts.
alter table clients add column if not exists website_url text;
