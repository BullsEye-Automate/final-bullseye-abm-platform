# weCAD4you — Notas técnicas para Claude Code
*Registro de decisiones de arquitectura y pendientes antes de arrancar a codear*

---

## Decisión de arquitectura — Clay vs Lemlist (Mayo 2026)

**Decisión tomada con prueba real de API:**

Buscamos ROE Dental Laboratory (200+ empleados, presencia digital clara) usando la LinkedIn URL de la empresa:
- **Clay:** 97 contactos encontrados con cargos, ubicación y LinkedIn URL
- **Lemlist People Database:** 0 resultados

Conclusión: Lemlist no tiene cobertura suficiente en el nicho dental. Clay es imprescindible como hub de prospección.

**Stack definitivo:**
- **Clay:** busca contactos por empresa, pre_filter, scoring AI — hub de prospección
- **Lemlist:** enriquecimiento de email + teléfono con sus 7,000 créditos incluidos + ejecución de campaña

**No intentar reemplazar Clay con Lemlist para búsqueda de contactos.**

---

## Sistema validado end-to-end — Mayo 2026

Se probó el flujo completo con Tom Wiand (Owner, Wiand Dental Lab):

| Paso | Resultado |
|---|---|
| pre_filter | YES — owner con autoridad de compra total |
| Lead Scoring | 9/10, fit: true, action: enrich |
| Lead Scoring reason | "Owner and CDT at a 25-person lab actively hiring CAD/CAM Manager and Digital Denture Technician simultaneously, confirming overflow pain" |
| LinkedIn Icebreaker | "Tom, two open CAD roles at once tells me full arch volume is real. We design exocad cases overnight for labs like yours. Worth a quick chat on how we handle overflow?" |
| Email subject | "Wiand's Full Arch Overflow, Without New Hires" |
| Email body | Hiperpersonalizado con job postings, escáneres, exocad, 98.9%, CTA de bajo compromiso |
| Add Lead to Campaign | Contacto llegó a Lemlist correctamente |
| Costo total | 1 crédito Clay |

---

## Estructura de Clay — Workbook: weCAD4you — Prospecting

### Tabla: Companies
Columnas: company_name (Text), company_website (URL), company_city (Text), company_size (Number), company_type (Select: lab/clinic/DSO), cad_software (Text), scanner_technology (Text), fit_signals (Text), fit_score (Select: high/medium/low), approved_by (Text), approved_at (Date), status (Select: pending/approved/rejected), reject_reason (Text), linkedin_url (URL)

### Tabla: Contacts — orden de columnas
```
1.  first_name
2.  last_name
3.  job_title
4.  linkedin_headline
5.  linkedin_url
6.  email
7.  phone
8.  seniority
9.  tenure
10. company_name
11. company_type
12. company_size
13. cad_software
14. scanner_technology
15. fit_signals
16. company_id
17. pre_filter (AI — Claude 4.6 Sonnet — Create or modify content)
18. Lead Scoring (AI — Claude 4.6 Sonnet — Create or modify content — JSON Schema)
19. Lead Scoring score (Number — derivada)
20. Lead Scoring fit (Text — derivada)
21. Lead Scoring reason (Text — derivada)
22. Lead Scoring action (Text — derivada)
23. LinkedIn Icebreaker (AI — Claude 4.6 Sonnet — Create or modify content)
24. Email Personalizer (AI — Claude 4.6 Sonnet — Create or modify content — JSON Schema)
25. email_subject (Text — derivada)
26. email_body (Text — derivada)
27. status (Select: pending/enriched/contacted/replied/discarded)
28. Add Lead to Campaign (Lemlist enrichment)
```

### Columna Add Lead to Campaign — configuración completa
- Cuenta: weCAD4you-lemlist
- Campaign: weCAD4you — Lab Digital Outreach v1
- Email Address → email
- LinkedIn URL → linkedin_url
- First Name → first_name
- Last Name → last_name
- Phone → phone
- Icebreaker → **LinkedIn Icebreaker response** (sub-columna, NO la columna padre)
- Company Name → company_name
- Custom Fields:
  - emailSubject → email_subject
  - emailBody → email_body
  - wecad_fit_score → Lead Scoring score
  - wecad_fit_reason → Lead Scoring reason
  - wecad_fit_action → Lead Scoring action
