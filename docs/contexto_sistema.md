# weCAD4you — Sistema de Prospección B2B con IA

**Documento de diseño completo · Mayo 2026**

---

## 1. Contexto del negocio

**weCAD4you** es un servicio de outsourcing de diseño CAD/CAM dental. Los clientes son laboratorios dentales que reciben archivos STL de escáneres intraorales y necesitan que alguien diseñe las restauraciones (coronas, puentes, carillas, etc.) en software especializado como exocad o Siemens inLab.

**Propuesta de valor:**

- Turnaround estándar de 24 horas, rush de 6 horas

- Compatibilidad con cualquier escáner intraoral

- 98.9% de diseños sin ajustes

- Más de 14 años de experiencia en flujos digitales dentales

- Permite al laboratorio escalar sin contratar diseñadores propios

**Mercado objetivo:** Laboratorios dentales en EE.UU. y el mundo que ya usan flujos digitales o están en proceso de adoptarlos.

---

## 2. Arquitectura del sistema (visión completa)

El sistema tiene **3 fases principales** y un **dashboard de reportería unificado**.

```

FASE 1: Descubrimiento y aprobación

  → Configurar ICP + buyer persona (entrenable)

  → Claude investiga empresas y detecta señales de fit

  → Revisión humana: aprobar o rechazar (con razón)

  → Clay: buscar todos los contactos de empresas aprobadas

  → Claude: filtrar contactos por score (SIN enriquecer aún)

      - Score 8–10 → enriquecer automáticamente

      - Score 5–7  → revisión manual antes de enriquecer

      - Score 1–4  → descartar (feedback al modelo)

  → Clay: enriquecer SOLO los contactos aprobados

FASE 2: Go-to-Market

  → Claude: generar mensajes hiperpersonalizados (email + LinkedIn)

  → Lemlist: campaña de email con variables personalizadas

  → Lemlist: LinkedIn outreach (invitaciones + mensajes)

FASE 3: SDR y cierre

  → Lemlist → HubSpot: sync de engagement y contactos

  → HubSpot: listas priorizadas para el SDR

  → SDR: llamadas con historial completo de interacciones

  → Aircall/Orum → HubSpot: transcripciones + score de llamada

REPORTERÍA

  → Dashboard unificado: prospección + outreach + SDR + ventas

```

---

## 3. Stack tecnológico recomendado

| Componente | Herramienta | Rol |

|---|---|---|

| App / UI | Next.js + Tailwind | Interfaz de configuración, revisión y dashboard |

| Base de datos | Supabase (PostgreSQL) | Empresas, contactos, feedback, historial |

| Motor IA | Claude API (claude-sonnet-4-20250514) | Recomendaciones, scoring, personalización |

| Búsqueda de señales | Perplexity API + web search | Investigación de empresas con contexto real |

| Hub de contactos | Clay | Búsqueda, scoring IA por fila, enriquecimiento |

| Campañas | Lemlist | Email + LinkedIn outreach en secuencias |

| CRM | HubSpot | SDR, pipeline, historial de contacto |

| Llamadas | Aircall o Orum | Transcripciones + score → HubSpot nativo |

**¿Por qué Clay y no Apollo o Lemlist como hub?**

Clay es superior para este caso porque:

1. Tiene columnas AI nativas (Claude por fila) — ideal para el filtro de buyer persona inteligente

2. Enriquecimiento en cascada (waterfall): usa Apollo + Hunter + Clearbit + otros en secuencia

3. Se integra directamente con Lemlist para empujar contactos a campañas

4. Permite lógica condicional: enriquecer solo si score >= 8, enviar a revisión si score 5–7

---

## 4. ICP y Buyer Persona de weCAD4you

### ICP (Ideal Customer Profile) — perfil de empresa

- **Industria:** Dental laboratory / Dental lab outsourcing

- **Geografía:** EE.UU. principalmente; también Canadá, Europa, LATAM

