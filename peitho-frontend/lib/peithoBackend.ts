import { getAccessToken } from "./peithoAuth";

export interface MeetingListItem {
  id: string;
  ejecutivo: string | null;
  contraparte: string | null;
  empresa_contraparte: string | null;
  // Nombre real de la empresa según el excel de metas (ej. "CodersLab") — a
  // diferencia de empresa_contraparte (el dominio, ej. "coderslab.io", que se
  // sigue usando como base del link a su sitio). Null si la reunión no hizo
  // match en el excel todavía.
  empresa_nombre: string | null;
  start_time: string | null;
  status: "scheduled" | "captured" | "analyzed";
  // Fase E — para el filtro de cliente en la vista admin.
  client_id: string | null;
  cliente_bullseye: string | null;
  // Ejecutivo del CLIENTE de BullsEye (ej. CCHC) que toma la reunión — viene
  // de la columna "Sales Manager" del excel de metas. Distinto de `ejecutivo`
  // (reservado para un SDR/ejecutivo de BullsEye): en una reunión de
  // invitación manual al bot no hay ningún BullsEye en la llamada, así que
  // `ejecutivo` queda null y este es el único dato de "quién la toma".
  cliente_sales_manager: string | null;
  // Solo vienen pobladas en scope=upcoming (mini-dashboard de "Reuniones
  // futuras") — el backend las omite en scope=past, quedan undefined ahí.
  pre_brief_status?: PreBriefStatus;
  has_bot?: boolean;
  // Solo vienen pobladas en scope=past (columnas "Desempeño" y "Predicción de
  // éxito" de "Reuniones pasadas") — extraídas del análisis; null si la
  // reunión todavía no tiene análisis. desempeno_vendedor.puntaje es 1-10
  // (habilidad del vendedor); prediccion_exito.puntaje es 1-5 (probabilidad
  // de cierre del deal) — no confundir, son escalas y preguntas distintas.
  puntaje?: number | null;
  prediccion_exito?: number | null;
  // Fit Score (10-09-2026) — igual que puntaje/prediccion_exito, solo vienen
  // pobladas en scope=past, extraídas de analysis.fit_empresa/fit_contacto.
  fit_empresa?: number | null;
  fit_contacto?: number | null;
}

// Forma del JSON que genera el prompt de análisis post-reunión (ver
// peitho-backend/docs/peitho_prompt_analisis_v1.md). Todos los campos son
// opcionales acá porque viene de una columna jsonb sin esquema forzado en la
// base — más vale renderizar de menos que reventar la página si algo falta.
export interface MeetingAnalysis {
  apuntes_clave?: {
    resumen_general?: string;
    contexto_cliente?: string[];
    acuerdos_proximos_pasos?: string[];
    propuesta_valor_presentada?: string[];
  };
  prediccion_exito?: {
    puntaje?: number;
    etiqueta?: string;
    justificacion?: string;
  };
  // Fit Score (10-09-2026) — distinto de prediccion_exito: mide qué tan bien
  // calza el prospecto contra el ICP real del cliente (base de
  // conocimiento), no si el deal va a avanzar. puntaje null (con
  // justificacion explicando por qué) si el cliente no tiene un ICP subido
  // todavía — nunca un número inventado.
  fit_empresa?: {
    puntaje?: number | null;
    justificacion?: string;
  };
  fit_contacto?: {
    puntaje?: number | null;
    justificacion?: string;
  };
  metricas_desempeno_ejecutivo?: Record<string, { puntaje?: number; comentario?: string }>;
  desempeno_vendedor?: {
    puntaje?: number;
    resumen?: string;
    oportunidades_mejora?: Array<{ area?: string; sugerencia?: string }>;
  };
  objeciones?: Array<{ tipo?: string; contexto?: string }>;
  compromisos?: Array<{ descripcion?: string; completado?: boolean }>;
  dolores_cliente?: Array<{ dolor?: string; contexto?: string }>;
  temas_pendientes?: Array<{ pregunta?: string; respuesta_sugerida?: string }>;
  recomendaciones_proximos_pasos?: Array<{ titulo?: string; detalle?: string }>;
  [key: string]: unknown;
}