- Professional enrichment → ON
- Email enrichment → ON
- Email verification → ON
- Phone number enrichment → ON
- Allow duplicates → OFF
- Run condition: Lead Scoring score >= 8

---

## Decisiones de arquitectura importantes

### 1. El pre_filter vive en la app, NO en Clay

**Decisión:** El pre-filtro de contactos lo ejecuta la app directamente via Claude API, antes de insertar el contacto en Clay.

**Por qué:**
- Más barato: la app llama directo a Claude API sin consumir créditos de Clay
- Más control: la app decide qué entra a Clay, Clay solo procesa lo que recibe
- Sin bugs: evita el problema de run conditions con JSON Schema en Clay

**Flujo correcto:**
```
App recibe lista de contactos de Clay (Find people at company)
        ↓
App llama Claude API con prompt pre_filter por cada contacto
        ↓
Solo los YES se insertan en tabla Contacts de Clay
        ↓
Clay corre scoring completo (todos los que entran ya pasaron pre_filter)
        ↓
Score >= 8 → Add Lead to Campaign → Lemlist automático
Score 5-7  → aparecen en cola de revisión manual en la app
Score 1-4  → descartados, razón guardada en Supabase
```

**Prompt del pre_filter:**
```
You are a B2B sales filter for weCAD4you, a dental CAD/CAM 
design outsourcing service.

weCAD4you targets dental laboratories, multi-location dental 
clinics, and DSOs that use digital workflows (exocad, inLab, 
3Shape, Dental Wings). The ideal contact is someone who makes 
purchasing decisions or directly manages production and people 
at a dental lab, clinic, or DSO.

CONTACT:
- Job title: {{job_title}}
- LinkedIn headline: {{linkedin_headline}}
- Company type: {{company_type}}

Answer YES if the contact is clearly a decision maker:
- Lab owner, director, president, or general manager
- Production manager, lab manager, or operations manager
- Digital workflow manager or coordinator
- Office manager or practice manager (often handles purchasing)
- Dentist or doctor who is also an owner, founder, director, 
  or manager of a clinic, DSO, or dental group

Answer NO if the contact is:
- CAD technician, CAD operator, CAD designer, or dental 
  technician (operational role, no purchasing authority, 
  may feel threatened by outsourcing)
- Ceramist, dental assistant, or lab assistant
- Clinical dentist or hygienist with no ownership or 
  management role
- Sales rep, distributor, or equipment vendor
- Software developer, IT staff, or administrative assistant

When in doubt about whether someone has decision power, 
answer YES. It is better to score a borderline contact 
than to miss a potential decision maker.

Respond with a single word only: YES or NO
```

---

### 2. Clay como base de datos de trabajo, Supabase como fuente de verdad

- Clay almacena contactos activos en prospección
- Supabase guarda historial completo: feedback, correcciones, razones de descarte
- La app lee de Supabase para mostrar reportería y alimentar el loop de entrenamiento

---

### 3. Columna pre_filter en Clay es solo referencia visual

La columna `pre_filter` existe para referencia del equipo, pero no tiene lógica de control — esa lógica vive en la app. No agregar run conditions sobre ella en Clay.

---

### 4. Run condition de Lead Scoring en Clay

La columna `Lead Scoring` no tiene run condition — corre para todos los contactos que entran porque la app ya garantizó que pasaron el pre_filter.

La condición `score >= 8` vive en `Add Lead to Campaign` para que Lemlist solo reciba los contactos de score alto.

---

### 5. Búsqueda de contactos por empresa

La app llama a Clay API para buscar personas en cada empresa aprobada. Máximo 15 contactos por empresa.

Keywords de búsqueda (amplio para no perder títulos atípicos):
```
owner, director, manager, president, founder, lab, operations, 
production, workflow, digital, practice
```

