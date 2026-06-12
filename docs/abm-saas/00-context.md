# BullsEye → ABM SaaS — Contexto Maestro

> **Propósito de este documento:** servir como contexto base para un nuevo Project de Claude (claude.ai/projects) donde diseñaremos y construiremos un SaaS de ABM agnóstico y end-to-end, evolución comercializable de la plataforma interna de BullsEye.

---

## 1. Origen — la plataforma BullsEye

**BullsEye** es una agencia de prospección B2B basada en Chile. Para operar a escala construimos una plataforma interna (Next.js 14 + Supabase + Vercel) que orquesta **todo el pipeline de prospección B2B multi-tenant**:

1. **Discovery de empresas** (Clay + scrapers + IA)
2. **Curación humana** de cuentas (`/empresas`, `/contactos`)
3. **Búsqueda de contactos** con waterfall LeadMagic → PDL → upcell → Clay → Wiza
4. **Pre-filtro IA** (Claude Sonnet) y **lead scoring**
5. **Generación de copy personalizado** por contacto/empresa
6. **Outreach multicanal** vía Lemlist (email + LinkedIn)
7. **Sync HubSpot** (CRM) — propiedades `bullseye_*`
8. **Enrichment de teléfono** (waterfall Clay + Lemlist + Lusha desde `/telefonos`)
9. **Webhooks de calls** y métricas
10. **Multi-tenant**: cada cliente tiene su propio ICP, campañas de Lemlist, tablas Clay y pipeline HubSpot.

### Stack actual
- **Frontend/Backend:** Next.js 14 (App Router), TypeScript
- **DB:** Supabase (PostgreSQL)
- **Deploy:** Vercel
- **UI:** Tailwind + Outfit
- **IA:** Anthropic Claude, Perplexity
- **Integraciones operativas:** Clay, Lemlist, HubSpot, Lusha, LeadMagic, PDL, Wiza, upcell

### Tablas core en Supabase
- `clients`, `client_configs`, `client_ai_context`
- `companies`, `contacts`, `icp_config`
- Webhooks Clay entrantes/salientes con secreto compartido

### Aprendizajes operativos (golden nuggets)
- Clay no expone CRUD REST → usar webhooks entrantes/salientes con `bullseye_company_id` / `bullseye_contact_id` como claves de reconciliación.
- HubSpot properties con prefijo `bullseye_*`.
- Lusha v2: identificadores **mutuamente excluyentes** (linkedinUrl OR email OR firstName+lastName+companies) → cascada.
- Lemlist `/api/campaigns/{id}/leads` solo devuelve `_id, state, contactId` — hay que pedir cada contacto individualmente para obtener `linkedinUrl` y `phone`.
- LinkedIn URLs requieren normalización agresiva (prefijos país `cl./es./mx.`, encoding `%C3%A9` vs `é`).
- El SDR necesita **debug visible en UI** (no en Vercel logs) para diagnosticar enrichment fallido.

---

## 2. Visión del SaaS — qué construimos

**Nombre tentativo:** _por definir (placeholder: **"Apex ABM"** o **"BullsEye Cloud"**)_

### One-liner
> Una plataforma ABM agnóstica que orquesta todo el ciclo de revenue —investigación, prospección, outreach omnicanal, agendamiento, insights y cierre— conectándose a las herramientas que el equipo ya usa, en vez de reemplazarlas.

### Target market
**Mid-market in-house B2B (50–500 empleados)** con equipos comerciales propios haciendo ABM. Equipos que ya pagan Apollo + HubSpot + Outreach pero no logran una **vista de cuenta unificada** ni un workflow ABM real.

### Diferenciales clave
1. **Agnóstico / orquestador** — no reemplaza el stack, lo orquesta. Plugin system para CRMs, sequencers, data providers, schedulers.
2. **ABM verdadero end-to-end** — única plataforma desde research de cuenta hasta cierre, con vista unificada por account.
3. **Validado con clientes reales** — BullsEye ya opera esto internamente con cartera de clientes pagando hoy, lo que permite **piloto pagado desde día 1**.
4. **AI-native** — research de cuenta, copy, scoring y follow-ups con agentes Claude integrados.
5. **LATAM insights** — integración nativa DIIO/Peitho que Apollo/6sense no tienen.

### Modelo de negocio
- **Pricing usage-based por créditos.**
- Créditos consumidos por: enrichment (waterfall), envíos multicanal, ejecuciones IA (research, copy, scoring), llamadas a integraciones premium.
- Plan Free / Starter / Growth / Enterprise por bucket de créditos + seats incluidos.
- Add-ons: integraciones premium (ZoomInfo, DIIO, Peitho), AI tokens extra, soporte.

---

## 3. Decisiones tomadas

| Dimensión          | Decisión                                              |
| ------------------ | ----------------------------------------------------- |
| Mercado            | Mid-market in-house (50–500 empleados)                |
| Build              | Fork de BullsEye + refactor (híbrido core/módulos)  |
| Diferencial        | Agnóstico/orquestador + ABM end-to-end                |
| MVP                | 3 meses, piloto con clientes BullsEye                 |
| Pricing            | Usage-based (créditos)                                |
| Integraciones MVP  | HubSpot + Salesforce + Pipedrive · Lemlist + Outreach + Apollo · Clay + Lusha + Apollo + ZoomInfo · DIIO + Peitho + LinkedIn Sales Nav |
| Módulos MVP        | Los 10 del flujo (shallow but end-to-end)             |

