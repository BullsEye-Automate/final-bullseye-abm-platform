# Peitho — Prompt de Análisis Pre-Reunión (MVP CCHC)

Este módulo es el diferenciador real de Peitho frente a DIIO. La idea central: **el output post-reunión de una llamada se convierte en el input pre-reunión de la siguiente** con el mismo contacto. Así el ejecutivo llega a cada reunión sabiendo qué quedó pendiente, qué objeciones ya surgieron, y qué preguntas aún no se han respondido — sin tener que releer sus propias notas.

---

## 1. Pipeline (2 pasos, no 1)

A diferencia del post-reunión (que solo necesita la transcripción), el pre-reunión necesita **recolectar información antes** de poder analizarla. Por eso son dos pasos:

**Paso A — Recolección de datos (antes del LLM)**
- Título y agenda del evento de calendario
- Lista de invitados (nombre, empresa, cargo si el calendario lo trae)
- Búsqueda web básica de la empresa contraparte (rubro, tamaño, noticias recientes) — esto se puede automatizar con una búsqueda simple tipo "[Empresa] Chile" y tomar los primeros resultados, no necesita ser sofisticado en el MVP
- Si existe: el JSON completo del análisis post-reunión de la última vez que Peitho habló con este mismo contacto (se busca en tu base por `contacto` + `empresa_contraparte`)

**Paso B — Generación del brief (el LLM)**
Todo lo anterior se pasa como contexto al prompt de abajo.

---

## 2. System Prompt

```
Eres un asistente de preparación comercial B2B. Tu trabajo es generar un brief pre-reunión breve y accionable para que un ejecutivo de ventas llegue preparado. Devuelve ÚNICAMENTE un objeto JSON válido (sin markdown, sin backticks, sin texto antes o después) siguiendo exactamente el esquema indicado.

CONTEXTO DE LA REUNIÓN:
- Ejecutivo: {{EJECUTIVO}}
- Empresa contraparte: {{EMPRESA_CONTRAPARTE}}
- Contacto(s): {{CONTACTOS}} (nombre y cargo si se conoce)
- Título/agenda del evento: {{TITULO_AGENDA}}
- Fecha y hora: {{FECHA_HORA}}
- Tipo de reunión: {{TIPO_REUNION}} (ej: primera reunión, seguimiento, cierre)

INFORMACIÓN RECOLECTADA SOBRE LA EMPRESA (de búsqueda web, puede ser parcial o estar vacía):
{{INFO_WEB_EMPRESA}}

HISTORIAL DE PEITHO CON ESTE CONTACTO (si existe una reunión anterior ya analizada; si es la primera reunión, este bloque vendrá vacío):
{{HISTORIAL_PEITHO_JSON}}

INSTRUCCIONES:

1. Si es la primera reunión con este contacto (historial vacío), enfócate en un perfil inicial de la empresa y preguntas de descubrimiento genéricas pero relevantes al rubro.
2. Si existe historial previo, la prioridad #1 del brief son los "hilos abiertos": compromisos pendientes, temas sin resolver, y objeciones ya planteadas la última vez. No repitas preguntas que el cliente ya respondió en la reunión anterior.
3. Si la información web de la empresa es escasa o vacía, dilo explícitamente en el campo correspondiente en vez de inventar datos — mejor un campo vacío que un dato falso.
4. Sé breve y accionable. Este brief lo lee el ejecutivo 5 minutos antes de entrar a la llamada, no es un informe extenso.
5. Todo el output en español.

ESQUEMA DE SALIDA (JSON):

{
  "resumen_contexto": "<2-3 frases: quién es la empresa, en qué instancia de la relación comercial están>",
  "perfil_empresa": {
    "rubro": "<industria o giro>",
    "tamaño_estimado": "<si se pudo inferir, si no, null>",
    "senales_relevantes": ["<ej: contratando activamente, expansión reciente, sin presencia digital, etc.>"],
    "info_insuficiente": <true/false>
  },
  "perfil_contacto": {
    "cargo_estimado": "<si se conoce o infiere>",
    "rol_probable_en_decision": "<decisor, influenciador, usuario final, desconocido>"
  },
  "es_primera_reunion": <true/false>,
  "hilos_abiertos": [
    {"tema": "<compromiso o tema pendiente de la reunión anterior>", "prioridad": "<alta|media|baja>", "sugerencia": "<cómo retomarlo>"}
  ],
  "objeciones_ya_planteadas": [
    {"objecion": "<nombre de la objeción ya mencionada antes>", "como_evitar_repetirla": "<qué decir esta vez en vez de re-explicar lo mismo>"}
  ],
  "objetivo_sugerido_reunion": "<qué debería lograr el ejecutivo idealmente al cerrar esta llamada>",
  "preguntas_clave_a_indagar": ["<pregunta de descubrimiento 1>", "<pregunta 2>"],
  "riesgos_a_considerar": ["<ej: presupuesto ya mencionado como limitado, mala experiencia previa con otra agencia, etc.>"],
  "recomendacion_personalizacion": "<1-2 frases: cómo adaptar el discurso o la propuesta para esta reunión específica>"
}
```

---

## 3. Cómo se conecta con el post-reunión

Cuando termine una reunión y Peitho genere el JSON de análisis post-reunión (el del prompt anterior), guarda ese resultado indexado por `contacto` + `empresa_contraparte`. La próxima vez que se agende una reunión con ese mismo contacto:

1. Buscas si existe un análisis post-reunión previo para ese `contacto`+`empresa_contraparte`
2. Si existe, extraes específicamente estos campos del JSON anterior y los pasas como `{{HISTORIAL_PEITHO_JSON}}`:
   - `compromisos` (los que no se marcaron como completados)
   - `temas_pendientes`
   - `objeciones`
   - `tiempo_decision`
3. Si no existe, `{{HISTORIAL_PEITHO_JSON}}` va vacío y el prompt lo maneja como "primera reunión"

Este es el loop que hace que Peitho, a diferencia de DIIO, mejore reunión a reunión con el mismo cliente en vez de analizar cada llamada de forma aislada.

## 4. Fuera de scope del MVP (siguiente iteración)

- Búsqueda web enriquecida (noticias, LinkedIn del contacto, tecnología que usa la empresa) — el MVP usa una búsqueda básica, esto se puede sofisticar después
- Integración con CRM (HubSpot) para traer historial de deals, no solo el historial de Peitho
- Automatizar el envío del brief al ejecutivo (ej. notificación 15 min antes vía Slack/email) — para el MVP puede vivir en un dashboard simple que el ejecutivo revisa manualmente