---

### 6. Icebreaker — usar sub-columna response, NO la columna padre

**Bug conocido de Clay:** Si en `Add Lead to Campaign` se mapea el campo Icebreaker a la columna `LinkedIn Icebreaker` (columna padre AI), Lemlist recibe `[object Object]`.

**Solución:** Mapear siempre a la sub-columna `LinkedIn Icebreaker response`.

Aplica a cualquier columna AI de tipo "Fields" en Clay — siempre usar la sub-columna derivada, no la columna AI padre.

---

### 7. Email body — no duplicar saludo en Lemlist

El `emailBody` generado por Claude ya incluye "Hi {{firstName}}," al inicio. La plantilla de Lemlist en el paso Email (Día 5) debe contener solo `{{emailBody}}` — sin saludo adicional.

---

### 8. Propiedades de score en Lemlist → HubSpot

Custom fields que Clay envía a Lemlist con cada contacto:
- `wecad_fit_score` → Lead Scoring score (número 1-10)
- `wecad_fit_reason` → Lead Scoring reason (texto explicativo)
- `wecad_fit_action` → Lead Scoring action (enrich/manual_review/discard)

Lemlist los crea automáticamente la primera vez que los recibe. Sincronizan a HubSpot y el SDR puede filtrar por `wecad_fit_score >= 9` para priorizar llamadas.

---

### 9. Enriquecimiento — Lemlist enriquece, no Clay

El enriquecimiento de email y teléfono lo hace Lemlist con sus 7,000 créditos mensuales. Clay solo pasa nombre, cargo y LinkedIn URL.

Costos de créditos Lemlist por contacto:
- Find LinkedIn profile: 1 crédito
- Find verified email: 5 créditos
- Email verification: 1 crédito
- Find phone number: 20 créditos

Con 7,000 créditos mensuales alcanza para ~500 contactos con email + ~200 con teléfono — suficiente para el volumen que permite LinkedIn (~500 invitaciones/mes).

---

### 10. Lemlist — configuración de campaña

Campaña: `weCAD4you — Lab Digital Outreach v1`

Secuencia de 7 pasos:
```
Día 1:  LinkedIn — visita perfil (automático)
Día 3:  LinkedIn — invitación con {{icebreaker}}
Día 5:  Email — {{emailSubject}} / {{emailBody}}
Día 8:  LinkedIn DM — pregunta de fricción (si conectaron)
Día 11: Email — follow-up #1 (free trial)
Día 16: Email — follow-up #2 (prueba social: 1,500 casos/mes)
Día 21: Email — breakup (closing the loop)
```

Settings globales:
- Stop if replied → ON
- Unsubscribe link → ON (CAN-SPAM)
- Daily limit → 50 emails/día, 20 invitaciones LinkedIn/día

Follow-up threading:
- Día 11 → reply to previous (mismo hilo que Día 5)
- Día 16 → nuevo email con asunto propio
- Día 21 → reply to previous (mismo hilo que Día 16)

---

### 11. Límites de LinkedIn y volumen de prospección

| Acción | Límite diario | Límite mensual |
|---|---|---|
| Invitaciones a conectar | 20-25/día | ~500/mes |
| Mensajes directos | 50-80/día | ~1,760/mes |

Con el embudo de conversión real:
- 150-200 empresas investigadas → ~100-140 aprobadas
- 4 contactos promedio → 400-560 contactos encontrados
- Pre_filter descarta ~50% → 200-280 pasan
- Scoring score >= 8 (~60% pasa) → 120-170 contactos
- Enriquecimiento encuentra email (~55-60%) → 66-100 en campaña

El límite de LinkedIn no es la restricción real — se puede escalar sin arriesgarlo.

### 12. HubSpot — la app crea contactos, Lemlist solo sincroniza engagement

**Decisión:** La app crea contactos y empresas en HubSpot directamente via API con todos los datos completos. Lemlist solo sincroniza eventos de engagement.

