// Wrapper para Clay REST API. La API de Clay está en api.clay.com pero la
// estructura exacta de los endpoints depende de la versión y del scope. Este
// helper prueba múltiples patrones comunes hasta encontrar el que funciona,
// y devuelve el debug de cada intento para diagnosticar desde la UI.
//
// Env vars requeridas:
//   CLAY_API_TOKEN — Bearer token (Settings → API key en Clay)
//   CLAY_CONTACTS_TABLE_ID — id de la tabla Contacts (formato t_xxx)
// Opcionales (mejoran las posibilidades de match):
//   CLAY_WORKSPACE_ID — id numérico del workspace (ej. 1158736)
//   CLAY_WORKBOOK_ID — id del workbook (formato wb_xxx)
//   CLAY_API_BASE_URL — override del base url (default https://api.clay.com)

const CLAY_API_BASE = process.env.CLAY_API_BASE_URL || "https://api.clay.com";

type FetchAttempt = {
  url: string;
  status: number;
  ok: boolean;
  body_preview: string;
};

type ClayApiResult<T> =
  | { ok: true; data: T; status: number; matched_url: string }
  | { ok: false; status: number; error: string; attempts: FetchAttempt[] };

async function tryFetch(url: string, options: RequestInit): Promise<FetchAttempt> {
  try {
    const res = await fetch(url, options);
    const raw = await res.text();
    return {
      url,
      status: res.status,
      ok: res.ok,
      body_preview: raw.slice(0, 400)
    };
  } catch (err) {
    return {
      url,
      status: 0,
      ok: false,
      body_preview: err instanceof Error ? err.message : "Network error"
    };
  }
}

function buildHeaders(): Record<string, string> {
  const token = process.env.CLAY_API_TOKEN ?? "";
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

// Genera las URLs candidatas a probar para una operación sobre la tabla.
// `suffix` es el path que va después del id de tabla (ej. "/rows?filter[X]=Y").
function buildCandidateUrls(suffix: string): string[] {
  const tableId = process.env.CLAY_CONTACTS_TABLE_ID ?? "";
  const wsId = process.env.CLAY_WORKSPACE_ID ?? "";
  const wbId = process.env.CLAY_WORKBOOK_ID ?? "";
  const base = CLAY_API_BASE;
  const urls: string[] = [];

  // Versión 1 sin scope
  urls.push(`${base}/v1/tables/${tableId}${suffix}`);
  urls.push(`${base}/v2/tables/${tableId}${suffix}`);
  urls.push(`${base}/v3/tables/${tableId}${suffix}`);

  // Con workspace
  if (wsId) {
    urls.push(`${base}/v1/workspaces/${wsId}/tables/${tableId}${suffix}`);
    urls.push(`${base}/v2/workspaces/${wsId}/tables/${tableId}${suffix}`);
    urls.push(`${base}/v3/workspaces/${wsId}/tables/${tableId}${suffix}`);
  }

  // Con workbook
  if (wbId) {
    urls.push(`${base}/v1/workbooks/${wbId}/tables/${tableId}${suffix}`);
    urls.push(`${base}/v2/workbooks/${wbId}/tables/${tableId}${suffix}`);
    urls.push(`${base}/v3/workbooks/${wbId}/tables/${tableId}${suffix}`);
  }

  return urls;
}

async function tryMultipleUrls<T = any>(
  candidates: string[],
  init: RequestInit
): Promise<ClayApiResult<T>> {
  const attempts: FetchAttempt[] = [];
  for (const url of candidates) {
    const att = await tryFetch(url, init);
    attempts.push(att);
    if (att.ok) {
      try {
        const data = att.body_preview ? (JSON.parse(att.body_preview) as T) : ({} as T);
        return { ok: true, data, status: att.status, matched_url: url };
      } catch {
        // ok response pero non-JSON, raro
        return {
          ok: true,
          data: { raw: att.body_preview } as unknown as T,
          status: att.status,
          matched_url: url
        };
      }
    }
  }
  return {
    ok: false,
    status: attempts[attempts.length - 1]?.status ?? 0,
    error: "All Clay API URL patterns returned non-2xx",
    attempts
  };
}

export type FindRowDebug = { attempts: FetchAttempt[]; matched_url?: string };

export async function findRowByColumnValue(
  columnName: string,
  value: string
): Promise<{ row_id: string | null; debug: FindRowDebug }> {
  const enc = encodeURIComponent(value);
  const col = encodeURIComponent(columnName);

  // Patrones de query string a probar dentro del suffix
  const queryPatterns = [
    `/rows?filter[${col}]=${enc}&limit=1`,
    `/rows?where[${col}]=${enc}&limit=1`,
    `/rows?${col}=${enc}&limit=1`,
    `/rows/search?${col}=${enc}&limit=1`
  ];

  const allAttempts: FetchAttempt[] = [];

  for (const qp of queryPatterns) {
    const urls = buildCandidateUrls(qp);
    const result = await tryMultipleUrls<any>(urls, {
      method: "GET",
      headers: buildHeaders(),
      cache: "no-store"
    });
    if (result.ok) {
      const row = extractFirstRow(result.data);
      return {
        row_id: row?.id ?? row?.row_id ?? null,
        debug: {
          attempts: allAttempts.concat(
            buildCandidateUrls(qp).map((u, i) => ({
              url: u,
              status: 200,
              ok: u === result.matched_url,
              body_preview: u === result.matched_url ? "MATCH" : ""
            }))
          ),
          matched_url: result.matched_url
        }
      };
    }
    allAttempts.push(...result.attempts);
  }

  return {
    row_id: null,
    debug: { attempts: allAttempts.slice(0, 12) } // cap a 12 para no inflar el response
  };
}

function extractFirstRow(data: any): any {
  if (!data) return null;
  if (Array.isArray(data?.rows) && data.rows.length > 0) return data.rows[0];
  if (Array.isArray(data?.data) && data.data.length > 0) return data.data[0];
  if (Array.isArray(data?.results) && data.results.length > 0) return data.results[0];
  if (Array.isArray(data?.items) && data.items.length > 0) return data.items[0];
  if (Array.isArray(data) && data.length > 0) return data[0];
  return null;
}

export async function updateRowCell(
  rowId: string,
  columnName: string,
  value: string
): Promise<{ ok: boolean; status: number; error?: string; debug?: FetchAttempt[] }> {
  const body = JSON.stringify({ [columnName]: value });
  const urls = buildCandidateUrls(`/rows/${rowId}`);
  const result = await tryMultipleUrls(urls, {
    method: "PATCH",
    headers: buildHeaders(),
    body,
    cache: "no-store"
  });
  if (result.ok) return { ok: true, status: result.status };
  return { ok: false, status: result.status, error: result.error, debug: result.attempts };
}