// Forma del JSON del brief pre-reunión (ver
// peitho-backend/docs/peitho_prompt_pre_reunion_v1.md). Igual de defensivo
// que MeetingAnalysis — viene de una columna jsonb sin esquema forzado.
export interface PreBrief {
  resumen_contexto?: string;
  perfil_empresa?: {
    rubro?: string;
    tamaño_estimado?: string | null;
    senales_relevantes?: string[];
    info_insuficiente?: boolean;
  };
  perfil_contacto?: {
    cargo_estimado?: string;
    rol_probable_en_decision?: string;
  };
  experiencia_contacto?: Array<{ empresa?: string; cargo?: string; periodo?: string | null }>;
  icebreakers_sugeridos?: string[];
  competidores_directos?: Array<{ nombre?: string; comentario?: string }>;
  es_primera_reunion?: boolean;
  hilos_abiertos?: Array<{ tema?: string; prioridad?: string; sugerencia?: string }>;
  objeciones_ya_planteadas?: Array<{ objecion?: string; como_evitar_repetirla?: string }>;
  objetivo_sugerido_reunion?: string;
  preguntas_clave_a_indagar?: string[];
  riesgos_a_considerar?: string[];
  recomendacion_personalizacion?: string;
  // Fase D — solo vienen con contenido si el cliente de BullsEye tiene
  // documentos subidos en la base de conocimiento (ver /base-de-conocimiento).
  temas_recomendados?: string[];
  temas_evitar?: string[];
  casos_exito_sugeridos?: Array<{ caso?: string; por_que_aplica?: string }>;
  [key: string]: unknown;
}

export type PreBriefStatus = "none" | "running" | "done" | "failed";

export interface MeetingDetail extends MeetingListItem {
  analysis: MeetingAnalysis | null;
  pre_brief: PreBrief | null;
  pre_brief_status: PreBriefStatus;
  // Datos confirmados desde el excel de metas (no adivinados por IA) — pueden
  // venir null si todavía no hubo match contra esa planilla.
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  contacto_industria: string | null;
  contacto_linkedin_url: string | null;
  // Transcripción real (Fase H — nombre real de cada hablante vía Recall, o
  // Deepgram como fallback para la extensión de Chrome). Null si la reunión
  // no se ha grabado/analizado todavía.
  transcript_text: string | null;
  // Usado por ReanalyzeButton para detectar cuándo terminó un recálculo
  // manual del análisis — a diferencia de ReprocessButton (que espera un
  // cambio de `status`), recalcular no cambia el status (ya estaba
  // 'analyzed' antes y después), así que se compara este timestamp.
  updated_at?: string;
  // Respaldo de video de la reunión (30 días desde la fecha, después se
  // borra solo — ver videoRetention.ts). true si todavía está disponible;
  // el archivo en sí nunca se expone acá, se pide una URL firmada aparte
  // vía GET /api/meetings/:id/video (proxy) cuando el usuario abre la
  // pestaña de video.
  video_available?: boolean;
  // true si la reunión ya tiene un bot de Recall asociado (recall_bot_id) —
  // habilita el botón "Reprocesar grabación" para recuperarla a mano si el
  // proceso se cayó a mitad del webhook de /webhooks/recall (ver
  // peitho-backend/src/routes/webhooks.ts) y quedó pegada en status='scheduled'
  // pese a que Recall ya terminó de grabar.
  recall_bot_available?: boolean;
  // true si la reunión vino de una invitación manual al bot (Fase H,
  // disparador b) — habilita el botón "Volver a sincronizar desde Calendar"
  // (solo aplica a este flujo, no al calendario normal de un ejecutivo).
  is_bot_invite?: boolean;
  // Participantes reales de la llamada (nombre por diarización de Recall,
  // no heurística) ordenados de mayor a menor por cuánto habló cada uno —
  // el primero es quien el backend usó para detectar `ejecutivo` (ver
  // computeParticipantStats en postMeetingAnalysis.ts). Null si la reunión
  // no tiene transcript de Recall (ej. flujo viejo de la extensión de Chrome).
  participantes?: Array<{ nombre: string; palabras: number }> | null;
  // Link público de research (10-09-2026) — ver ShareResearchButton.tsx.
  // Null hasta que un admin lo genera la primera vez con "Compartir con el
  // cliente"; se usa para armar /research-compartido/<token>.
  research_share_token?: string | null;
}

