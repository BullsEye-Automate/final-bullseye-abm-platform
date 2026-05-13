// Cliente Lusha — fallback para teléfono cuando Lemlist no encuentra.
// Sprint 4 fase 2.
//
// Auth: header `api_key: <key>` (NO Bearer).
// Endpoint canonical v2: POST https://api.lusha.com/v2/person
//   Body con filters: {linkedinUrl} preferido, {email} fallback.
//
// Costo: ~1 crédito por lookup que devuelve resultado (Lusha no cobra si
// no encuentra). Cada crédito Lusha cuesta ~10x más que un crédito Lemlist
// phone enrichment — por eso solo lo llamamos como fallback.

const LUSHA_API_BASE = "https://api.lusha.com";

export type LushaPersonResult =
  | {
      ok: true;
      status: number;
      phone: string | null;
      mobile: string | null;
      direct: string | null;
      email: string | null;
      raw: unknown;
    }
  | { ok: false; status: number; error: string; debug?: unknown };

export type LushaLookupInput = {
  linkedinUrl?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
};

function authHeaders(): Record<string, string> {
  const key = process.env.LUSHA_API_KEY ?? "";
  return {
    api_key: key,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

export async function lookupLushaPerson(
  input: LushaLookupInput
): Promise<LushaPersonResult> {
  if (!process.env.LUSHA_API_KEY) {
    return { ok: false, status: 500, error: "LUSHA_API_KEY is not configured" };
  }
  if (!input.linkedinUrl && !input.email && !(input.firstName && input.lastName && input.companyName)) {
    return {
      ok: false,
      status: 400,
      error: "Lusha lookup needs linkedinUrl OR email OR (firstName + lastName + companyName)"
    };
  }

  // Lusha v2 expone /person con filtros tipo array. Probamos en orden de
  // confiabilidad: LinkedIn URL > email > nombre+empresa.
  const filter: Record<string, unknown> = {};
  if (input.linkedinUrl) filter.linkedinUrl = input.linkedinUrl;
  else if (input.email) filter.email = input.email;
  else {
    filter.fullName = `${input.firstName} ${input.lastName}`.trim();
    if (input.companyName) filter.companies = [{ name: input.companyName }];
  }

  const body = {
    contacts: [{ contactId: "1", ...filter }]
  };

  let res: Response;
  try {
    res = await fetch(`${LUSHA_API_BASE}/v2/person`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      cache: "no-store"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, status: 0, error: message };
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
      error: `Lusha ${res.status}`,
      debug: parsed
    };
  }

  const phones = extractPhones(parsed);
  const email = extractEmail(parsed);
  return {
    ok: true,
    status: res.status,
    phone: phones.bestPhone,
    mobile: phones.mobile,
    direct: phones.direct,
    email,
    raw: parsed
  };
}

// Lusha v2 devuelve { contacts: { "1": { data: { phoneNumbers: [...], emailAddresses: [...] } } } }
// El shape exacto puede variar — probamos múltiples paths con defensive parsing.
function extractPhones(raw: unknown): {
  bestPhone: string | null;
  mobile: string | null;
  direct: string | null;
} {
  const empty = { bestPhone: null, mobile: null, direct: null };
  if (!raw || typeof raw !== "object") return empty;

  // Path 1: v2 shape — { contacts: { "1": { data: { phoneNumbers: [...] } } } }
  const contacts = (raw as { contacts?: Record<string, { data?: unknown }> }).contacts;
  if (contacts) {
    for (const key of Object.keys(contacts)) {
      const entry = contacts[key];
      const data = entry?.data ?? entry;
      const result = parsePhoneArray(data);
      if (result.bestPhone) return result;
    }
  }

  // Path 2: top-level data
  return parsePhoneArray((raw as { data?: unknown }).data ?? raw);
}

function parsePhoneArray(data: unknown): {
  bestPhone: string | null;
  mobile: string | null;
  direct: string | null;
} {
  const empty = { bestPhone: null, mobile: null, direct: null };
  if (!data || typeof data !== "object") return empty;

  const arr =
    (data as { phoneNumbers?: unknown }).phoneNumbers ??
    (data as { phones?: unknown }).phones;
  if (!Array.isArray(arr)) {
    // Lusha v1-ish también devuelve phone como string directo.
    const flat = (data as { phone?: unknown }).phone;
    if (typeof flat === "string" && flat.length > 4) {
      return { bestPhone: flat, mobile: null, direct: null };
    }
    return empty;
  }

  let mobile: string | null = null;
  let direct: string | null = null;
  let any: string | null = null;
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const num =
      (entry as { number?: string }).number ??
      (entry as { phoneNumber?: string }).phoneNumber;
    const kind =
      ((entry as { phoneType?: string }).phoneType ??
        (entry as { type?: string }).type ??
        "")
        .toString()
        .toLowerCase();
    if (typeof num !== "string" || num.length < 5) continue;
    if (!any) any = num;
    if (kind.includes("mobile") && !mobile) mobile = num;
    if (kind.includes("direct") && !direct) direct = num;
  }
  return { bestPhone: mobile ?? direct ?? any, mobile, direct };
}

function extractEmail(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const contacts = (raw as { contacts?: Record<string, { data?: unknown }> }).contacts;
  if (contacts) {
    for (const key of Object.keys(contacts)) {
      const entry = contacts[key];
      const data = (entry?.data ?? entry) as Record<string, unknown>;
      const arr = data?.emailAddresses ?? data?.emails;
      if (Array.isArray(arr) && arr.length > 0) {
        const first = arr[0];
        if (typeof first === "string") return first;
        if (typeof first === "object" && first) {
          const e = (first as { email?: string; address?: string }).email ??
            (first as { address?: string }).address;
          if (typeof e === "string") return e;
        }
      }
    }
  }
  return null;
}
