# Deck para CTO candidato — ABM SaaS

> **Formato:** estructura + contenido listos para pegar en Google Slides. Cada `## Slide N` es una diapositiva. Las notas del orador van en `> Notas:`.
>
> **Conversión a PPTX/Google Slides:** copia cada slide manualmente, o usa Marp/Slidev si prefieres exportación automática (`marp --pptx 03-cto-deck.md`).

---

## Slide 1 — Portada

# **[NOMBRE_TENTATIVO]**
### Una plataforma ABM agnóstica y end-to-end
### Construida sobre 2 años de operación real con clientes pagando

_Pitch a CTO candidato · Junio 2026_

> Notas: abre con energía y con un dato fuerte. "Hoy procesamos X contactos/mes para Y clientes con esta plataforma interna; queremos convertirla en un SaaS."

---

## Slide 2 — El problema

### El stack de revenue mid-market está roto

- Equipos B2B (50–500 empleados) pagan **5–8 herramientas** distintas:
  CRM + sequencer + data + scheduler + intent + scoring + dialer.
- **Ninguna ofrece vista de cuenta unificada** end-to-end.
- ABM "real" hoy = **Excel + reuniones de coordinación**.
- Apollo no es ABM. 6sense/Demandbase cuestan US$100K+/año y son data-only.
- LATAM: **cero plataformas que integren DIIO/Peitho** y entiendan el mercado local.

> Notas: el dolor no es "falta de herramientas", es "falta de orquestación + vista unificada".

---

## Slide 3 — La solución

### Plataforma ABM agnóstica que orquesta el stack que ya tienes

**No reemplaza** Apollo, HubSpot, Lemlist. **Los orquesta.**

Una vista unificada de cuenta + workflows ABM end-to-end:

1. Investigación IA   2. Prospección con waterfall   3. GTM por segmento
4. SDR Workspace      5. Outreach omnicanal           6. Agendamiento
7. Insights LATAM     8. Seguimientos IA              9. Cierre
10. ABM Dashboard

> Notas: enfatiza "agnóstico" — es el diferencial frente a HubSpot Sales Hub o Salesloft que quieren ser silo cerrado.

---

## Slide 4 — Por qué AHORA (y por qué nosotros)

### Validación que la mayoría de startups no tiene

- **BullsEye opera esto hoy** con clientes mid-market pagando.
- **2 años de aprendizaje operativo real** (waterfalls, integraciones rotas, edge cases).
- **3–5 clientes piloto disponibles desde día 1** (cartera actual BullsEye).
- **Equipo SDR usando la herramienta a diario** = feedback loop instantáneo.
- **Mercado LATAM desatendido** + integraciones DIIO/Peitho que nadie tiene.

> Notas: este es el slide que cierra al CTO. "No te vendo una idea, te vendo un producto que ya funciona y queremos llevar a SaaS."

---

## Slide 5 — Diferenciales

| Competidor   | Su modelo                  | Nuestro ángulo                                                |
| ------------ | -------------------------- | ------------------------------------------------------------- |
| Apollo       | All-in-one cerrado         | Orquestamos Apollo en vez de competir con él                  |
| 6sense       | Data + intent caro (US$100K+) | ABM end-to-end usage-based, accesible a mid-market         |
| HubSpot      | CRM + light sequencing     | Capa ABM/SDR sobre HubSpot                                    |
| Salesloft    | Sequencer puro             | Mismo sequencer, + ABM + research IA + insights LATAM         |
| Clay         | Data orchestration         | Workflows revenue completos, no solo enrichment               |

> Notas: el insight clave: **integramos a TODOS los anteriores**. Somos el "Zapier para revenue" + UI propia de ABM.

---

## Slide 6 — Arquitectura

```
Web App (Next.js)
        ↓
Orchestration Layer (workflows · credits · events)
   ↓        ↓         ↓
AI Agents  Adapters  Supabase (multi-tenant, RLS)
(Claude)   - CRM
           - Sequencer
           - Data
           - Insights
```

- **Adapter pattern** por categoría → cualquier herramienta nueva en 1 sprint.
- **Multi-tenant nativo** con Row Level Security (heredado de BullsEye, robustecido).
- **Event-driven** → ABM scoring en tiempo real.
- **Credit ledger** transversal → pricing usage-based fácil.

> Notas: si el CTO es senior, este slide debería excitarlo. Si no le excita, no es el CTO correcto.

---

## Slide 7 — Stack y reutilización

### No empezamos de cero

