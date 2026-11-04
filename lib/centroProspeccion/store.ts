import { supabaseAdmin } from "@/lib/supabase";

// Centro de prospección: base de documentos (colección + id + JSON + versión),
// réplica 1:1 de la base del artifact "Centro de prospección BullsEye".
// La usan la página (/centro-prospeccion), sus APIs (/api/centro/*) y el
// conector MCP de las tareas programadas (/api/centro/mcp/[secret]).

export const COLLECTIONS = [
  "clientes", "solicitudes", "registro", "plan", "cuentas", "mantenimiento",
  "docs_cliente", "historial", "vinculos", "config", "adjuntos", "resultados",
] as const;
export type Collection = (typeof COLLECTIONS)[number];

// Colecciones que la página mantiene sincronizadas. adjuntos y resultados
// son pesados y se leen documento a documento cuando se necesitan.
export const LIVE_COLLECTIONS: Collection[] = [
  "clientes", "solicitudes", "registro", "plan", "cuentas", "mantenimiento",
  "docs_cliente", "historial", "vinculos", "config",
];

export type Source = "portal" | "automation" | "migration";
export type DocRow = { collection: string; doc_id: string; data: Record<string, unknown>; version: number; updated_at: string };
export type WriteMode = "set" | "update" | "merge";
export type WriteResult = { status: "ok" | "conflict" | "not_found"; version?: number | null; updated_at?: string };

const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;

export function isCollection(c: unknown): c is Collection {
  return typeof c === "string" && (COLLECTIONS as readonly string[]).includes(c);
}
export function isDocId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id) && id !== "." && id !== "..";
}

// Id aleatorio de 20 caracteres, como los que generaba el artifact.
export function newDocId(): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  for (const b of bytes) s += a[b % a.length];
  return s;
}

const PAGE = 1000;

// Lee todos los documentos de una o más colecciones (paginado de a 1000,
// el máximo de filas que devuelve Supabase por consulta).
export async function readDocs(collections: string[], opts: { since?: string | null } = {}): Promise<DocRow[]> {
  const db = supabaseAdmin();
  const out: DocRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from("centro_docs")
      .select("collection, doc_id, data, version, updated_at")
      .in("collection", collections)
      .order("collection", { ascending: true })
      .order("doc_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (opts.since) q = q.gt("updated_at", opts.since);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as DocRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function readDoc(collection: string, docId: string): Promise<DocRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("centro_docs")
    .select("collection, doc_id, data, version, updated_at")
    .eq("collection", collection)
    .eq("doc_id", docId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DocRow) ?? null;
}

// Borrados ocurridos después de `since` (para que la página los quite).
export async function readDeletes(collections: string[], since: string): Promise<{ collection: string; doc_id: string }[]> {
  const out: { collection: string; doc_id: string }[] = [];
  const db = supabaseAdmin();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("centro_docs_log")
      .select("collection, doc_id, created_at")
      .eq("action", "delete")
      .in("collection", collections)
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map((r) => ({ collection: r.collection as string, doc_id: r.doc_id as string })));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function writeDoc(p: {
  collection: Collection; docId: string; data: Record<string, unknown>; mode: WriteMode;
  ifVersion?: number | null; by: string | null; source: Source;
}): Promise<WriteResult> {
  const { data, error } = await supabaseAdmin().rpc("centro_docs_write", {
    p_collection: p.collection,
    p_doc_id: p.docId,
    p_data: p.data,
    p_mode: p.mode,
    p_if_version: p.ifVersion ?? null,
    p_by: p.by,
    p_source: p.source,
  });
  if (error) throw new Error(error.message);
  return data as WriteResult;
}

export async function deleteDoc(p: {
  collection: Collection; docId: string; ifVersion?: number | null; by: string | null; source: Source;
}): Promise<WriteResult> {
  const { data, error } = await supabaseAdmin().rpc("centro_docs_delete", {
    p_collection: p.collection,
    p_doc_id: p.docId,
    p_if_version: p.ifVersion ?? null,
    p_by: p.by,
    p_source: p.source,
  });
  if (error) throw new Error(error.message);
  return data as WriteResult;
}

// ---------- consultas (las usa el conector MCP) ----------

export type WhereOp = "eq" | "ne" | "in" | "not-in" | "lt" | "lte" | "gt" | "gte" | "array-contains"
  | "==" | "!=" | "<" | "<=" | ">" | ">=";
export type Where = [string, WhereOp, unknown];

function getField(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export function matches(data: Record<string, unknown>, where: Where[]): boolean {
  return where.every(([field, op, value]) => {
    const v = getField(data, field);
    switch (op) {
      case "eq": case "==": return JSON.stringify(v) === JSON.stringify(value);
      case "ne": case "!=": return JSON.stringify(v) !== JSON.stringify(value);
      case "lt": case "<": return v != null && cmp(v, value) < 0;
      case "lte": case "<=": return v != null && cmp(v, value) <= 0;
      case "gt": case ">": return v != null && cmp(v, value) > 0;
      case "gte": case ">=": return v != null && cmp(v, value) >= 0;
      case "in": return Array.isArray(value) && value.some((x) => JSON.stringify(x) === JSON.stringify(v));
      case "not-in": return Array.isArray(value) && !value.some((x) => JSON.stringify(x) === JSON.stringify(v));
      case "array-contains": return Array.isArray(v) && v.some((x) => JSON.stringify(x) === JSON.stringify(value));
      default: return false;
    }
  });
}

export function sortRows(rows: DocRow[], field: string, dir: "asc" | "desc"): DocRow[] {
  const s = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => s * cmp(getField(a.data, field), getField(b.data, field)));
}