- **Tamaño:** 3–30 empleados (sweet spot: 5–20)

- **Tecnología:** exocad, Siemens inLab, 3Shape, Dental Wings

- **Escáneres:** iTero, Carestream, Cerec, Medit, y cualquier intraoral

**Señales de fit activas (buscar al investigar la empresa):**

- Publica contenido sobre flujos digitales en LinkedIn o redes

- Está contratando técnicos CAD/CAM (señal de demanda sin capacidad)

- Menciona digitalización dental en su web o perfiles

- Ha comprado escáneres intraorales recientemente

- Reviews de clínicas que hablan de restauraciones digitales

**No es fit si:**

- Son muy pequeños (1–2 técnicos) — no tienen volumen suficiente

- Son muy grandes (50+) — ya tienen equipo CAD interno

- Son puramente analógicos — sin flujos digitales

- Son clínicas dentales (no laboratorios) — buyer journey diferente

### Buyer Persona — perfiles de contacto

**Perfil A — Dueño / Director del laboratorio**

- Títulos típicos: Lab Owner, Lab Director, General Manager

- Motivación: escalar sin contratar, reducir costos fijos, mejorar turnaround

- Autoridad de compra: total

**Perfil B — Jefe técnico / CAD Manager**

- Títulos típicos: CAD/CAM Specialist, Lead Technician, Production Manager, Digital Workflow Manager

- Motivación: quitarse carga de diseño rutinario

- Autoridad de compra: alta influencia

**Perfil C — Técnico senior con autonomía**

- Títulos típicos: Dental Technician, Ceramist (con flujo digital), CAD Technician

- Solo aplica en labs pequeños (< 10 personas)

- Autoridad de compra: influencia directa

**No es fit — descartar siempre:**

- Técnicos junior sin poder de decisión

- Administrativos sin contacto con producción

- Dentistas / higienistas

- Vendedores o reps de equipos dentales

---

## 5. Sistema de scoring de contactos

### Las 4 dimensiones de evaluación

① Rol funcional (0–3): ¿el cargo implica trabajo o decisión sobre diseño CAD/CAM?

② Poder de decisión (0–3): ¿tiene autoridad de compra según tamaño del lab?

③ Afinidad técnica (0–2): ¿menciona tecnología dental digital en su perfil?

④ Señales empresa (0–2): heredado del fit de la empresa aprobada

**Escala total: 0–10**

### Reglas de routing por score

| Score | Acción automática |

|---|---|

| 8–10 | Enriquecer automáticamente → pasa a cola de campaña |

| 5–7 | Espera revisión manual → equipo aprueba o rechaza antes de enriquecer |

| 1–4 | Descartar → razón guardada en base de datos para feedback |

### Por qué enriquecer DESPUÉS del scoring

Con 50 empresas / 40 contactos promedio = 2.000 contactos:

- Sin filtro, enriqueciendo los 2.000: ~$300–800

- Con filtro (25% pasa = 500 fit): ~$75–200

- **Ahorro estimado del filtro IA: 4x en créditos**

---

## 6. Prompt del filtro de scoring en Clay