export interface ClientListItem {
  id: string;
  name: string;
  documentos: number;
  // URL del sitio web del cliente (10-09-2026) — al guardarla, el backend
  // trae su contenido y lo suma a la base de conocimiento como un documento
  // más (ver fetchAndStoreWebsiteContent en knowledgeBase.ts).
  website_url: string | null;
}

export interface KnowledgeBaseDocument {
  id: string;
  file_name: string;
  file_type: string | null;
  // Fase F — una de KB_CATEGORIES (lib/knowledgeBaseCategories.ts) o null si
  // no se categorizó (documentos subidos antes de este cambio, o a propósito).
  category: string | null;
  uploaded_at: string;
  content_extracted: boolean;
}

// Fase E — sesión de Peitho del usuario logueado (distinto del rol de
// Supabase Auth en sí, que solo dice "hay sesión o no"). clientId/clientName
// vienen null para un admin.
export interface PeithoSession {
  email: string;
  role: "admin" | "client";
  clientId: string | null;
  clientName: string | null;
}

export interface UserRoleItem {
  user_id: string;
  email: string;
  role: "admin" | "client";
  client_id: string | null;
  client_name: string | null;
}

// Paso 6 — Panel de control. `tasa`/`alta_prediccion` son sobre
// prediccion_exito.puntaje (predicción de Claude, 1-5), NO una tasa de
// conversión real de negocio (eso vive en HubSpot, fuera de Peitho) — se
// muestran en el frontend etiquetadas explícitamente como "predicho".
export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface FunnelSegment {
  label: string;
  total: number;
  alta_prediccion: number;
  tasa: number;
  puntaje_promedio: number | null;
}

// Desglose de prediccion_exito (1-5) — pedido explícito del usuario
// (09-09-2026): "de 100 reuniones, 20% con predicción 1, 40% con
// predicción 2, ...". Siempre 5 elementos (1 a 5), aunque algún puntaje
// tenga 0 reuniones — así el reporte muestra la escala completa.
export interface PrediccionBucket {
  puntaje: number;
  total: number;
  pct: number;
}

// Ranking de ejecutivos por desempeño (desempeno_vendedor.puntaje, 1-10) —
// a diferencia de FunnelSegment, no tiene tasa/alta_prediccion porque no
// rankea por prediccion_exito sino por desempeno_vendedor.
export interface EjecutivoRanking {
  label: string;
  total: number;
  desempeno_promedio: number | null;
  prediccion_promedio: number | null;
}