### Tensión a resolver con CTO
> "3 meses + 12 integraciones + 10 módulos" no es realista. **Recomendación**: en MVP, **1 integración por categoría** (HubSpot, Lemlist, Clay, DIIO) + framework de plugins; los demás conectores son fase 2. Módulos: todos presentes pero "shallow" — profundizar en research + SDR workspace + ABM dashboard primero.

---

## 4. Módulos del producto (flujo completo de venta)

| #   | Módulo                              | Responsabilidad                                                                                       |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | **Investigación de cuentas**        | Account research con IA: noticias, señales de intent, tech stack, org chart, ICP fit scoring          |
| 2   | **Prospección**                     | Discovery de empresas + contactos, waterfall de enriquecimiento, validación humana                    |
| 3   | **Go-to-Market**                    | Diseño de campañas ABM por segmento, copy personalizado masivo con IA, plantillas multicanal          |
| 4   | **SDR Workspace**                   | Vista día-a-día del SDR: cola priorizada, scripts contextuales, enrichment on-demand, atajos          |
| 5   | **Interacciones omnicanales**       | Email + LinkedIn + WhatsApp + llamadas, unificadas por contacto/cuenta, con timeline                  |
| 6   | **Agendamiento**                    | Meeting booker (tipo Chili Piper) integrado con calendarios y CRM                                     |
| 7   | **Insights comerciales (LATAM)**    | Integración DIIO/Peitho: licitaciones, noticias financieras, cambios ejecutivos, señales de compra    |
| 8   | **Seguimientos**                    | Task management para SDR/AE, recordatorios IA, próxima mejor acción sugerida                          |
| 9   | **Cierre de negocios**              | Pipeline visual, deal rooms, forecasting, sync con CRM                                                |
| 10  | **ABM Dashboard**                   | Vista unificada por cuenta: engagement score, contactos, interacciones, deals, próximos pasos         |

---

## 5. Arquitectura técnica propuesta

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web App (Next.js 14)                     │
│  Modules: Research · Prospect · GTM · SDR · ABM Dashboard ...   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                    Orchestration Layer (API)                    │
│  Workflows · Credit metering · AI agents · Event bus            │
└──┬───────────┬───────────┬───────────┬────────────┬─────────────┘
   │           │           │           │            │
┌──▼──┐   ┌────▼────┐  ┌───▼────┐  ┌───▼────┐  ┌────▼─────┐
│ CRM │   │Sequencer│  │  Data  │  │Insights│  │   AI     │
│ Adp │   │  Adp    │  │ Adp    │  │  Adp   │  │ (Claude) │
│     │   │         │  │        │  │        │  │          │
│HSpot│   │ Lemlist │  │ Clay   │  │ DIIO   │  │ Research │
│SFDC │   │ Outrch  │  │ Lusha  │  │ Peitho │  │ Copy     │
│Pipdr│   │ Apollo  │  │ Apollo │  │ News   │  │ Scoring  │
└─────┘   └─────────┘  │ ZoomIn │  └────────┘  └──────────┘
                       └────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│         Supabase (Postgres) · Multi-tenant · RLS                │
│  accounts · contacts · interactions · campaigns · credits · ... │
└─────────────────────────────────────────────────────────────────┘
```

### Principios
- **Adapter pattern** por categoría (CRM, Sequencer, Data, Insights) — agnóstico.
- **Multi-tenant nativo** con RLS en Postgres (heredado y robustecido de BullsEye).
- **Event-driven**: cada interacción/enrichment emite evento → alimenta ABM score y timeline unificado.
- **Credit ledger** transversal: cada acción medible debita créditos del tenant.
- **AI agents** desacoplados como workers (research agent, copy agent, scoring agent, follow-up agent).

---

## 6. Activos reutilizables de BullsEye

- ✅ Auth + multi-tenant (`clients`, `client_configs`)
- ✅ Modelo de datos `companies` / `contacts` / `icp_config`
- ✅ Adaptadores Clay (webhooks in/out con secret)
- ✅ Adaptador HubSpot (props `bullseye_*`)
- ✅ Adaptador Lemlist (incluye API key por cliente + fallback)
- ✅ Adaptador Lusha (cascada linkedinUrl → email → name+company)
- ✅ Waterfall de teléfono (Clay + Lemlist + Lusha)
- ✅ Generación de copy con Claude
- ✅ Normalización de LinkedIn URLs
- ✅ Webhooks de HubSpot calls
- ✅ UI base (Tailwind + Outfit, branding sidebar #251762 / #62E0D8)

---

## 7. Validación comercial — por qué esto no es vaporware

- **BullsEye opera hoy** la versión interna con clientes pagando.
- **3–5 clientes BullsEye** podrían ser pilotos del SaaS en mes 1.
- **Casos de uso reales documentados**: discovery → enrichment → outreach → meeting booking → close.
- **Métricas reales** de costos por contacto (waterfall ~17.5 créditos Clay) y conversión.
- **Feedback loop directo** con SDRs operando la herramienta diariamente.

---

## 8. Próximos pasos

1. Validar este contexto con CTO candidato.
2. Diseñar contratos de adaptadores (interfaces TS) por categoría.
3. Definir esquema de credit ledger y pricing concreto.
4. Roadmap detallado MVP-3-meses con priorización módulo×profundidad.
5. Setup del nuevo repo (fork + sanitización + multi-tenant hardening).
6. Diseño UX con foco en SDR workspace y ABM dashboard.
