import { supabaseAdmin } from "./supabase";

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

// Allo permite 5 requests/segundo — GLOBAL para todo el workspace, no por
// conexión. Este límite se respeta acá con un espaciado mínimo entre
// llamadas, pero ese contador (lastRequestAt) solo vive en la memoria de
// ESTA instancia de función serverless: Análisis SDR carga varios reportes
// en paralelo (Ranking SDR, Ranking País, Score de Llamadas IA, Origen de
// Reuniones), cada uno su propia ruta API = su propia función = su propio
// contador. Si cada una se acerca a los 5 req/s de forma independiente, la
// suma real contra Allo fácilmente supera el límite y dispara una cascada
// de 429 (cada reintento espera lo que Allo indique) — probablemente la
// causa principal de que una carga completa tome varios minutos. Se deja
// margen de sobra (bien por debajo de 5 req/s por función) para que varias
// rutas puedan correr al mismo tiempo sin gatillar esa cascada, y más
// reintentos por si aun así ocurre algún 429 puntual.
const MIN_INTERVAL_MS = 350; // ~2.9 req/s por función, deja margen para rutas en paralelo
let lastRequestAt = 0;

async function throttleAllo() {
  const now = Date.now();
  const nextSlot = Math.max(now, lastRequestAt + MIN_INTERVAL_MS);
  lastRequestAt = nextSlot;
  if (nextSlot > now) await new Promise((r) => setTimeout(r, nextSlot - now));
}