```

Eres un experto en ventas B2B para weCAD4you, un servicio de 

outsourcing de diseño CAD/CAM dental.

weCAD4you recibe archivos STL de escáneres intraorales y diseña 

restauraciones dentales (coronas, puentes, carillas) en exocad e inLab 

con turnaround de 24h. El cliente ideal es un laboratorio dental que 

ya usa flujos digitales y necesita más capacidad de diseño CAD/CAM.

BUYER PERSONA IDEAL — alguien que:

- Toma decisiones de compra o influye directamente en ellas

- Trabaja con flujos digitales (exocad, inLab, 3Shape, Dental Wings)

- Siente el dolor de no tener suficiente capacidad de diseño CAD/CAM

- Puede ser: dueño del lab, director técnico, jefe de producción, 

  CAD/CAM manager, o técnico senior con autonomía en lab pequeño

NO ES FIT — descartar siempre:

- Técnico junior sin poder de decisión

- Administrativo sin contacto con producción dental

- Clínico (dentista, higienista) — no son el cliente

- Vendedor o representante de equipos dentales

EMPRESA DEL CONTACTO:

- Nombre: {{company_name}}

- Tamaño: {{company_size}} empleados

- Señales de fit de la empresa: {{company_fit_signals}}

DATOS DEL CONTACTO:

- Cargo actual: {{job_title}}

- Headline LinkedIn: {{linkedin_headline}}

- Seniority: {{seniority}}

- Años en el cargo: {{tenure}}

EJEMPLOS HISTÓRICOS DE CORRECCIONES (aprender de estos):

{{historical_feedback}}

Evalúa el fit de este contacto en 4 dimensiones:

① Rol funcional (0–3)

② Poder de decisión (0–3)

③ Afinidad técnica (0–2)

④ Señales empresa (0–2)

Responde SOLO en JSON sin ningún texto adicional:

{

  "score": <número 1-10>,

  "fit": <true si score >= 8, false si score < 5, "maybe" si 5-7>,

  "dimensiones": {

    "rol_funcional": <0-3>,

    "poder_decision": <0-3>,

    "afinidad_tecnica": <0-2>,

    "senales_empresa": <0-2>

  },

  "razon": "<una línea específica explicando el score>",

  "accion": "<'enriquecer' | 'revision_manual' | 'descartar'>"

}

```

---

## 7. Loop de entrenamiento del modelo

### Tabla en Supabase: contact_feedback

```sql

CREATE TABLE contact_feedback (

  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  contact_id    text NOT NULL,

  company_name  text,

  job_title     text,

  linkedin_headline text,

  company_size  text,

  claude_score  integer,

  claude_action text,

  human_action  text,

  human_reason  text,

  created_at    timestamp DEFAULT now()

);

```

### Formato del feedback para el prompt ({{historical_feedback}})

```

Correcciones pasadas — considerar para mejorar precisión:

- "Lab Owner" en empresa de 1 persona → score 8 fue incorrecto, debió ser 4

  Razón equipo: empresa demasiado pequeña para nuestro volumen mínimo

- "Dental Technician" sin mención de exocad → score 6 fue incorrecto, debió ser 2

  Razón equipo: técnico analógico, no usa herramientas digitales

- "Office Manager" en lab de 22 personas → score 3 fue incorrecto, debió ser 7

  Razón equipo: en este lab gestiona todas las compras de software

```

---

## 8. Flujo de revisión manual (score 5–7)

Los contactos en zona media NO se enriquecen automáticamente. En la app aparecen en cola de revisión con:

- Nombre + cargo + empresa

- Score de Claude con desglose por dimensión

- Razón en una línea de Claude

- Headline LinkedIn completo

- Botón "Aprobar y enriquecer" o "Rechazar" (con campo de razón opcional)

---

## 9. Prompts de hiperpersonalización

### Variables que Claude necesita (columnas en Clay)

company_name, company_city, company_country, scanner_technology, cad_software, company_size, fit_signal, contact_first_name, contact_job_title, contact_linkedin_headline

### Prompt para mensaje de LinkedIn (< 300 caracteres)

```

Eres el SDR de weCAD4you. Escribe un mensaje de invitación de LinkedIn 

para conectar con {{contact_first_name}}, {{contact_job_title}} en {{company_name}}.

Señal de fit detectada: {{fit_signal}}

Software que usan: {{cad_software}}

Escáner: {{scanner_technology}}

Reglas:

- MÁXIMO 300 caracteres

- Menciona algo específico de ELLOS

- Termina con pregunta o gancho conversacional

- Tono: colega del sector dental, no vendedor

- Prohibido frases genéricas de outreach

Responde SOLO con el texto del mensaje.

```

### Prompt para primer email de prospección

