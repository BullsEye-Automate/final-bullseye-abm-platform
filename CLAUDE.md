# weCAD4you — Contexto Maestro para Claude Code

> Este archivo es leído automáticamente por Claude Code en cada sesión.
> Mantenlo actualizado a medida que el proyecto evoluciona.

---

## Quiénes somos

**weCAD4you** (wecad4you.com) es una empresa americana de outsourcing de diseño CAD dental para laboratorios y clínicas en USA, Canadá y Europa. Diseñamos prótesis dentales digitales con una tasa de remake <3% y entrega en 6h (rush) o 24h (estándar). Software principal: **Exocad** (mayoría de casos) + InLab.

El dueño del proyecto **no tiene conocimientos de programación** — explicar conceptos con claridad, justificar decisiones técnicas y recomendar el camino más simple y robusto en cada paso.

---

## Flujo operacional actual

```
Cliente envía caso
      ↓
[⚠ QC ENTRADA — hoy manual, objetivo: automatizar]
      ↓
Asignación a diseñador (por complejidad, producto, software, experiencia, capacidad)
      ↓
Diseño en Exocad / InLab
      ↓
[⚠ QC SALIDA — hoy manual, objetivo: automatizar]
      ↓
Entrega al cliente
```

---

## Plataformas por donde recibimos casos

| Plataforma | Estado API | Notas |
|---|---|---|
| **Vevi Dental** | ✅ Lista | API REST activa. Ver sección de credenciales. |
| **DS Core** (Dentsply Sirona) | 🟡 Requiere registro partner | ~40% de casos. API en open.dscore.com. URGENTE: Connect Case Center cierra 15 mayo 2026. |
| **Medit Link** | 🟡 Requiere registro partner | OpenAPI documentada, OAuth 2.0. |
| **Exocad DentalShare** | ⏳ Fase posterior | Por investigar. |
| **Dropbox** | ✅ Lista | Usamos Dropbox como respaldo de todos los casos. API bien documentada. |

---

## API Vevi Dental

```
Base URL:  https://portal.wecad4you.com/api/services/v1/
Auth:      Header → X-Session-Token: 5Wj5Y850N52n0ekJ0ZdJsfkYZNkUDIoR98QJ-Fnnpbg
Método:    HTTP GET para todos los endpoints
Paginación: parámetro `page` (0,1,2...) — máx 50 items por página, campo `has_more`
Delta sync: parámetro `updated_since` en ISO 8601
```

**Endpoints relevantes:**

| Endpoint | Descripción |
|---|---|
| `/works` | Lista de trabajos/casos |
| `/works/:id` | Detalle completo de un trabajo (productos, trazabilidad, tareas) |
| `/clinics` | Clientes (laboratorios/clínicas) |
| `/products` | Productos configurados |
| `/technicians` | Diseñadores / técnicos |
| `/stages` | Fases del flujo |
| `/tasks` | Tareas realizadas o pendientes |
| `/work_products` | Productos vendidos por trabajo |
| `/delivery_notes` | Albaranes |
| `/invoices` | Facturas |

---

## Stack tecnológico

**Entorno local (Mac):**
- Node.js v20.20
- npm v11.11
- Vercel CLI v53 (ya instalado — deploy con un comando)
- Git v2.39
- VS Code + extensión Claude Code

**Stack del portal (acordado):**
- **Framework:** Next.js 14+ (App Router)
- **Base de datos:** Supabase (PostgreSQL gestionado, gratuito para empezar)
- **ORM:** Prisma
- **Deploy:** Vercel
- **Estilos:** Tailwind CSS
- **Lenguaje:** TypeScript

**Por qué este stack:** Node ya instalado, Vercel ya instalado (deploy = `vercel --prod`), Supabase no requiere instalar nada localmente, Next.js es el estándar actual para portales web con APIs integradas.

---

## Proyectos y estado actual

### PROYECTO 1 — Portal weCAD4you ← ACTIVO

**Objetivo:** Reemplazar Vevi Dental con un portal 100% propio. Columna vertebral del negocio.

**Fases:**

- [x] Arquitectura definida
- [ ] **FASE 1 ← AQUÍ ESTAMOS:** Crear proyecto Next.js + Supabase + sincronizar trabajos desde API Vevi Dental
- [ ] FASE 2: Integrar DS Core + Medit Link
- [ ] FASE 3: Panel interno — vista unificada de todos los casos
- [ ] FASE 4: Sincronización automática con Dropbox (carpeta por caso)
- [ ] FASE 5+: Portal para clientes, pagos, mensajería, asignación de diseñadores, QC integrado

**Referencia competitiva:** Tenemos acceso al portal de **Evident** (competidor directo) — revisar su UX para inspiración al diseñar las vistas del portal.

---

### PROYECTO 2 — Agente QC de Entrada ← PENDIENTE (después de Fase 1)

Automatizar revisión de casos recibidos: calidad de escaneos, archivos STL, checklist de entrada. Documentación de buenos vs malos escaneos disponible para entrenamiento.

---

### PROYECTO 3 — Agente QC de Salida ← PENDIENTE

Revisión automática del diseño terminado: parámetros técnicos, configuración del cliente, fases administrativas completadas.

---

### PROYECTO 4 — Asistente IA de Diseño Dental ← LARGO PLAZO

Copiloto dentro de Exocad para asistir a diseñadores. No reemplaza — potencia. Entrenado con documentación de buenos/malos diseños.

---

## Convenciones del proyecto

- Todo el código en **TypeScript**
- Comentarios en **español**
- Variables y funciones en **inglés** (estándar de código)
- Commits en español, descriptivos
- Nunca hardcodear credenciales — siempre usar `.env.local`
- Siempre explicar qué hace cada bloque de código importante

---

## Estructura de carpetas objetivo (Fase 1)

```
wecad-portal/
├── CLAUDE.md                  ← este archivo
├── .env.local                 ← credenciales (nunca a Git)
├── .gitignore
├── prisma/
│   └── schema.prisma          ← modelos de base de datos
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── sync/
│   │   │       └── vevi/
│   │   │           └── route.ts   ← endpoint que sincroniza con Vevi
│   │   └── dashboard/
│   │       └── page.tsx           ← primera vista de casos
│   ├── lib/
│   │   ├── vevi.ts            ← cliente API Vevi Dental
│   │   ├── supabase.ts        ← cliente Supabase
│   │   └── prisma.ts          ← cliente Prisma
│   └── types/
│       └── vevi.ts            ← tipos TypeScript de la API Vevi
└── package.json
```

---

## Próximo paso inmediato

Ejecutar en orden en la terminal de VS Code:

```bash
# 1. Crear el proyecto Next.js
npx create-next-app@latest wecad-portal --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"

# 2. Entrar al proyecto
cd wecad-portal

# 3. Instalar dependencias del portal
npm install @prisma/client prisma @supabase/supabase-js

# 4. Abrir en VS Code
code .
```

Luego crear cuenta en **supabase.com** (gratuita) y configurar las variables de entorno.
