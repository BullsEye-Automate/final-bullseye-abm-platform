# Diagrama de flujos — ABM SaaS end-to-end

> Renderizan en GitHub, Notion, Obsidian, VS Code (con extensión Mermaid) y en cualquier visor Markdown moderno.

---

## 1. Flujo completo de venta (alto nivel)

```mermaid
flowchart LR
    A[1. Investigación<br/>de cuentas] --> B[2. Prospección<br/>contactos]
    B --> C[3. Go-to-Market<br/>diseño campaña]
    C --> D[4. SDR<br/>Workspace]
    D --> E[5. Interacciones<br/>omnicanales]
    E --> F[6. Agendamiento<br/>reuniones]
    F --> G[7. Insights<br/>DIIO/Peitho]
    G --> H[8. Seguimientos]
    H --> I[9. Cierre<br/>de negocio]
    I --> J[10. ABM<br/>Dashboard]
    J -.feedback.-> A

    style A fill:#251762,color:#fff
    style J fill:#62E0D8,color:#251762
```

---

## 2. Arquitectura técnica detallada

```mermaid
flowchart TB
    subgraph UI["Web App (Next.js 14)"]
        U1[Research Module]
        U2[Prospect Module]
        U3[SDR Workspace]
        U4[ABM Dashboard]
        U5[Admin / Settings]
    end

    subgraph API["Orchestration Layer"]
        O1[Workflow Engine]
        O2[Credit Ledger]
        O3[Event Bus]
        O4[Auth + RLS]
    end

    subgraph AGENTS["AI Agents (Claude)"]
        AG1[Research Agent]
        AG2[Copy Agent]
        AG3[Scoring Agent]
        AG4[Follow-up Agent]
    end

    subgraph ADAPTERS["Integration Adapters"]
        AD1[CRM Adapter<br/>HubSpot · SFDC · Pipedrive]
        AD2[Sequencer Adapter<br/>Lemlist · Outreach · Apollo]
        AD3[Data Adapter<br/>Clay · Lusha · Apollo · ZoomInfo]
        AD4[Insights Adapter<br/>DIIO · Peitho · News]
        AD5[Calendar Adapter<br/>Google · Outlook]
    end

    subgraph DB["Supabase (Postgres + RLS)"]
        D1[(accounts)]
        D2[(contacts)]
        D3[(interactions)]
        D4[(campaigns)]
        D5[(credits_ledger)]
        D6[(tenants)]
    end

    UI --> API
    API --> AGENTS
    API --> ADAPTERS
    API --> DB
    AGENTS --> ADAPTERS
    ADAPTERS -.webhooks.-> O3
    O3 --> DB

    style UI fill:#251762,color:#fff
    style AGENTS fill:#62E0D8,color:#251762
```

---

## 3. Flujo de enriquecimiento de contacto (waterfall)

```mermaid
sequenceDiagram
    participant SDR
    participant App
    participant Ledger as Credit Ledger
    participant Clay
    participant Lemlist
    participant Lusha

    SDR->>App: Buscar teléfono (linkedin_url)
    App->>Ledger: Verificar saldo
    Ledger-->>App: OK
    App->>Clay: POST waterfall (LeadMagic→PDL→upcell→Clay→Wiza)
    Clay-->>App: Webhook async (1-3min)
    alt Clay devuelve teléfono
        App->>Ledger: Debitar créditos Clay
        App-->>SDR: Teléfono ✓
    else Clay no encuentra
        App->>Lemlist: Buscar en campaña existente
        alt Encontrado (gratis)
            App-->>SDR: Teléfono ✓ (cache)
        else No encontrado
            App->>Lusha: Cascada linkedinUrl→email→name+co
            App->>Ledger: Debitar créditos Lusha
            App-->>SDR: Teléfono ✓ o no encontrado
        end
    end
```

---

## 4. Flujo ABM: cuenta → engagement → score

```mermaid
flowchart LR
    subgraph SIGNALS["Señales (Event Bus)"]
        S1[Email opens]
        S2[Link clicks]
        S3[LinkedIn views]
        S4[Replies]
        S5[Meeting booked]
        S6[DIIO: nueva licitación]
        S7[Peitho: cambio ejecutivo]
        S8[News intent]
    end

    SIGNALS --> SC[Scoring Agent<br/>Claude]
    SC --> ACC[(Account<br/>engagement_score)]
    ACC --> DASH[ABM Dashboard<br/>Hot Accounts]
    DASH --> NBA[Next Best Action<br/>Follow-up Agent]
    NBA --> SDR[SDR Workspace<br/>cola priorizada]
```

---

## 5. Multi-tenant + credit ledger

```mermaid
flowchart TB
    T1[Tenant A] -->|RLS| ACC[accounts]
    T2[Tenant B] -->|RLS| ACC
    T3[Tenant C] -->|RLS| ACC

    subgraph CREDITS["Credit metering por acción"]
        C1[Enrichment Clay: 17 cr]
        C2[Enrichment Lusha: 5 cr]
        C3[Email send: 0.1 cr]
        C4[AI research: 50 cr]
        C5[AI copy: 10 cr]
    end

    ACC --> EVT[Event Bus]
    EVT --> LED[(credits_ledger<br/>tenant_id, action, cost, ts)]
    LED --> BIL[Billing<br/>Stripe usage-based]
```

---

## 6. SDR Workspace — diagrama de pantalla (ASCII mock)

```
┌─────────────────────────────────────────────────────────────────┐
│ ABM SaaS · SDR Workspace                    [Saldo: 12,430 cr] │
├──────────────┬──────────────────────────────────────────────────┤
│ Cola del día │  María González · CFO @ Acme Corp                │
│ (priorizada) │  Score: 87 🔥  ·  Última int: hace 3d            │
│              │  ┌────────────────────────────────────────────┐  │
│ 🔥 María G   │  │ Timeline (omni)                            │  │
│ 🔥 Pedro R   │  │  ✉  Open email "Q4 prop"  hace 3d          │  │
│ ⭐ Ana T     │  │  💼 Vio perfil LinkedIn   hace 2d          │  │
│ ⭐ Luis V    │  │  📰 DIIO: nueva licitación pública         │  │
│ · Carla M    │  └────────────────────────────────────────────┘  │
│ · ...        │                                                  │
│              │  Próxima mejor acción (IA):                      │
│              │  → Llamar mencionando licitación DIIO            │
│              │  [Llamar] [Email] [LinkedIn DM] [Snooze]         │
└──────────────┴──────────────────────────────────────────────────┘
```