```

Eres el SDR de weCAD4you. Escribe el primer email de prospección para 

{{contact_first_name}}, {{contact_job_title}} en {{company_name}}.

CONTEXTO:

- Empresa: {{company_name}}, {{company_size}} empleados, {{company_city}}

- Señal de fit: {{fit_signal}}

- Software CAD: {{cad_software}}

- Escáner: {{scanner_technology}}

weCAD4you: outsourcing CAD/CAM dental. STL → diseño en 24h (6h rush).

Compatible con cualquier escáner y software. 98.9% sin ajustes.

ESTRUCTURA:

- Asunto: máximo 7 palabras

- Línea 1: algo específico de ELLOS

- Línea 2: qué hace weCAD4you en una frase

- Línea 3: resultado específico y concreto

- CTA: una pregunta de bajo compromiso

- Sin bullet points, sin negritas

Responde en JSON: { "subject": "...", "body": "..." }

```

---

## 10. Configuración de Lemlist — Secuencia recomendada

Día 1:  LinkedIn — visita al perfil

Día 3:  LinkedIn — invitación a conectar (mensaje generado por Claude)

Día 5:  Email — primer contacto (asunto + body de Claude)

Día 8:  LinkedIn — mensaje directo (SOLO si ya conectaron)

Día 11: Email — follow-up #1 (ángulo diferente)

Día 16: Email — follow-up #2 (case study o prueba social)

Día 21: Email — breakup (cierre de secuencia, puerta abierta)

**Variables que Lemlist recibe desde Clay:**

firstName, lastName, email, phone, companyName, jobTitle, fitSignal, cadSoftware, scannerTech, claudeScore, claudeReason

---

## 11. Integración Lemlist → HubSpot

### Propiedades de contacto a sincronizar

wecad_fit_score, wecad_fit_reason, wecad_cad_software, wecad_scanner,

lemlist_campaign, lemlist_last_email_status, lemlist_linkedin_status

### Eventos de engagement como actividad en HubSpot

Email enviado / abierto / click / respuesta — LinkedIn: conectaron / respondieron

### Listas activas para el SDR

1. 🔥 Prioridad alta — score >= 8 AND (conectaron LinkedIn OR respondieron email)

2. ✉️ Engagados sin responder — abrieron 2+ veces, sin respuesta

3. 🔗 Conectados en LinkedIn — conectaron, no respondieron mensaje

4. 📩 Respondieron negativamente — para nurturing futuro

5. 🆕 Nuevos para llamar — fit alto, campaña terminada, sin engagement

---

## 12. Dashboard de reportería — métricas completas

### Fase 1 — Prospección (Supabase + Clay)

Empresas evaluadas/aprobadas/rechazadas · Tasa de aprobación

Contactos por bucket de score · Contactos enriquecidos · Tasa de éxito

### Fase 2 — Outreach (Lemlist)

Emails enviados · Tasa apertura/click/respuesta

Invitaciones LinkedIn · Tasa aceptación · Mensajes y respuestas

Agrupación IA de principales respuestas

### Fase 3 — SDR (HubSpot + Aircall)

Llamadas realizadas/conectadas · Tasa de conexión

Transcripciones + resumen IA + score de llamada

Reuniones agendadas · Tasa conversión · Nuevos clientes

---

## 13. Guía paso a paso para comenzar

### SEMANA 1 — Configurar herramientas base

Día 1–2: Crear cuentas en Clay (plan pago), Lemlist (con LinkedIn), confirmar HubSpot, obtener API key Claude en console.anthropic.com

Día 3: Configurar tabla "weCAD4you Prospects" en Clay con columnas base y de señales. Conectar integraciones LinkedIn y Lemlist.

Día 4–5: Documentar ICP y buyer personas en Google Sheet temporal usando la sección 4 de este documento.

### SEMANA 2 — Primer test del flujo de scoring

Paso 1: Encontrar 3–5 empresas manualmente en LinkedIn (labs con mención de exocad/inLab) y aprobarlas en Clay con razón de fit.