**Por qué:**
- Los campos de score (wecad_fit_score, wecad_fit_reason, etc.) los conoce la app desde Clay — es más limpio escribirlos directo en HubSpot
- Lemlist no pasa bien los custom fields a nivel de contacto global
- Control total sobre los datos desde el origen

**Flujo correcto:**
```
App crea contacto en HubSpot via API
(con score, fit_reason, cad_software, company_type, etc.)
        ↓
Clay empuja contacto a Lemlist (mismo email)
        ↓
Lemlist lanza campaña y registra engagement
        ↓
Lemlist sincroniza SOLO engagement a HubSpot por email:
emails abiertos, clicks, respuestas, LinkedIn conectado
        ↓
HubSpot encuentra el contacto por email y actualiza actividad
```

**El email es el identificador único** que une HubSpot y Lemlist — no se necesita ID compartido.

**Orden crítico:**
1. App crea contacto en HubSpot primero
2. Clay empuja contacto a Lemlist después
3. Lemlist sincroniza engagement a HubSpot por email

**Configuración en Lemlist:** Desactivar "Create new contacts in HubSpot" en Advanced settings — Lemlist solo actualiza contactos existentes, no crea nuevos.

**En Lemlist → HubSpot sincronizar SOLO:**
- Email enviado / abierto / click / respuesta / bounce
- LinkedIn: invitación enviada / conectaron / respondieron mensaje

---

### 13. Lusha — fallback para teléfonos no encontrados o incorrectos

**Contexto:** Lemlist enriquece teléfonos con sus créditos (20 créditos/contacto). En el sector dental la cobertura es limitada. Cuando el SDR llama y encuentra número incorrecto o sin número, Lusha actúa como último recurso.

**Flujo:**
```
Lemlist enriquece teléfono → llega a HubSpot → SDR llama
        ↓
Número incorrecto o sin número
        ↓
SDR marca el outcome en HubSpot
        ↓
App muestra botón "Buscar con Lusha" en la vista del contacto
        ↓
App llama Lusha API con nombre + empresa + LinkedIn URL
        ↓
Lusha devuelve teléfono verificado
        ↓
App actualiza HubSpot con el nuevo número
        ↓
SDR intenta nuevamente
```

**Implementación:** Botón manual en la app — el SDR lo activa solo cuando lo necesita. No automático para controlar costos de Lusha.

**Sprint recomendado:** Sprint 3 o 4 — parte de la vista de gestión de contactos.

**API de Lusha:**
```
POST https://api.lusha.com/person
{
  "firstName": "...",
  "lastName": "...",
  "company": "...",
  "linkedInUrl": "..."
}
```

---

## Pendientes inmediatos — próxima sesión

### 1. CTD — Custom Tracking Domain
- Configurar registro DNS en wecad4you.com para tracking de aperturas y clicks en Lemlist
- Sin CTD Lemlist usa dominio compartido que daña entregabilidad

### 2. Lemlist → HubSpot
- Conectar integración nativa Lemlist → HubSpot
- Crear propiedades custom en HubSpot:
  - `wecad_fit_score`
  - `wecad_fit_reason`
  - `wecad_fit_action`
  - `lemlist_campaign`
  - `lemlist_last_email_status`
  - `lemlist_linkedin_status`
- Configurar eventos de engagement como actividad en HubSpot (email abierto, click, respuesta, LinkedIn conectado, respondió)
- Crear las 5 listas activas para el SDR:
  1. Prioridad alta — score >= 8 AND (conectaron LinkedIn OR respondieron email)
  2. Engagados sin responder — abrieron 2+ veces, sin respuesta
  3. Conectados en LinkedIn — conectaron, no respondieron mensaje
  4. Respondieron negativamente — para nurturing futuro
  5. Nuevos para llamar — fit alto, campaña terminada, sin engagement