export interface FunnelData {
  meta: {
    from: string | null;
    to: string | null;
    threshold: number;
    client_id: string | null;
    ejecutivo: string | null;
  };
  funnel: FunnelStage[];
  // No es parte del funnel (no es subconjunto de "predicción alta") — KPI
  // aparte. Ver comentario en peitho-backend/src/routes/panel.ts.
  con_compromisos: number;
  desempeno_vendedor_promedio: number | null;
  // Fit Score (10-09-2026) — promedio de fit_empresa/fit_contacto (1-10)
  // entre las reuniones analizadas del rango filtrado. Null si ninguna
  // reunión del rango tiene el campo (ej. ningún cliente con ICP cargado).
  fit_empresa_promedio: number | null;
  fit_contacto_promedio: number | null;
  por_cargo: FunnelSegment[];
  por_industria: FunnelSegment[];
  distribucion_prediccion: PrediccionBucket[];
  por_ejecutivo: EjecutivoRanking[];
}

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Server-side fetch (Server Components) — nunca corre en el navegador, así que
// no hace falta configurar CORS en peitho-backend para esto. Todas llevan el
// token de la sesión de Supabase para que el backend aplique el rol/scoping
// por cliente (Fase E) — no basta con el gating del frontend.
async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${backendUrl()}${path}`, { ...init, headers, cache: "no-store" });
}

export async function fetchMe(): Promise<PeithoSession | null> {
  const res = await backendFetch("/me");
  if (!res.ok) return null;
  return res.json();
}

export async function fetchMeetings(
  scope: "upcoming" | "past",
  clientId?: string
): Promise<MeetingListItem[]> {
  const params = new URLSearchParams({ scope });
  if (clientId) params.set("client_id", clientId);
  const res = await backendFetch(`/meetings?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`peitho-backend respondió ${res.status} en /meetings?${params.toString()}`);
  }
  return res.json();
}

export async function fetchMeeting(id: string): Promise<MeetingDetail | null> {
  const res = await backendFetch(`/meetings/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`peitho-backend respondió ${res.status} en /meetings/${id}`);
  }
  return res.json();
}

// grouped=true (Base de conocimiento, 10-09-2026): colapsa clientes que
// comparten el mismo external_id de la maestra (ej. "CChC"/"CChC - Valle")
// en un solo ítem, con el conteo de documentos sumado — mismo ICP y misma
// base de conocimiento para todas las variantes regionales de un cliente.
// El resto de las pantallas (selector de cliente de una reunión, filtros)
// llaman esto sin el flag, y siguen viendo cada `clients.id` por separado —
// ahí sí hace falta distinguir cada variante para asignar la reunión correcta.
export async function fetchClients(grouped = false): Promise<ClientListItem[]> {
  const res = await backendFetch(grouped ? "/clients?grouped=true" : "/clients");
  if (!res.ok) {
    throw new Error(`peitho-backend respondió ${res.status} en /clients`);
  }
  return res.json();
}

export async function fetchClientDocuments(clientId: string): Promise<KnowledgeBaseDocument[]> {
  const res = await backendFetch(`/clients/${clientId}/documents`);
  if (!res.ok) {
    throw new Error(`peitho-backend respondió ${res.status} en /clients/${clientId}/documents`);
  }
  return res.json();
}

export async function fetchUserRoles(): Promise<UserRoleItem[]> {
  const res = await backendFetch("/admin/user-roles");
  if (!res.ok) {
    throw new Error(`peitho-backend respondió ${res.status} en /admin/user-roles`);
  }
  return res.json();
}

// Lo mínimo que ve un CLIENTE externo por el link público de research
// (10-09-2026, sin login) — nunca client_id, analysis, transcript_text, ni
// nada de otra reunión. Ver routes/publicResearch.ts en el backend.
export interface PublicResearch {
  contraparte: string | null;
  empresa_contraparte: string | null;
  empresa_nombre: string | null;
  contacto_nombre: string | null;
  contacto_cargo: string | null;
  contacto_industria: string | null;
  start_time: string | null;
  pre_brief: PreBrief;
  cliente_bullseye: string | null;
}

// Sin backendFetch (esta página no tiene sesión de Supabase — es pública a
// propósito) y sin pasar por un proxy de Next.js: GET /public/research/:token
// no requiere auth en el backend, así que un Server Component puede pedirlo
// directo. cache: "no-store" igual que el resto — el link puede revocarse.
export async function fetchPublicResearch(token: string): Promise<PublicResearch | null> {
  const res = await fetch(`${backendUrl()}/public/research/${token}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`peitho-backend respondió ${res.status} en /public/research/${token}`);
  }
  return res.json();
}