Paso 2: Usar "Find people at company" en Clay para buscar contactos (~$0.10/empresa).

Paso 3: Crear columna AI en Clay con el prompt de la sección 6. Mapear campos y correr scoring.

Paso 4: Revisar resultados manualmente y ajustar el prompt según la precisión observada.

### SEMANA 3 — Enriquecimiento condicional y mensajes

Paso 1: Configurar waterfall de enriquecimiento en Clay (Apollo → Hunter → Clearbit → Dropcontact) con condición: enriquecer SOLO si score >= 8. Crear vista "Revisión manual" para score 5–7.

Paso 2: Generar primeros mensajes con prompts de la sección 9. Guardar en columnas Clay.

Paso 3: Crear campaña "weCAD4you — Lab Digital Outreach v1" en Lemlist. Secuencia de 7 pasos. Test con 5 contactos reales.

### SEMANA 4 — Conectar HubSpot y lanzar

Paso 1: Conectar Lemlist → HubSpot con propiedades y eventos de la sección 11.

Paso 2: Crear las 5 listas de priorización en HubSpot.

Paso 3: Lanzar campaña piloto con mínimo 20 contactos enriquecidos.

Paso 4: Primer ciclo de feedback — documentar correcciones en contact_feedback para el siguiente batch.

---

## 14. Roadmap de desarrollo de la app

| Sprint | Entregable |

|---|---|

| Sprint 1 | Configuración ICP + recomendación de empresas + revisión humana |

| Sprint 2 | Integración Clay API: búsqueda y scoring automático |

| Sprint 3 | Cola revisión manual score 5–7 + sistema de feedback |

| Sprint 4 | Generador de mensajes + integración Lemlist API |

| Sprint 5 | Dashboard unificado (Supabase + Lemlist + HubSpot) |

---

## 15. Costos estimados

| Acción en Clay | Costo aprox. |

|---|---|

| Buscar personas en empresa | ~$0.10 por empresa |

| Scoring AI (Claude por fila) | ~$0.01–0.02 por contacto |

| Enriquecimiento email waterfall | ~$0.15–0.40 por contacto |

Escenario 50 empresas/mes: ~$160 con filtro vs ~$530 sin filtro. Ahorro 4x.

---

## 16. Consideraciones importantes

**LinkedIn Lemlist:** Máximo 20–30 invitaciones/día y 50–80 mensajes/día para seguridad.

**CAN-SPAM (EE.UU.):** Incluir siempre unsubscribe link en emails.

**GDPR (Europa):** Outreach B2B permitido bajo "legitimate interest" — documentar el proceso.

**Mantenimiento del prompt:** Revisar cada 30 días o después de 200+ evaluaciones para incorporar nuevo feedback.

---

## 17. Glosario

| Término | Definición |

|---|---|

| CAD/CAM dental | Diseño asistido por computadora para restauraciones dentales |

| exocad | Software de diseño dental más usado globalmente — señal de fit fuerte |

| inLab | Software CAD de Dentsply Sirona, muy usado en EE.UU. |

| 3Shape | Software CAD/CAM premium, común en labs grandes |

| Escáner intraoral | Dispositivo que genera archivos STL del diente/boca del paciente |

| STL | Formato 3D que contiene el modelo digital — lo que el lab envía a weCAD4you |

| Turnaround | Tiempo desde que el lab envía el STL hasta recibir el diseño (24h / 6h rush) |

| Waterfall enrichment | Clay prueba proveedor 1 (Apollo), si no encuentra email va al 2 (Hunter), etc. |

| ICP | Ideal Customer Profile — descripción de la empresa perfecta |

| Buyer Persona | El individuo dentro del ICP que toma o influye en la decisión de compra |

---

*Documento creado en sesión de diseño con Claude · weCAD4you · Mayo 2026*

*Actualizar cuando se ajuste ICP, buyer persona, prompts de scoring, o secuencias de campaña.*