### 3. Diseño y módulos de la app
- Definir el diseño visual y UX de la app antes de pasar a Claude Code
- Definir los módulos exactos que tendrá la app:
  - Panel de recomendación de empresas
  - Cola de aprobación/rechazo de empresas
  - Vista de contactos por empresa con scores
  - Cola de revisión manual (score 5-7)
  - Dashboard de métricas (prospección + outreach + SDR)
  - Loop de feedback y entrenamiento del modelo
- Dejar todo el diseño y flujo de navegación definido antes de construir

---

## Pendientes para cuando terminemos en Claude Code

### Al terminar el Sprint 5 (Dashboard unificado):
**Generar un flujo visual completo del funcionamiento de la app** que muestre:
- Todas las integraciones (Clay, Lemlist, HubSpot, Supabase, Claude API)
- El flujo de datos de principio a fin
- Las decisiones automáticas vs. manuales
- Los loops de feedback y entrenamiento

---

## Stack decidido

| Componente | Herramienta | Estado |
|---|---|---|
| App / UI | Next.js + Tailwind | Por construir |
| Base de datos | Supabase (PostgreSQL) | Por configurar |
| Motor IA | Claude API (claude-sonnet-4-20250514) | API key disponible |
| Hub de contactos | Clay — plan Launch $185/mes | Activo (trial 14 días) |
| Campañas | Lemlist | Activo — campaña configurada |
| CRM | HubSpot | Activo |
| Llamadas | Aircall o Orum | Por decidir |

---

## Roadmap de sprints

| Sprint | Entregable |
|---|---|
| Sprint 1 | Configuración ICP + recomendación de empresas + revisión humana |
| Sprint 2 | Integración Clay API: pre_filter + inserción de contactos + scoring |
| Sprint 3 | Cola revisión manual score 5–7 + sistema de feedback a Supabase |
| Sprint 4 | Generador de mensajes (icebreaker + emailBody) + integración Lemlist API |
| Sprint 5 | Dashboard unificado + flujo visual completo de la app |

---

## APIs que necesita la app

- **Clay API:** `POST /tables/{id}/rows` para insertar empresas y contactos
- **Clay API:** `GET /tables/{id}/rows` para leer scores y estados
- **Clay API:** búsqueda de contactos por empresa via "Find people at company"
- **Clay Webhooks:** para que Clay avise cuando termina el scoring
- **Lemlist API:** `POST /api/database/people` — NO usar para búsqueda en dental (0 resultados en prueba real)
- **Lemlist API:** `POST /campaigns/{id}/leads` para agregar contactos a campaña
- **HubSpot API:** para sync de engagement y listas de SDR
- **Claude API:** para pre_filter, scoring backup, y generación de mensajes

---

*Documento actualizado · weCAD4you · Mayo 2026*
*Actualizar cuando se tomen nuevas decisiones de arquitectura*

---

## Diseño visual de la app — decisiones tomadas

### Estilo general
- **Sidebar:** fondo oscuro `#26215C` (morado corporativo dark) con texto blanco
- **Fondo de contenido:** `#F4F2FB` (gris violáceo suave) — las cards blancas flotan sobre él
- **Cards:** fondo blanco `#fff`, sin sombra, border-radius 10-12px
- **Color primario:** `#3D2878` — botones, acentos, scores
- **Color secundario:** `#7F77DD` — barras, iconos secundarios
- **Logo en sidebar:** "we" blanco + "CAD" en caja blanca sobre fondo oscuro + "4you" blanco

### Logo en sidebar
```html
<span style="color:rgba(255,255,255,.9)">we</span>
<span style="color:#26215C;background:#fff;padding:1px 6px;border-radius:5px">CAD</span>
<span style="color:rgba(255,255,255,.9)">4you</span>
<div style="font-size:10px;color:rgba(255,255,255,.4)">by SOi Digital</div>
```

### Navegación sidebar
Secciones con labels en uppercase + items con iconos Tabler outline. Items activos: `background:rgba(255,255,255,.12); color:#fff`. Items hover: `background:rgba(255,255,255,.07)`.

### Módulos confirmados

