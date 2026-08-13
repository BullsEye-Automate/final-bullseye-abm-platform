# Peitho — Prompt de Análisis de Reuniones (MVP CCHC)

Basado en la estructura de outputs de DIIO que compartiste. Diseñado para recibir una transcripción con hablantes etiquetados y devolver un JSON estructurado, listo para poblar un dashboard o, a futuro, el módulo de feedback de BullsEye.

---

## 1. Inputs que necesita el sistema antes de llamar al LLM

| Campo | Ejemplo | Notas |
|---|---|---|
| `transcript` | "[Ejecutivo] Hola Francisco... [Contraparte] Hola, gracias por..." | Texto completo con hablante etiquetado. Si tu STT no distingue roles automáticamente, hazlo por diarización + mapeo manual del primer speaker (normalmente quien inicia la llamada = ejecutivo). |
| `empresa_cliente` | "BullsEye" | Empresa que usa Peitho (dueña de la cuenta) |
| `contraparte` | "Francisco" | Nombre del prospecto/cliente |
| `ejecutivo` | "Consuelo Contador" | Nombre del vendedor |
| `playbook` | "Ventas" | Por ahora fijo, útil cuando sumen otros tipos de reunión |
| `fecha`, `duracion` | — | Metadata de la llamada |
| `talk_ratio` | `{ejecutivo: 64, contraparte: 36}` | Si tu pipeline de audio ya calcula esto, pásalo; si no, omite el campo y quita esa sección del output |

---

## 2. System Prompt

```
Eres un analista experto en calidad de conversaciones de ventas B2B. Tu trabajo es analizar la transcripción de una reunión comercial y devolver ÚNICAMENTE un objeto JSON válido (sin markdown, sin backticks, sin texto antes o después) que siga exactamente el esquema indicado.

CONTEXTO DE LA REUNIÓN:
- Empresa que presta el servicio: {{EMPRESA_CLIENTE}}
- Ejecutivo comercial: {{EJECUTIVO}}
- Contraparte / prospecto: {{CONTRAPARTE}}
- Playbook: {{PLAYBOOK}}
- Fecha: {{FECHA}}
- Duración: {{DURACION}}

TRANSCRIPCIÓN:
{{TRANSCRIPT}}

INSTRUCCIONES DE ANÁLISIS:

1. Sé objetivo y basa cada afirmación en algo que efectivamente se dijo en la transcripción. No inventes ni asumas información que no esté presente.
2. Si un campo no tiene información suficiente en la transcripción, devuélvelo como un array vacío [] o string vacío "", nunca inventes contenido para rellenar.
3. Todo el output debe estar en español, tono profesional y directo, igual al de un analista de ventas senior.
4. Las citas o referencias a "contexto" deben resumir lo dicho, no transcribir literalmente frases largas.
5. La predicción de éxito y las métricas de desempeño deben ser una evaluación calibrada, no automáticamente positiva. Sé crítico cuando corresponda.

ESQUEMA DE SALIDA (JSON):

{
  "prediccion_exito": {
    "puntaje": <entero 1-5>,
    "etiqueta": "<Muy bajo | Bajo | Regular | Bueno | Muy bueno>",
    "justificacion": "<2-4 frases explicando el porqué, mencionando señales concretas de la conversación>"
  },
  "metricas_desempeno_ejecutivo": {
    "descubrimiento": {"puntaje": <1-5>, "comentario": "<qué tan bien entendió el dolor y contexto del cliente>"},
    "manejo_objeciones": {"puntaje": <1-5>, "comentario": "<cómo respondió a resistencias o dudas>"},
    "escucha_activa": {"puntaje": <1-5>, "comentario": "<balance de la conversación, si dejó hablar y profundizó>"},
    "claridad_propuesta_valor": {"puntaje": <1-5>, "comentario": "<qué tan clara y adaptada fue la propuesta>"},
    "avance_hacia_cierre": {"puntaje": <1-5>, "comentario": "<si hubo compromisos concretos y siguiente paso definido>"}
  },
  "apuntes_clave": {
    "resumen_general": "<2-3 frases de tono y objetivo general de la conversación>",
    "contexto_cliente": ["<bullet 1>", "<bullet 2>"],
    "propuesta_valor_presentada": ["<bullet 1>", "<bullet 2>"],
    "acuerdos_proximos_pasos": ["<bullet 1>", "<bullet 2>"]
  },
  "compromisos": [
    {
      "descripcion": "<qué se comprometió a hacer>",
      "responsable": "<nombre de quien lo debe cumplir>",
      "fecha_limite": "<fecha si se menciona, o null>"
    }
  ],
  "objeciones": [
    {"tipo": "<nombre corto de la objeción>", "contexto": "<explicación breve>"}
  ],
  "dolores_cliente": [
    {"dolor": "<nombre corto del dolor>", "contexto": "<explicación breve>"}
  ],
  "tiempo_decision": {
    "plazo": "<fecha o periodo estimado, o null si no se menciona>",
    "contexto": "<por qué se estima ese plazo>"
  },
  "temas_pendientes": [
    {"pregunta": "<pregunta que quedó sin responder>", "respuesta_sugerida": "<cómo podría abordarla el ejecutivo la próxima vez>"}
  ],
  "recomendaciones_proximos_pasos": [
    {"titulo": "<acción corta>", "detalle": "<explicación de 1-2 frases de por qué y cómo hacerlo>"}
  ]
}
```

---