async function alloFetchRaw(path: string, init?: RequestInit, retriesLeft = 5): Promise<Response> {
  await throttleAllo();
  const res = await fetch(`${ALLO_API}${path}`, {
    ...init,
    headers: { ...alloHeaders(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 429 && retriesLeft > 0) {
    const text = await res.text().catch(() => "");
    let retryAfterSeconds = 1;
    try {
      retryAfterSeconds = JSON.parse(text)?.error?.retry_after_seconds ?? 1;
    } catch {
      // usa el default si el body no es el JSON esperado
    }
    await new Promise((r) => setTimeout(r, (retryAfterSeconds + 0.3) * 1000));
    return alloFetchRaw(path, init, retriesLeft - 1);
  }
  return res;
}

// Los reportes de Análisis SDR (Ranking SDR, Ranking País, Score de
// Llamadas IA, Salud Telefónica, Análisis Clientes) viven en rutas de API
// separadas — cada una su propia función serverless — y con "todos los
// clientes" + el mismo período (el default al cargar) terminan pidiéndole a
// Allo exactamente las mismas páginas de exactamente los mismos números:
// cada reporte duplica el trabajo de los demás. Sumado a que Allo limita a
// 5 req/s (ver throttleAllo) y un solo reporte con "todos los clientes" ya
// dispara una llamada por cada número (~25+) más la paginación de
// /analytics/outbound, el resultado sin caché eran varios minutos por
// carga. Se cachea la respuesta en la tabla allo_response_cache de Supabase
// (ver supabase/allo_response_cache_migration.sql) — a diferencia de un
// Map en memoria, esa caché SÍ se comparte entre las distintas funciones
// serverless de cada reporte, que es justamente el caso que más pesa acá.
// Además se mantiene un Map en memoria como primera capa, para deduplicar
// sin ni siquiera ir a Supabase cuando dos llamadas idénticas coinciden
// dentro de la misma invocación.
//
// Filtrar por SDR/país no cambia esta consulta (son los mismos números y
// mismo rango de fechas — ese filtro se aplica después, en memoria, sobre
// las llamadas ya traídas), así que debería ser un cache hit igual de
// rápido que la vista sin filtrar — salvo que hayan pasado más de
// ALLO_CACHE_TTL_MS desde la carga inicial. Un usuario real tarda más de
// 90 segundos en abrir un multi-select y tildar varios SDR, así que ese TTL
// se quedaba corto para ese flujo. Se sube a 5 minutos: de sobra para el
// uso normal de los filtros sin dejar el dashboard desactualizado por
// mucho tiempo (hay botón "Actualizar" para forzar un refresco).
const ALLO_CACHE_TTL_MS = 5 * 60_000;
const alloCache = new Map<string, { expiresAt: number; promise: Promise<any> }>();

async function readAlloCacheRow(cacheKey: string): Promise<any | undefined> {
  try {
    const { data } = await supabaseAdmin()
      .from("allo_response_cache")
      .select("response, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (data && new Date(data.expires_at).getTime() > Date.now()) return data.response;
  } catch (err) {
    // No debe tumbar el reporte si la tabla de caché no existe (migración
    // no aplicada todavía) o Supabase falla puntualmente — se sigue de
    // largo y se consulta a Allo directo.
    console.error("Lectura de allo_response_cache falló, se sigue sin caché compartida:", err);
  }
  return undefined;
}

function writeAlloCacheRow(cacheKey: string, response: any, expiresAt: number) {
  // Fire-and-forget: el caller ya tiene su respuesta, no hace falta
  // esperar a que la escritura de caché termine.
  try {
    supabaseAdmin()
      .from("allo_response_cache")
      .upsert({ cache_key: cacheKey, response, expires_at: new Date(expiresAt).toISOString() }, { onConflict: "cache_key" })
      .then(({ error }) => {
        if (error) console.error("No se pudo guardar en allo_response_cache:", error.message);
      });
    // Limpieza oportunista de filas vencidas (baja frecuencia, no bloqueante).
    if (Math.random() < 0.05) {
      supabaseAdmin()
        .from("allo_response_cache")
        .delete()
        .lt("expires_at", new Date().toISOString())
        .then(() => {});
    }
  } catch (err) {
    console.error("No se pudo escribir en allo_response_cache:", err);
  }
}

async function alloFetch(path: string, init?: RequestInit) {
  const cacheKey = `${init?.method ?? "GET"} ${path} ${init?.body ?? ""}`;
  const now = Date.now();
  const inMemory = alloCache.get(cacheKey);
  if (inMemory && inMemory.expiresAt > now) return inMemory.promise;

  const promise = (async () => {
    const shared = await readAlloCacheRow(cacheKey);
    if (shared !== undefined) return shared;

    const res = await alloFetchRaw(path, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Allo API error (${res.status}): ${summarizeAlloError(text)}`);
    }
    const json = await res.json();
    writeAlloCacheRow(cacheKey, json, now + ALLO_CACHE_TTL_MS);
    return json;
  })();

  alloCache.set(cacheKey, { expiresAt: now + ALLO_CACHE_TTL_MS, promise });
  // Si falla, no dejar el error cacheado — el próximo intento debe reintentar de verdad.
  promise.catch(() => alloCache.delete(cacheKey));
  return promise;
}

// El body de error de Allo normalmente es JSON, pero cuando Cloudflare
// intercepta la request (ej. la API caída, 520/521/522) devuelve una página
// HTML larga en su lugar — mostrar eso tal cual dejaba los reportes del
// dashboard ilegibles (una pantalla entera de HTML crudo). Acá se intenta
// sacar un mensaje corto del JSON y, si no es JSON (HTML u otra cosa), se
// reemplaza por un resumen genérico o se recorta.
function summarizeAlloError(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "sin detalle";
  try {
    const parsed = JSON.parse(trimmed);
    return parsed?.error?.message || parsed?.message || JSON.stringify(parsed).slice(0, 300);
  } catch {
    if (trimmed.startsWith("<")) {
      return "Allo no está respondiendo (la API devolvió una página de error en vez de datos) — probablemente esté caída temporalmente, reintenta en unos minutos.";
    }
    return trimmed.slice(0, 300);
  }
}

// Descarga el audio de una grabación de Allo. El navegador no puede mandar
// la API key, así que esto se usa desde una ruta propia que hace de proxy
// (ver /api/allo/calls/[id]/recording) en vez de apuntar <audio> directo a
// la URL de Allo.
export async function fetchAlloRecording(url: string, rangeHeader?: string | null): Promise<Response> {
  await throttleAllo();
  const headers: Record<string, string> = { Authorization: process.env.ALLO_API_KEY ?? "" };
  if (rangeHeader) headers.Range = rangeHeader;
  return fetch(url, { headers, cache: "no-store" });
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

export type AlloCallItem = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  allo_number: string;
  contact_number: string;
  user: AlloUserRef | null;
  date: string;
  duration: number;
  // El enum real de Allo no está confirmado más allá de ANSWERED/VOICEMAIL/
  // TRANSFERRED — se deja abierto para no asumir exhaustividad.
  result: string | null;
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

// Aproximación de respaldo si fetchAlloConnectedCallIds no puede traer la
// clasificación oficial de Allo (ver más abajo) — NUNCA la fuente primaria,
// solo para que el reporte no se caiga entero si ese endpoint falla.
function isLikelyConnectedFallback(call: { duration: number; result: string | null }): boolean {
  return (call.result === "ANSWERED" || call.result === "TRANSFERRED") && call.duration >= 60;
}

// IDs de las llamadas salientes que Allo clasifica en la etapa
// "Conversación" de su propio embudo (Dial → Conectada → Conversación →
// Conversión, visible en su dashboard de analíticas outbound). Esta es la
// definición oficial de Allo de una llamada realmente conectada — excluye
// tanto las que nunca contestaron como las que sí "conectaron" (la línea
// se levantó) pero sin que hubiera una conversación real (buzón de voz,
// corte inmediato, etc.). Reemplaza la heurística anterior de
// resultado+duración (ver git history), que solo aproximaba este mismo
// criterio porque el campo "result" del listado normal de llamadas no
// distingue buzón de voz de una respuesta real, y ese detalle solo lo
// expone este endpoint de analíticas (no el de búsqueda simple de
// conversations/items/search).
//
// Devuelve null si la llamada al endpoint de analíticas falla (ej. si el
// formato exacto del body no calza con lo que espera Allo) — el caller debe
// usar isLikelyConnectedFallback en ese caso en vez de tratar null como "sin
// conectadas". Se degrada así, en vez de dejar caer el reporte entero con un
// error, mientras se termina de confirmar el contrato real de este endpoint
// (no se pudo probar en vivo contra la API real antes de este cambio).
export async function fetchAlloConnectedCallIds(params: {
  allo_numbers: string[];
  date_from: string; // YYYY-MM-DD
  date_to: string;   // YYYY-MM-DD
}): Promise<Set<string> | null> {
  const ids = new Set<string>();
  const allo_numbers = [...new Set(params.allo_numbers.filter(Boolean))];
  if (allo_numbers.length === 0) return ids;

  try {
    let page = 1;
    const maxPages = 200; // 100/página — tope de seguridad, ver listAllHSCompanies en lib/hubspot.ts
    let firstPageShape: string | null = null;

    while (page <= maxPages) {
      // Confirmado con soporte de Allo: las fechas van anidadas bajo "date"
      // ({from, to}), no como date_from/date_to sueltos — ese era el motivo
      // del 400 "request body could not be parsed" original.
      const d = await alloFetch("/v2/api/analytics/outbound", {
        method: "POST",
        body: JSON.stringify({
          date: { from: params.date_from, to: params.date_to },
          allo_numbers,
          extend: "items",
          stage: "CONVERSATION",
          page,
          size: 100,
        }),
      });
      // El formato documentado es data.items.data; se aceptan variantes
      // equivalentes por si Allo cambia el envoltorio.
      const itemsNode = d?.data?.items ?? d?.items;
      const pageItems: any[] = Array.isArray(itemsNode?.data)
        ? itemsNode.data
        : Array.isArray(itemsNode)
          ? itemsNode
          : Array.isArray(d?.data)
            ? d.data
            : [];
      if (page === 1) firstPageShape = describeShape(d);
      for (const it of pageItems) {
        const id = it?.id ?? it?.call_id ?? it?.conversation_id;
        if (id) ids.add(id);
      }
      const pagination = itemsNode?.pagination ?? d?.pagination;
      if (!pagination?.has_more || pageItems.length === 0) break;
      page += 1;
    }
    // Sin ninguna "Conversación" la respuesta no es confiable: desde oct-2026
    // este endpoint responde 200 pero vacío para todo el período (el portal
    // mostraba 0 conectadas en 20.000+ llamadas). Se devuelve null para que
    // los reportes usen el respaldo por duración en vez de mostrar 0, y se
    // registra la estructura recibida para poder corregir el formato.
    if (ids.size === 0) {
      console.warn(
        `fetchAlloConnectedCallIds: 0 conversaciones (${params.date_from}..${params.date_to}, ${allo_numbers.length} números). ` +
          `Se usa el respaldo por duración. Estructura recibida: ${firstPageShape}`
      );
      return null;
    }
    return ids;
  } catch (err) {
    console.error("fetchAlloConnectedCallIds falló, se usa el respaldo por duración:", err);
    return null;
  }
}

// Describe las claves de una respuesta (2 niveles) sin datos personales, para
// diagnosticar en los logs de Vercel cambios de formato de la API de Allo.
function describeShape(v: any, depth = 0): string {
  if (Array.isArray(v)) return `array(${v.length})${v.length && depth < 2 ? `[${describeShape(v[0], depth + 1)}]` : ""}`;
  if (v && typeof v === "object") {
    if (depth >= 2) return `{${Object.keys(v).slice(0, 12).join(",")}}`;
    return `{${Object.keys(v)
      .slice(0, 12)
      .map((k) => `${k}:${describeShape(v[k], depth + 1)}`)
      .join(",")}}`;
  }
  return typeof v;
}

export function resolveConnected(
  call: { id: string; duration: number; result: string | null },
  connectedCallIds: Set<string> | null
): boolean {
  return connectedCallIds ? connectedCallIds.has(call.id) : isLikelyConnectedFallback(call);
}

export type AlloCallDetail = AlloCallItem & {
  transcript: { speaker: string; text: string; time: string }[] | null;
};

// Detalle completo de una llamada, incluyendo transcript (no viene en el
// listado de búsqueda, hay que pedirlo explícitamente por id). Cada entrada
// del transcript trae `source` ("EXTERNAL" | "USER"), no "speaker"/"role".
export async function getAlloCallDetail(id: string): Promise<AlloCallDetail> {
  const d = await alloFetch(`/v2/api/conversations/items/${id}?extend=transcript`);
  const raw = d?.data ?? d;
  const base = toAlloCallItem(raw);
  const transcript = Array.isArray(raw?.transcript)
    ? raw.transcript.map((t: any) => ({
        speaker: t.source === "USER" ? "SDR" : t.source === "EXTERNAL" ? "Contacto" : (t.source ?? ""),
        text: t.text ?? "",
        time: t.time ?? "",
      }))
    : null;
  return { ...base, transcript };
}