**Listo para reutilizar de BullsEye:**
- Auth + multi-tenant (`clients`, `client_configs`)
- Adaptadores Clay, HubSpot, Lemlist, Lusha
- Waterfall de teléfono (Clay → Lemlist → Lusha)
- Generación de copy Claude
- UI base (Tailwind + Outfit)

**Construir nuevo:**
- Core orchestration layer
- Credit ledger + billing (Stripe)
- Adapters Salesforce, Pipedrive, Outreach, Apollo, ZoomInfo, DIIO, Peitho
- ABM Dashboard, SDR Workspace pulidos
- Agentes IA desacoplados (research, scoring, follow-up)

> Notas: muestra honestidad. No vendemos magia, vendemos ejecución sobre base probada.

---

## Slide 8 — Modelo de negocio

### Usage-based + seats

| Plan         | Seats incl. | Créditos/mes | Precio |
| ------------ | ----------- | ------------ | ------ |
| Starter      | 2           | 5,000        | US$ 199 |
| Growth       | 5           | 25,000       | US$ 599 |
| Scale        | 15          | 100,000      | US$ 1,499 |
| Enterprise   | Custom      | Custom       | Custom |

**Consumo típico por acción:**
- Enrichment waterfall: 17 cr
- Email enviado: 0.1 cr
- Research IA de cuenta: 50 cr
- Copy IA por contacto: 10 cr

> Notas: cifras tentativas; afinar con CFO. Punto clave: pricing **transparente y escalable** vs los US$100K opacos de 6sense.

---

## Slide 9 — Roadmap MVP (3 meses)

### Decisión crítica a tomar contigo

**Tensión:** 3 meses + 12 integraciones + 10 módulos = irreal.

**Recomendación de arranque:**
- Mes 1: core orchestration + auth + 1 integración por categoría (HubSpot, Lemlist, Clay, DIIO).
- Mes 2: SDR Workspace + ABM Dashboard + Research Agent.
- Mes 3: piloto con 3 clientes BullsEye + iteración + Salesforce adapter.

**Fase 2 (mes 4–6):** Outreach, Apollo, Pipedrive, ZoomInfo, Peitho, módulos profundizados.

> Notas: aquí es donde el CTO opina y aporta. No vengas con respuesta cerrada.

---

## Slide 10 — Riesgos y mitigaciones

| Riesgo                                        | Mitigación                                                   |
| --------------------------------------------- | ------------------------------------------------------------ |
| Mercado mid-market no entiende ABM            | Piloto con clientes BullsEye, casos de éxito documentados    |
| Integraciones rompen (Lusha, Clay, etc.)      | Adapter pattern + monitoring + contratos de SLA              |
| Apollo/HubSpot lanzan algo similar            | Velocidad + LATAM + agnosticismo (ellos nunca lo serán)      |
| Costos IA explotan                            | Credit ledger transversal, caching, modelos haiku para tareas simples |
| Burnout del equipo (10 módulos en 3 meses)    | Re-priorización honesta (slide 9) + scope cuts tempranos     |

> Notas: muestra que pensaste en lo que puede salir mal. CTOs buenos respetan esto.

---

## Slide 11 — Lo que necesitamos del CTO

### Por qué te queremos a bordo

- **Arquitectura escalable**: levantar de "app interna" a SaaS multi-tenant robusto.
- **Liderazgo técnico**: contratar 2–3 ingenieros senior en 6 meses.
- **Decisiones de plataforma**: monorepo vs polyrepo, infra (Vercel vs AWS), observabilidad.
- **Visión long-term**: pasar de orquestador a plataforma de revenue intelligence.

**Lo que ofrecemos:**
- Equity significativo (negociable).
- Producto que ya tiene clientes pagando vía BullsEye = runway real.
- Voz total en arquitectura y stack.
- LATAM-first con ambición global.

> Notas: cierra personal. "Queremos construir esto contigo, no para que ejecutes nuestro plan."

---

## Slide 12 — Próximos pasos

1. **Próxima semana**: deep-dive técnico contigo sobre arquitectura.
2. **Semana 2**: validar roadmap MVP contigo + ajustar scope.
3. **Semana 3**: definición de equity + términos.
4. **Mes 1**: kickoff técnico + setup repo + primeros adapters.
5. **Mes 3**: piloto con clientes BullsEye live.
6. **Mes 6**: producto comercializable + primeros clientes fuera de BullsEye.

# ¿Conversamos?

> Notas: cierra con call-to-action concreto. No "qué te parece", sino "agendemos el deep-dive".
