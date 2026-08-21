import { getAccessToken } from "./peithoAuth";

export interface MeetingListItem {
  id: string;
  ejecutivo: string | null;
  contraparte: string | null;
  empresa_contraparte: string | null;
  start_time: string | null;
  status: "scheduled" | "captured" | "analyzed";
  // Fase E — para el filtro de cliente en la vista admin.
  client_id: string | null;
  cliente_bullseye: string | null;
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
}

export interface ClientListItem {
  id: string;
  name: string;
  documentos: number;
}

export interface KnowledgeBaseDocument {
  id: string;
  file_name: string;
  file_type: string | null;
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

export async function fetchClients(): Promise<ClientListItem[]> {
  const res = await backendFetch("/clients");
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
