// Wrapper para Clay REST API. Documentación oficial: https://api.clay.com
// Auth: Bearer token (CLAY_API_TOKEN). El token vive en Settings → API key
// del workspace. Base URL es la misma que usa Clay para sus webhook sources:
// https://api.clay.com/v3.
//
// Uso típico desde la app:
//   const rowId = await findRowByColumnValue(tableId, "Wecad Contact Id", uuid);
//   await updateRowCell(tableId, rowId, "App Decision", "approved");

export const CLAY_API_BASE =
  process.env.CLAY_API_BASE_URL || "https://api.clay.com/v3";

type ClayApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; status: number; error: string; raw: string };

async function clayFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<ClayApiResult<T>> {
  const token = process.env.CLAY_API_TOKEN;
  if (!token) {
    return { ok: false, status: 500, error: "CLAY_API_TOKEN missing", raw: "" };
  }

  const url = `${CLAY_API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers ?? {})
      },
      cache: "no-store"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, status: 502, error: message, raw: "" };
  }

  const raw = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `Clay API ${res.status} on ${path}: ${raw.slice(0, 500)}`,
      raw
    };
  }
  try {
    const data = raw ? (JSON.parse(raw) as T) : ({} as T);
    return { ok: true, data, status: res.status };
  } catch {
    return {
      ok: false,
      status: res.status,
      error: `Clay API returned non-JSON: ${raw.slice(0, 500)}`,
      raw
    };
  }
}

// Busca el id de la primera fila cuya columna `columnName` matchea `value`.
// Intenta dos formatos de query string comunes en APIs estilo Clay: filter[col]
// y where[col]. Devuelve el id si encuentra, null si no, o un error.
export async function findRowByColumnValue(
  tableId: string,
  columnName: string,
  value: string
): Promise<{ row_id: string | null; debug?: string }> {
  const enc = encodeURIComponent(value);
  const col = encodeURIComponent(columnName);

  // Intento 1: ?filter[Column Name]=value
  const r1 = await clayFetch<any>(
    `/tables/${tableId}/rows?filter[${col}]=${enc}&limit=1`
  );
  if (r1.ok) {
    const row = extractFirstRow(r1.data);
    return { row_id: row?.id ?? null, debug: r1.ok ? `filter pattern: ${JSON.stringify(r1.data).slice(0, 400)}` : undefined };
  }

  // Intento 2: ?where[Column Name]=value
  const r2 = await clayFetch<any>(
    `/tables/${tableId}/rows?where[${col}]=${enc}&limit=1`
  );
  if (r2.ok) {
    const row = extractFirstRow(r2.data);
    return { row_id: row?.id ?? null, debug: `where pattern: ${JSON.stringify(r2.data).slice(0, 400)}` };
  }

  // Intento 3: query param directo
  const r3 = await clayFetch<any>(`/tables/${tableId}/rows?${col}=${enc}&limit=1`);
  if (r3.ok) {
    const row = extractFirstRow(r3.data);
    return { row_id: row?.id ?? null, debug: `direct pattern: ${JSON.stringify(r3.data).slice(0, 400)}` };
  }

  // Todos fallaron: devolvemos el último error como debug
  return { row_id: null, debug: `all query patterns failed. last error: ${r3.error}` };
}

function extractFirstRow(data: any): { id?: string } | null {
  if (!data) return null;
  if (Array.isArray(data?.rows) && data.rows.length > 0) return data.rows[0];
  if (Array.isArray(data?.data) && data.data.length > 0) return data.data[0];
  if (Array.isArray(data?.results) && data.results.length > 0) return data.results[0];
  if (Array.isArray(data) && data.length > 0) return data[0];
  return null;
}

// Actualiza el valor de una celda específica.
export async function updateRowCell(
  tableId: string,
  rowId: string,
  columnName: string,
  value: string
): Promise<ClayApiResult<any>> {
  return clayFetch(`/tables/${tableId}/rows/${rowId}`, {
    method: "PATCH",
    body: JSON.stringify({ [columnName]: value })
  });
}
