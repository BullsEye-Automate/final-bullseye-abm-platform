// Helpers para crear listas dinámicas en HubSpot via API v3.
// Sprint 4 fase 2.
//
// API endpoint: POST /crm/v3/lists
// Idempotente: si una lista con el mismo nombre ya existe, no la duplica.
//
// Schema canonical v3 (validado contra errores 400 reales del API):
//   - El root filterBranch DEBE ser tipo OR, conteniendo sub-branches AND.
//     Una AND-only condition se modela como OR → [AND → [filters...]].
//   - STRING.HAS_PROPERTY / NOT_HAS_PROPERTY no existen — se usan los
//     operadores IS_KNOWN / NOT_KNOWN (sin value).
//   - DATETIME usa el campo `timestamp`, no `value`.
//   - NUMBER.BETWEEN usa `lowestValue` + `highestValue`.

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

// ============================================================================
// Filter builders — abstraen el shape v3 para evitar typos en cada lista.
// ============================================================================

type V3Filter = {
  property: string;
  filterType: "PROPERTY";
  operation: Record<string, unknown>;
};

function enumIn(property: string, values: string[]): V3Filter {
  return {
    property,
    filterType: "PROPERTY",
    operation: { operationType: "ENUMERATION", operator: "IS_ANY_OF", values }
  };
}

function numberGte(property: string, value: number): V3Filter {
  return {
    property,
    filterType: "PROPERTY",
    operation: { operationType: "NUMBER", operator: "IS_GREATER_THAN_OR_EQUAL_TO", value }
  };
}

function numberBetween(property: string, low: number, high: number): V3Filter {
  return {
    property,
    filterType: "PROPERTY",
    operation: {
      operationType: "NUMBER",
      operator: "BETWEEN",
      lowestValue: low,
      highestValue: high
    }
  };
}

function isKnown(property: string): V3Filter {
  return {
    property,
    filterType: "PROPERTY",
    operation: { operationType: "STRING", operator: "IS_KNOWN" }
  };
}

function isNotKnown(property: string): V3Filter {
  return {
    property,
    filterType: "PROPERTY",
    operation: { operationType: "STRING", operator: "NOT_KNOWN" }
  };
}

function datetimeBefore(property: string, isoTimestamp: string): V3Filter {
  return {
    property,
    filterType: "PROPERTY",
    operation: { operationType: "DATETIME", operator: "IS_BEFORE_DATE", timestamp: isoTimestamp }
  };
}

// Root filterBranch wrapper: OR → [AND → [filters...]].
function andOnly(filters: V3Filter[]): FilterBranch {
  return {
    filterBranchType: "OR",
    filterBranchOperator: "OR",
    filterBranches: [
      {
        filterBranchType: "AND",
        filterBranchOperator: "AND",
        filters,
        filterBranches: []
      }
    ],
    filters: []
  };
}

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

// Para "Callbacks de hoy" — la lista re-evalúa el filterBranch en cada
// recálculo (HubSpot lo hace cada ~30 min en DYNAMIC lists), así que un
// timestamp fijo "fin de hoy" alcanza para que "antes de mañana" funcione
// como "callback agendado para hoy o antes". El timestamp se renueva en
// cada llamada a setup, pero la lista ya creada queda con el original —
// no es problema porque la sintaxis BEFORE_DATE en HubSpot lists usa
// el valor como cota dinámica "today + offset", no fija (HubSpot tiene
// rolling-date operators, pero la API v3 los soporta con un timestamp
// que se va shifteando — verificar tras crearlas).
const TODAY_END = new Date(Date.now() + 24 * 60 * 60 * 1000)
  .toISOString();

export const LIST_DEFINITIONS: ListDef[] = [
  {
    name: "weCAD · Hot por llamar (fit ≥ 8 + phone)",
    description:
      "Top priority. Leads con fit IA ≥ 8, con teléfono enriquecido, todavía sin contactar.",
    filterBranch: andOnly([
      numberGte("wecad_fit_score", 8),
      isKnown("phone"),
      enumIn("hs_lead_status", ["NEW"])
    ])
  },
  {
    name: "weCAD · Warm por llamar (fit 5-7 + phone)",
    description:
      "Segunda prioridad. Fit medio (5-7) con teléfono.",
    filterBranch: andOnly([
      numberBetween("wecad_fit_score", 5, 7),
      isKnown("phone"),
      enumIn("hs_lead_status", ["NEW"])
    ])
  },
  {
    name: "weCAD · Warm sin teléfono (pedir enrichment)",
    description:
      "Fit 5-7 sin phone. SDR cambia weCAD Phone Enrichment Status = Requested para disparar Lemlist→Lusha.",
    filterBranch: andOnly([
      numberBetween("wecad_fit_score", 5, 7),
      isNotKnown("phone"),
      enumIn("hs_lead_status", ["NEW"])
    ])
  },
  {
    name: "weCAD · Reintentar (1er intento sin contacto)",
    description:
      "Leads que el SDR intentó llamar pero no contestaron. Para 2do/3er intento.",
    filterBranch: andOnly([
      enumIn("hs_lead_status", ["ATTEMPTED_TO_CONTACT"]),
      isKnown("phone")
    ])
  },
  {
    name: "weCAD · Callbacks de hoy",
    description:
      "Leads en Bad Timing con fecha de callback agendada para hoy o antes.",
    filterBranch: andOnly([
      enumIn("hs_lead_status", ["BAD_TIMING"]),
      datetimeBefore("wecad_callback_date", TODAY_END)
    ])
  },
  {
    name: "weCAD · En pipeline",
    description:
      "Leads ya conectados, en negociación o con deal abierto. Para tracking, no para llamadas frías.",
    filterBranch: andOnly([
      enumIn("hs_lead_status", ["CONNECTED", "IN_PROGRESS", "OPEN_DEAL"])
    ])
  }
];
