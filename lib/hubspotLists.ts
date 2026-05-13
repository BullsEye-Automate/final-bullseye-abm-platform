// Helpers para crear listas dinámicas en HubSpot via API v3.
// Sprint 4 fase 2.
//
// API endpoint: POST /crm/v3/lists
// Idempotente: si una lista con el mismo nombre ya existe, no la duplica.

const HUBSPOT_API_BASE = "https://api.hubapi.com";

type ApiResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; debug?: unknown };

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN ?? ""}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

async function hubspotFetch<T = unknown>(
  path: string,
  init: RequestInit
): Promise<ApiResult<T>> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return { ok: false, status: 500, error: "HUBSPOT_ACCESS_TOKEN is not configured" };
  }
  const url = `${HUBSPOT_API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers ?? {}) },
      cache: "no-store"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, status: 502, error: message };
  }
  const rawText = await res.text();
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = { raw: rawText.slice(0, 600) };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: `HubSpot ${res.status}`,
      debug: { url, response: parsed }
    };
  }
  return { ok: true, status: res.status, data: parsed as T };
}

// HubSpot v3 lists filter shape — version 4 de search filters.
type V3Filter = {
  property: string;
  operation:
    | { operationType: "ENUMERATION"; operator: "IS_ANY_OF" | "IS_NOT_ANY_OF"; values: string[] }
    | { operationType: "NUMBER"; operator: "IS_GREATER_THAN_OR_EQUAL_TO" | "IS_LESS_THAN_OR_EQUAL_TO" | "BETWEEN"; value?: number; lowerBound?: number; upperBound?: number }
    | { operationType: "STRING"; operator: "HAS_PROPERTY" | "NOT_HAS_PROPERTY" }
    | { operationType: "DATETIME"; operator: "IS_BEFORE_DATE" | "IS_AFTER_DATE"; value?: string }
    | { operationType: "BOOL"; operator: "IS_EQUAL_TO"; value: boolean };
  filterType: "PROPERTY";
};

type FilterBranch = {
  filterBranchType: "OR" | "AND";
  filterBranchOperator: "OR" | "AND";
  filters: V3Filter[];
  filterBranches: FilterBranch[];
};

export type ListDef = {
  name: string;
  description: string;
  filterBranch: FilterBranch;
};

const OBJECT_TYPE_ID_CONTACT = "0-1";

export async function ensureList(def: ListDef): Promise<
  ApiResult<{ list: { listId: string; name: string }; created: boolean }>
> {
  // 1) Search por nombre (HubSpot lists search).
  const search = await hubspotFetch<{
    lists: Array<{ listId: string; name: string; objectTypeId: string }>;
  }>("/crm/v3/lists/search", {
    method: "POST",
    body: JSON.stringify({ query: def.name, count: 10 })
  });
  if (search.ok && search.data) {
    const found = search.data.lists.find(
      (l) => l.name.trim() === def.name.trim() && l.objectTypeId === OBJECT_TYPE_ID_CONTACT
    );
    if (found) {
      return { ok: true, status: 200, data: { list: found, created: false } };
    }
  }

  // 2) Crear nueva.
  const body = {
    name: def.name,
    objectTypeId: OBJECT_TYPE_ID_CONTACT,
    processingType: "DYNAMIC",
    filterBranch: def.filterBranch
  };
  const create = await hubspotFetch<{ list: { listId: string; name: string } }>(
    "/crm/v3/lists",
    { method: "POST", body: JSON.stringify(body) }
  );
  if (!create.ok) {
    return { ok: false, status: create.status, error: create.error, debug: create.debug };
  }
  return {
    ok: true,
    status: create.status,
    data: { list: create.data!.list, created: true }
  };
}

// ============================================================================
// Definiciones de las 6 listas que el SDR usa día a día.
// ============================================================================

export const LIST_DEFINITIONS: ListDef[] = [
  {
    name: "weCAD · Hot por llamar (fit ≥ 8 + phone)",
    description:
      "Top priority. Leads con fit IA ≥ 8, con teléfono enriquecido, todavía sin contactar. Salen automáticamente cuando el SDR cambia Lead status a Connected/Attempted/etc.",
    filterBranch: {
      filterBranchType: "AND",
      filterBranchOperator: "AND",
      filterBranches: [],
      filters: [
        { property: "wecad_fit_score", filterType: "PROPERTY", operation: { operationType: "NUMBER", operator: "IS_GREATER_THAN_OR_EQUAL_TO", value: 8 } },
        { property: "phone", filterType: "PROPERTY", operation: { operationType: "STRING", operator: "HAS_PROPERTY" } },
        { property: "hs_lead_status", filterType: "PROPERTY", operation: { operationType: "ENUMERATION", operator: "IS_ANY_OF", values: ["NEW"] } }
      ]
    }
  },
  {
    name: "weCAD · Warm por llamar (fit 5-7 + phone)",
    description:
      "Segunda prioridad. Fit medio (5-7) con teléfono. Salen cuando el SDR los marca Connected/Unqualified/etc.",
    filterBranch: {
      filterBranchType: "AND",
      filterBranchOperator: "AND",
      filterBranches: [],
      filters: [
        { property: "wecad_fit_score", filterType: "PROPERTY", operation: { operationType: "NUMBER", operator: "BETWEEN", lowerBound: 5, upperBound: 7 } },
        { property: "phone", filterType: "PROPERTY", operation: { operationType: "STRING", operator: "HAS_PROPERTY" } },
        { property: "hs_lead_status", filterType: "PROPERTY", operation: { operationType: "ENUMERATION", operator: "IS_ANY_OF", values: ["NEW"] } }
      ]
    }
  },
  {
    name: "weCAD · Warm sin teléfono (pedir enrichment)",
    description:
      "Fit 5-7 sin phone. SDR cambia weCAD Phone Enrichment Status = Requested para disparar Lemlist→Lusha. Cuando llegue el phone, el contacto entra a 'Warm por llamar'.",
    filterBranch: {
      filterBranchType: "AND",
      filterBranchOperator: "AND",
      filterBranches: [],
      filters: [
        { property: "wecad_fit_score", filterType: "PROPERTY", operation: { operationType: "NUMBER", operator: "BETWEEN", lowerBound: 5, upperBound: 7 } },
        { property: "phone", filterType: "PROPERTY", operation: { operationType: "STRING", operator: "NOT_HAS_PROPERTY" } },
        { property: "hs_lead_status", filterType: "PROPERTY", operation: { operationType: "ENUMERATION", operator: "IS_ANY_OF", values: ["NEW"] } }
      ]
    }
  },
  {
    name: "weCAD · Reintentar (1er intento sin contacto)",
    description:
      "Leads que el SDR intentó llamar pero no contestaron. Para hacer 2do/3er intento. Cambiar Lead status a Connected/Unqualified los saca.",
    filterBranch: {
      filterBranchType: "AND",
      filterBranchOperator: "AND",
      filterBranches: [],
      filters: [
        { property: "hs_lead_status", filterType: "PROPERTY", operation: { operationType: "ENUMERATION", operator: "IS_ANY_OF", values: ["ATTEMPTED_TO_CONTACT"] } },
        { property: "phone", filterType: "PROPERTY", operation: { operationType: "STRING", operator: "HAS_PROPERTY" } }
      ]
    }
  },
  {
    name: "weCAD · Callbacks de hoy",
    description:
      "Leads en Bad Timing con fecha de callback agendada para hoy o antes. Cambiar Lead status los saca; reagendar callback los re-aparece.",
    filterBranch: {
      filterBranchType: "AND",
      filterBranchOperator: "AND",
      filterBranches: [],
      filters: [
        { property: "hs_lead_status", filterType: "PROPERTY", operation: { operationType: "ENUMERATION", operator: "IS_ANY_OF", values: ["BAD_TIMING"] } },
        { property: "wecad_callback_date", filterType: "PROPERTY", operation: { operationType: "DATETIME", operator: "IS_BEFORE_DATE", value: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } }
      ]
    }
  },
  {
    name: "weCAD · En pipeline",
    description:
      "Leads ya conectados, en negociación o con deal abierto. Para tracking, no para llamadas frías.",
    filterBranch: {
      filterBranchType: "OR",
      filterBranchOperator: "OR",
      filterBranches: [],
      filters: [
        { property: "hs_lead_status", filterType: "PROPERTY", operation: { operationType: "ENUMERATION", operator: "IS_ANY_OF", values: ["CONNECTED", "IN_PROGRESS", "OPEN_DEAL"] } }
      ]
    }
  }
];
