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
      first_name: string | null;
      last_name: string | null;
      job_title: string | null;
      company_name: string | null;
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

  // Lusha v2 — probamos múltiples URL/method patterns en orden, devolvemos
  // el primero que matchee. Diferentes versiones de Lusha API usan shapes
  // distintos; defensive multi-try es la única manera estable.
  //
  // Lo que sabemos al 2026-05:
  //   POST /v2/person + body { contacts: [{contactId, linkedinUrl}] } →
  //     a veces 200 con results inline, a veces 201 (bulk async).
  //   GET /v2/person?linkedinUrl=... → más confiable para single lookups,
  //     siempre 200 cuando encuentra.
  //   POST /v2/person + body { linkedinUrl } (sin contacts wrapper) →
  //     algunas docs antiguas, vale la pena probar.

  const candidates: Array<{ url: string; method: string; body?: string }> = [];
  const qs = new URLSearchParams();
  if (input.linkedinUrl) qs.set("linkedinUrl", input.linkedinUrl);
  else if (input.email) qs.set("email", input.email);
  else {
    if (input.firstName) qs.set("firstName", input.firstName);
    if (input.lastName) qs.set("lastName", input.lastName);
    if (input.companyName) qs.set("companyName", input.companyName);
  }

  // 1) GET sincrónico (el más confiable según docs Lusha actuales).
  candidates.push({ url: `${LUSHA_API_BASE}/v2/person?${qs.toString()}`, method: "GET" });

  // 2) POST con contacts wrapper (el shape que usaba antes, por si Lusha
  //    todavía lo soporta y a 201 le sigue con resultado en el body).
  const filter: Record<string, unknown> = {};
  if (input.linkedinUrl) filter.linkedinUrl = input.linkedinUrl;
  else if (input.email) filter.email = input.email;
  else {
    filter.fullName = `${input.firstName} ${input.lastName}`.trim();
    if (input.companyName) filter.companies = [{ name: input.companyName }];
  }
  candidates.push({
    url: `${LUSHA_API_BASE}/v2/person`,
    method: "POST",
    body: JSON.stringify({ contacts: [{ contactId: "1", ...filter }] })
  });

  // 3) POST flat (sin contacts wrapper) — shape de docs antiguas.
  candidates.push({
    url: `${LUSHA_API_BASE}/v2/person`,
    method: "POST",
    body: JSON.stringify(filter)
  });

  const attempts: Array<{ url: string; method: string; status: number; preview: string }> = [];
  let lastParsed: unknown = null;
  let lastStatus = 0;

  for (const c of candidates) {
    let res: Response;
    try {
      res = await fetch(c.url, {
        method: c.method,
        headers: authHeaders(),
        body: c.body,
        cache: "no-store"
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      attempts.push({ url: c.url, method: c.method, status: 0, preview: message });
      continue;
    }

    const rawText = await res.text();
    let parsed: unknown = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = { raw: rawText.slice(0, 600) };
    }

    attempts.push({
      url: c.url,
      method: c.method,
      status: res.status,
      preview: rawText.slice(0, 200)
    });

    lastParsed = parsed;
    lastStatus = res.status;

    if (!res.ok) {
      // Si es 4xx claro (auth, bad input), abortamos — no tiene sentido
      // seguir probando.
      if (res.status >= 400 && res.status < 500 && res.status !== 404) {
        return {
          ok: false,
          status: res.status,
          error: `Lusha ${res.status}`,
          debug: { attempts, response: parsed }
        };
      }
      continue;
    }

    // 2xx — extraemos phone. Si encontramos algo, devolvemos.
    const phones = extractPhones(parsed);
    if (phones.bestPhone) {
      const profile = extractProfile(parsed);
      return {
        ok: true,
        status: res.status,
        phone: phones.bestPhone,
        mobile: phones.mobile,
        direct: phones.direct,
        email: extractEmail(parsed),
        first_name: profile.first_name,
        last_name: profile.last_name,
        job_title: profile.job_title,
        company_name: profile.company_name,
        raw: parsed
      };
    }
  }

  // Ningún candidato devolvió phone. Reportamos el último parsed para que
  // el SDR vea qué dijo Lusha.
  const phones = extractPhones(lastParsed);
  const email = extractEmail(lastParsed);
  const profile = extractProfile(lastParsed);
  return {
    ok: true,
    status: lastStatus || 200,
    phone: phones.bestPhone,
    mobile: phones.mobile,
    direct: phones.direct,
    email,
    first_name: profile.first_name,
    last_name: profile.last_name,
    job_title: profile.job_title,
    company_name: profile.company_name,
    raw: { attempts, last_response: lastParsed }
  };
}

// Extrae nombre/apellido/cargo/empresa del response de Lusha. Defensivo
// con múltiples paths (mismo patrón que extractPhones).
function extractProfile(raw: unknown): {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string | null;
} {
  const empty = {
    first_name: null,
    last_name: null,
    job_title: null,
    company_name: null
  };
  if (!raw || typeof raw !== "object") return empty;

  const contacts = (raw as { contacts?: Record<string, { data?: unknown }> }).contacts;
  const candidates: Array<Record<string, unknown>> = [];
  if (contacts) {
    for (const key of Object.keys(contacts)) {
      const entry = contacts[key];
      const data = (entry?.data ?? entry) as Record<string, unknown> | undefined;
      if (data && typeof data === "object") candidates.push(data);
    }
  }
  const top = (raw as { data?: unknown }).data ?? raw;
  if (top && typeof top === "object") candidates.push(top as Record<string, unknown>);

  for (const data of candidates) {
    const first = pickProfileField(data, ["firstName", "first_name", "FirstName"]);
    const last = pickProfileField(data, ["lastName", "last_name", "LastName"]);
    // fullName fallback
    const full = pickProfileField(data, ["fullName", "name", "displayName"]);
    let f = first;
    let l = last;
    if (!f && full) f = full.split(/\s+/)[0] ?? null;
    if (!l && full && full.includes(" ")) {
      l = full.split(/\s+/).slice(1).join(" ");
    }
    const title = pickProfileField(data, [
      "jobTitle",
      "job_title",
      "title",
      "position",
      "headline"
    ]);
    // companyName puede estar nested en data.company.{name,companyName}
    let company = pickProfileField(data, [
      "companyName",
      "company_name",
      "organization",
      "organizationName"
    ]);
    if (!company) {
      const co = (data as { company?: unknown }).company;
      if (co && typeof co === "object") {
        company = pickProfileField(co as Record<string, unknown>, [
          "name",
          "companyName",
          "displayName"
        ]);
      }
    }
    if (f || l || title || company) {
      return {
        first_name: f,
        last_name: l,
        job_title: title,
        company_name: company
      };
    }
  }
  return empty;
}

function pickProfileField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
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