| Módulo | Sección | Descripción |
|---|---|---|
| Dashboard | Prospección | KPIs globales + empresas pendientes + revisión manual + pipeline |
| Empresas | Prospección | Cola aprobación/rechazo con señales de fit |
| Contactos | Prospección | Vista completa con scores |
| Revisión manual | Prospección | Contactos score 5-7 pendientes |
| Campañas email | Outreach | Estado de campañas Lemlist |
| LinkedIn | Outreach | Invitaciones, conexiones, mensajes |
| Llamadas | SDR | KPIs + tabla por score + transcripciones + config scoring IA |
| Respuestas | SDR | Respuestas agrupadas por canal |
| Funnel | Ventas | Pipeline HubSpot + etapas + deals activos + velocidad |
| Reportería | Análisis | Métricas completas con filtro de período |
| Entrenar modelo | Análisis | Loop de feedback para mejorar scoring |
| Configuración | Sistema | ICP, prompts, integraciones |

### Filtro de período (presente en Dashboard y Reportería)
```
Hoy / Esta semana / Este mes / Mes pasado /
Este trimestre / Trimestre pasado / Este semestre /
Semestre pasado / Este año / Año pasado
```

### Dashboard — secciones y KPIs

**Prospección:** Empresas aprobadas, Contactos en campaña, Score promedio, En revisión manual

**Email outreach:** Emails enviados, Tasa apertura, Tasa click, Tasa respuesta, Reuniones agendadas

**LinkedIn outreach:** Invitaciones enviadas, Invitaciones aceptadas, Mensajes enviados, Tasa respuesta, Interesados totales

**Llamadas SDR (vía HubSpot):** Llamadas realizadas, Contactos únicos, Tasa de conexión, Duración promedio, Score consultivo IA (barra de progreso)

**Pipeline visual:** Barra horizontal por etapa — Investigadas → Aprobadas → Score ≥8 → Enriquecidos → En campaña

### Módulo SDR — Llamadas
- 4 pestañas: Resumen, Tabla de llamadas, Transcripciones, Config. scoring IA
- KPIs secundarios: Interesados, Reuniones agendadas, Sin respuesta, Número incorrecto (con botón Lusha), Llamadas grabadas
- **Tabla de llamadas:** ordenada por score desc. Columnas: Score, Contacto, Duración, Outcome, Razón del score IA, Áreas de mejora, Preview transcripción
- **Config. scoring IA:** cada criterio tiene slider de peso (0-5 pts) + toggle ON/OFF. Criterios: Detección de dolor, Escucha activa, Manejo de objeciones, Propuesta de valor clara, CTA con próximo paso

### Módulo Funnel — conectado a HubSpot
- KPIs: Pipeline total, Cerrado ganado, Velocidad de ventas, Tasa de cierre, Ticket promedio
- Embudo visual por etapas con barras de conversión
- Tabla de deals activos con etapa, valor y probabilidad
- Métricas de velocidad: días prospecto→cliente, ROI prospección, tiempo en trial, toques hasta respuesta
- Conversión por canal de entrada
- Razones de pérdida de deals

### Paleta de colores para iconos/categorías
```
Purple (brand):  icon-purple → bg:#EEEDFE  color:#3D2878
Green (success): icon-green  → bg:#E1F5EE  color:#0F6E56
Amber (warning): icon-amber  → bg:#FAEEDA  color:#854F0B
Blue (info):     icon-blue   → bg:#E6F1FB  color:#185FA5
Coral (danger):  icon-coral  → bg:#FAECE7  color:#993C1D
```

### Badges de estado en deals
```
Demo:       bg:#EEEDFE  color:#3D2878
Trial:      bg:#E1F5EE  color:#0F6E56
Propuesta:  bg:#FAEEDA  color:#854F0B
Negociación:bg:#FAECE7  color:#993C1D
```

### Badge HubSpot conectado
```html
<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#FF7A59;background:#FFF0EB;padding:4px 9px;border-radius:6px;border:0.5px solid #FFB39E">
  <i class="ti ti-circle-check"></i> HubSpot conectado
</div>
```
