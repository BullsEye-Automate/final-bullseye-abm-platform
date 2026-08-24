const ALLO_API = "https://api.withallo.com";

function alloHeaders() {
  const key = process.env.ALLO_API_KEY;
  if (!key) {
    throw new Error("ALLO_API_KEY no está configurada (Vercel / .env.local)");
  }
  // La API de Allo espera la key cruda en Authorization, sin prefijo "Bearer".
  return {
    Authorization: key,
    "Content-Type": "application/json",
  };
}

async function alloFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${ALLO_API}${path}`, {
    ...init,
    headers: { ...alloHeaders(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Allo API error (${res.status}): ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

export type AlloUserRef = { id: string; name: string; email: string };

export type AlloNumber = {
  number: string;
  name: string | null;
  country: string | null;
  users: AlloUserRef[];
};

// Lista todos los números de Allo contratados por el workspace de BullsEye.
// Excluye Sender IDs / entradas sin número real (ej. el primer registro de
// /v2/api/numbers, que es un placeholder sin campo "number").
export async function listAlloNumbers(): Promise<AlloNumber[]> {
  const d = await alloFetch("/v2/api/numbers");
  const items: any[] = d?.data ?? [];
  return items
    .filter((n) => typeof n.number === "string" && n.number.length > 0)
    .map((n) => ({
      number: n.number as string,
      name: (n.name as string) ?? null,
      country: (n.country as string) ?? null,
      users: Array.isArray(n.users) ? n.users : [],
    }));
}

export type AlloTag = { id: string; name: string; color: string | null };

export async function listAlloTags(): Promise<AlloTag[]> {
  const d = await alloFetch("/v2/api/tags");
  const items: any[] = d?.data ?? [];
  return items.map((t) => ({ id: t.id, name: t.name, color: t.color ?? null }));
}

// Allo serializa los campos que la IA no pudo extraer como el string literal
// "null" en vez de dejar el campo vacío o ausente.
function cleanExtracted(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t;
}

export type AlloCallResult = "ANSWERED" | "VOICEMAIL" | "TRANSFERRED";

export type AlloCallItem = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  allo_number: string;
  contact_number: string;
  user: AlloUserRef | null;
  date: string;
  duration: number;
  result: AlloCallResult | null;
  recording_url: string | null;
  summary: string | null;
  tags: string[];
  extracted_contact: {
    name: string | null;
    company: string | null;
    job_title: string | null;
    emails: string[];
  };
};

function toAlloCallItem(raw: any): AlloCallItem {
  const contact = raw?.extracted_data?.contact ?? {};
  return {
    id: raw.id,
    direction: raw.direction,
    allo_number: raw.allo_number,
    contact_number: raw.contact_number,
    user: raw.user ?? null,
    date: raw.date,
    duration: typeof raw.duration === "number" ? raw.duration : 0,
    result: raw.result ?? null,
    recording_url: raw.recording_url ?? null,
    summary: raw.summary ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    extracted_contact: {
      name: cleanExtracted(contact.name),
      company: cleanExtracted(contact.company),
      job_title: cleanExtracted(contact.job_title),
      emails: Array.isArray(contact.emails) ? contact.emails : [],
    },
  };
}

// Trae TODAS las llamadas que calcen los filtros, paginando internamente
// (la API de Allo devuelve páginas de hasta 100). maxItems es un techo de
// seguridad para no paginar indefinidamente ante un rango de fechas enorme.
export async function searchAlloCalls(params: {
  allo_number?: string;
  date_from?: string; // YYYY-MM-DD
  date_to?: string;   // YYYY-MM-DD
  direction?: "INBOUND" | "OUTBOUND";
  tags?: string[];
  maxItems?: number;
}): Promise<AlloCallItem[]> {
  const items: AlloCallItem[] = [];
  const maxItems = params.maxItems ?? 5000;
  let page = 1;

  while (true) {
    const body: Record<string, unknown> = { type: "CALL", sort: "DATE", page, size: 100 };
    if (params.allo_number) body.allo_number = params.allo_number;
    if (params.date_from) body.date_from = params.date_from;
    if (params.date_to) body.date_to = params.date_to;
    if (params.direction) body.direction = params.direction;
    if (params.tags?.length) body.tags = params.tags;

    const d = await alloFetch("/v2/api/conversations/items/search", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const pageItems: any[] = d?.data ?? [];
    for (const raw of pageItems) {
      items.push(toAlloCallItem(raw));
      if (items.length >= maxItems) return items;
    }
    if (!d?.pagination?.has_more || pageItems.length === 0) break;
    page += 1;
  }
  return items;
}

export type AlloCallDetail = AlloCallItem & {
  transcript: { speaker: string; text: string; timestamp?: number }[] | null;
};

// Detalle completo de una llamada, incluyendo transcript (no viene en el
// listado de búsqueda, hay que pedirlo explícitamente por id).
export async function getAlloCallDetail(id: string): Promise<AlloCallDetail> {
  const d = await alloFetch(`/v2/api/conversations/items/${id}?extend=transcript`);
  const raw = d?.data ?? d;
  const base = toAlloCallItem(raw);
  const transcript = Array.isArray(raw?.transcript)
    ? raw.transcript.map((t: any) => ({
        speaker: t.speaker ?? t.role ?? "",
        text: t.text ?? t.content ?? "",
        timestamp: typeof t.timestamp === "number" ? t.timestamp : undefined,
      }))
    : null;
  return { ...base, transcript };
}
