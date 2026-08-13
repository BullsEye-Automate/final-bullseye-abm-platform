export interface MeetingListItem {
  id: string;
  ejecutivo: string | null;
  contraparte: string | null;
  empresa_contraparte: string | null;
  start_time: string | null;
  status: "scheduled" | "captured" | "analyzed";
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

export interface MeetingDetail extends MeetingListItem {
  analysis: MeetingAnalysis | null;
}

function backendUrl(): string {
  return process.env.PEITHO_BACKEND_URL ?? "http://localhost:3001";
}

// Server-side fetch (Server Components) — nunca corre en el navegador, así que
// no hace falta configurar CORS en peitho-backend para esto.
export async function fetchMeetings(scope: "upcoming" | "past"): Promise<MeetingListItem[]> {
  const res = await fetch(`${backendUrl()}/meetings?scope=${scope}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`peitho-backend respondió ${res.status} en /meetings?scope=${scope}`);
  }
  return res.json();
}

export async function fetchMeeting(id: string): Promise<MeetingDetail | null> {
  const res = await fetch(`${backendUrl()}/meetings/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`peitho-backend respondió ${res.status} en /meetings/${id}`);
  }
  return res.json();
}