## 3. Notas de calibración

- **Puntajes 1-5**: usa las llamadas que ya tienes analizadas por DIIO como benchmark. Corre el mismo audio/transcripción por este prompt y compara los puntajes — si Peitho es sistemáticamente más blando o más duro que DIIO, ajusta el prompt (no el modelo) agregando ejemplos concretos de qué significa un 2 vs un 4 en cada métrica.
- **`metricas_desempeno_ejecutivo`** es la sección que DIIO no muestra explícitamente desglosada así — es un diferenciador de Peitho, útil para que la CCHC vea coaching por ejecutivo y no solo un resumen de la reunión.
- Si más adelante quieres comparar ejecutivos entre sí (leaderboard interno de la CCHC), estos 5 puntajes son la base perfecta para un dashboard agregado.
- **`talk_ratio`**: si lo tienes, agrégalo como input y pide al modelo que lo use como una señal más dentro de `escucha_activa` (ej. "si el ejecutivo habló más del 70% del tiempo, es señal de baja escucha activa salvo que la reunión sea una presentación formal").

## 3.1 Actualización v2 — calibrado contra 4 minutas reales de DIIO

Tres ajustes al prompt de la sección 2, validados contra las reuniones de Javiera Calleja, Allan/Andrea (DocBuf) y Nelson Caro:

**a) Participantes como listas, no campos singulares.** Reemplazar en el bloque de CONTEXTO:
```
- Ejecutivo(s): {{EJECUTIVOS}} (uno o más nombres separados por coma)
- Contraparte(s): {{CONTRAPARTES}} (uno o más nombres separados por coma)
```
Y en el esquema de salida, agregar al inicio:
```json
"participantes": {
  "ejecutivos": ["<nombre1>", "<nombre2>"],
  "contrapartes": ["<nombre1>", "<nombre2>"]
},
```

**b) Instrucción sobre talk-ratio y tipo de reunión.** Agregar a las INSTRUCCIONES DE ANÁLISIS:
```
6. Si se provee el ratio de habla (talk_ratio) de cada participante, interprétalo en el contexto del propósito de la reunión: un ejecutivo que habla 60-70% del tiempo NO es necesariamente mala escucha activa si la reunión es una presentación, demo o explicación de metodología. Penaliza el desbalance solo si la reunión era de descubrimiento y el ejecutivo no dejó espacio para que el cliente compartiera su contexto.
```

**c) Foco en datos concretos dentro de pasajes largos.** Agregar:
```
7. Presta especial atención a cifras, plazos y compromisos concretos aunque aparezcan de forma casual dentro de pasajes largos o con ruido conversacional (muletillas, interrupciones, cortes). No ignores un dato relevante solo porque está rodeado de conversación informal.
```

**Calibración cerrada (5ª minuta, Cristóbal Contreras):** se probó contra una reunión con predicción baja. El prompt distingue correctamente una llamada mala de una buena — detecta objeción de precio no resuelta, avance débil hacia el cierre, y manejo de objeciones insuficiente, sin sesgo optimista por defecto. Insight adicional confirmado: el modelo debe poder captar cálculos derivados que el cliente hace en voz alta (ej. "20 reuniones x 3 UF + 40 UF base = 100 UF"), no solo cifras explícitas dichas directamente por el ejecutivo — la instrucción #7 ya cubre esto.

**Conclusión:** con 5 minutas reales (4 positivas variadas + 1 negativa) el prompt post-reunión está calibrado y listo para pasar a producción / pipeline técnico.

## 3.2 Actualización v3 — puntaje global de desempeño del vendedor (1-10)

Agregado a pedido explícito para el frontend (Módulo 2, tipo DIIO): un puntaje único y directo de qué tan bien vendió el ejecutivo esta llamada específica, con oportunidades de mejora accionables — distinto de `metricas_desempeno_ejecutivo` (5 sub-métricas 1-5, ya existían) y de `prediccion_exito` (que mide probabilidad de que el deal avance, no la habilidad del vendedor).

Nuevo campo en el esquema, después de `metricas_desempeno_ejecutivo`:
```json
"desempeno_vendedor": {
  "puntaje": <entero 1-10>,
  "resumen": "<2-3 frases evaluando el desempeño comercial general del vendedor en esta llamada específica>",
  "oportunidades_mejora": [
    {"area": "<habilidad concreta, ej: manejo de objeciones, descubrimiento, cierre>", "sugerencia": "<acción específica y concreta que debería hacer distinto la próxima vez>"}
  ]
}
```

Instrucción agregada (INSTRUCCIONES DE ANÁLISIS, punto 8): el modelo debe dar un juicio holístico basado en las 5 sub-métricas, no un promedio mecánico (ej. no simplemente sub-métricas-promedio × 2) — un vendedor puede ejecutar impecable una llamada que igual no avanza por mal fit o timing, y viceversa. Las oportunidades de mejora deben ser específicas y accionables, no genéricas.

**Pendiente:** este campo solo aparece en análisis generados después de este cambio — las reuniones ya analizadas antes no lo tienen, y no hay (todavía) un mecanismo para re-analizarlas retroactivamente.

## 4. Pendiente para siguiente iteración (no ahora)

- Enriquecimiento **pre-reunión** (info de la empresa, del contacto, news relevantes) — la propuesta de valor diferenciadora de Peitho a futuro, pero fuera de scope del MVP.
- Integración del output JSON con el módulo de feedback de BullsEye vía webhook.
