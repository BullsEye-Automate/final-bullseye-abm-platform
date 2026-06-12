# ABM SaaS — Documentos de fundación

Artefactos para evolucionar la plataforma interna **BullsEye** hacia un **SaaS de ABM agnóstico y end-to-end** dirigido a equipos mid-market in-house.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `00-context.md` | **Doc maestro.** Sube a un nuevo Project de claude.ai como contexto base. Resume BullsEye + visión del SaaS + arquitectura + activos reutilizables. |
| `01-project-prompt.md` | **Custom instructions** para pegar en el nuevo Project de Claude. Define rol, decisiones tomadas y estilo de respuesta. |
| `02-flow-diagram.md` | **Diagramas Mermaid** del flujo end-to-end, arquitectura, waterfall de enrichment, ABM scoring y mock del SDR Workspace. |
| `03-cto-deck.md` | **Deck de 12 slides** estructurado para presentar al CTO candidato. Pegar en Google Slides o exportar con Marp/Slidev. |

## Cómo usarlos

### 1. Crear el Project en Claude
1. Ve a claude.ai → New Project → "ABM SaaS".
2. Sube `00-context.md` y `02-flow-diagram.md` como archivos del Project.
3. Copia el contenido de `01-project-prompt.md` (sección "CUSTOM INSTRUCTIONS") a las custom instructions del Project.
4. Empieza la primera conversación con: _"Valida el contexto, refina el roadmap MVP-3-meses y propón las interfaces TypeScript de los adapters."_

### 2. Preparar el deck para el CTO
1. Abre `03-cto-deck.md`.
2. Crea Google Slides nuevo y copia slide por slide (cada `## Slide N` es una diapositiva).
3. Alternativa automática: instala [Marp](https://marp.app/) y ejecuta `marp --pptx 03-cto-deck.md`.
4. Las `> Notas:` van en el panel de notas del orador.

### 3. Iterar
Estos documentos son **vivos**. Cuando tomes decisiones nuevas (nombre, pricing final, primer cliente piloto), actualízalos y re-sube a Claude.

## Decisiones tomadas en esta sesión

- **Mercado:** Mid-market in-house B2B (50–500 empleados)
- **Build:** Fork de BullsEye + refactor
- **Diferenciales:** Agnóstico/orquestador + ABM end-to-end
- **MVP:** 3 meses, piloto con clientes BullsEye
- **Pricing:** Usage-based (créditos)
- **Entregables:** Doc + Mermaid + Deck

## Pendientes a iterar

- [ ] Nombre del producto (placeholder: "Apex ABM" / "BullsEye Cloud")
- [ ] Pricing concreto de créditos por acción
- [ ] Lista priorizada de adapters MVP vs Fase 2
- [ ] Identificación de los 3 clientes piloto en cartera BullsEye
- [ ] Equity y términos para CTO candidato
