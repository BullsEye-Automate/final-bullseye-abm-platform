const HS = "https://api.hubapi.com";

function hsHeaders() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

export function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
}

export async function searchHSCompany(name: string): Promise<string | null> {
  const res = await fetch(`${HS}/crm/v3/objects/companies/search`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: name }] }],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.results?.[0]?.id ?? null;
}

export async function searchHSCompanyByBullseyeId(companyId: string): Promise<string | null> {
  const res = await fetch(`${HS}/crm/v3/objects/companies/search`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "bullseye_company_id", operator: "EQ", value: companyId }] }],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.results?.[0]?.id ?? null;
}

export type HSCompanyRecord = {
  id: string;
  properties: {
    name?: string;
    bullseye_company_id?: string;
    createdate?: string;
    hs_object_source_label?: string;
  };
};

export async function listAllHSCompanies(
  properties: string[] = ["name", "bullseye_company_id", "createdate", "hs_object_source_label"]
): Promise<HSCompanyRecord[]> {
  const all: HSCompanyRecord[] = [];
  let after: string | undefined;
  let pages = 0;
  const MAX_PAGES = 300; // hasta 30k empresas, suficiente margen de seguridad

  do {
    const url = new URL(`${HS}/crm/v3/objects/companies`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("properties", properties.join(","));
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url.toString(), { headers: hsHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HubSpot ${res.status} listando empresas: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    all.push(...(data.results ?? []));
    after = data.paging?.next?.after;
    pages++;
  } while (after && pages < MAX_PAGES);

  return all;
}

// Fusiona objectIdToMerge dentro de primaryId (HubSpot mueve asociaciones/contactos
// al primario y archiva el duplicado). No se puede deshacer.
export async function mergeHSCompanies(primaryId: string, mergeId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${HS}/crm/v3/objects/companies/merge`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({ primaryObjectId: primaryId, objectIdToMerge: mergeId }),
  });
  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => "");
  return { ok: false, error: text.slice(0, 300) };
}

export async function upsertHSCompany(
  props: Record<string, string | number | null | undefined>,
  existingId?: string | null
): Promise<string | null> {
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v != null && v !== ""));
  if (existingId) {
    const res = await fetch(`${HS}/crm/v3/objects/companies/${existingId}`, {
      method: "PATCH", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[hs] PATCH company ${existingId} → ${res.status}: ${txt.slice(0, 200)}`);
      return null;
    }
    return existingId;
  }
  const res = await fetch(`${HS}/crm/v3/objects/companies`, {
    method: "POST", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn(`[hs] POST company → ${res.status}: ${txt.slice(0, 200)}`);
    return null;
  }
  return (await res.json()).id ?? null;
}

export async function searchHSContact(email: string): Promise<string | null> {
  const res = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.results?.[0]?.id ?? null;
}

export async function searchHSContactByLinkedinUrl(linkedinUrl: string): Promise<string | null> {
  const res = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "hs_linkedin_url", operator: "EQ", value: linkedinUrl }] }],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.results?.[0]?.id ?? null;
}

export async function searchHSContactByBullseyeId(contactId: string): Promise<string | null> {
  const res = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "bullseye_contact_id", operator: "EQ", value: contactId }] }],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.results?.[0]?.id ?? null;
}

export async function upsertHSContact(
  props: Record<string, string | number | null | undefined>,
  existingId?: string | null
): Promise<string | null> {
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v != null && v !== ""));
  if (existingId) {
    const res = await fetch(`${HS}/crm/v3/objects/contacts/${existingId}`, {
      method: "PATCH", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HubSpot PATCH contact ${existingId} → ${res.status}: ${txt.slice(0, 300)}`);
    }
    return existingId;
  }
  const res = await fetch(`${HS}/crm/v3/objects/contacts`, {
    method: "POST", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HubSpot POST contact → ${res.status}: ${txt.slice(0, 300)}`);
  }
  return (await res.json()).id ?? null;
}

export async function associateContactCompany(contactId: string, companyId: string): Promise<void> {
  await fetch(
    `${HS}/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`,
    { method: "PUT", headers: hsHeaders() }
  );
}

export async function patchHSContact(contactId: string, props: Record<string, string | number | null>): Promise<boolean> {
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v != null && v !== ""));
  const res = await fetch(`${HS}/crm/v3/objects/contacts/${contactId}`, {
    method: "PATCH", headers: hsHeaders(), body: JSON.stringify({ properties: clean }),
  });
  return res.ok;
}

// ── Engagement Score ───────────────────────────────────────────────────────────
export function computeEngagementScore(opts: {
  emailSent?:           boolean;
  emailOpens?:          number;
  emailClicks?:         number;
  emailReplies?:        number;
  linkedinSent?:        boolean;
  linkedinAccepted?:    boolean;
  linkedinReplies?:     number;
  bestCallOutcome?:     string | null;
  hasRecentActivity?:   boolean;
}): number {
  let email = 0;
  if (opts.emailSent)    email += 1;
  email += Math.min((opts.emailOpens  ?? 0) *  5, 15);
  email += Math.min((opts.emailClicks ?? 0) * 15, 30);
  email += Math.min((opts.emailReplies ?? 0) * 25, 50);
  email = Math.min(email, 50);

  let linkedin = 0;
  if (opts.linkedinSent)     linkedin += 1;
  if (opts.linkedinAccepted) linkedin += 15;
  linkedin += Math.min((opts.linkedinReplies ?? 0) * 30, 60);
  linkedin = Math.min(linkedin, 50);

  const callMap: Record<string, number> = {
    interested: 50, callback: 40, timing_objection: 25,
    price_objection: 15, other_objection: 5, voicemail: 3,
  };
  const callScore = Math.min(callMap[opts.bestCallOutcome ?? ""] ?? 0, 50);

  const recency = opts.hasRecentActivity ? 10 : 0;

  return Math.min(email + linkedin + callScore + recency, 100);
}

// ── Listas HubSpot ─────────────────────────────────────────────────────────────

type HsFilter = {
  filterType: "PROPERTY";
  property: string;
  operation: Record<string, unknown>;
};

type HsFilterBranch = {
  filterBranchType: "AND" | "OR";
  filterBranches:   HsFilterBranch[];
  filters:          HsFilter[];
};

function propFilter(property: string, operation: Record<string, unknown>): HsFilter {
  return { filterType: "PROPERTY", property, operation };
}

function isKnown(property: string): HsFilter {
  return propFilter(property, { operationType: "ALL_PROPERTY", operator: "IS_KNOWN" });
}

function numGte(property: string, value: number): HsFilter {
  return propFilter(property, { operationType: "NUMBER", operator: "IS_GREATER_THAN_OR_EQUAL_TO", value });
}

function numLte(property: string, value: number): HsFilter {
  return propFilter(property, { operationType: "NUMBER", operator: "IS_LESS_THAN_OR_EQUAL_TO", value });
}

function strEq(property: string, value: string): HsFilter {
  return propFilter(property, { operationType: "STRING", operator: "IS_EQUAL_TO", value });
}

function enumAnyOf(property: string, values: string[]): HsFilter {
  return propFilter(property, { operationType: "ENUMERATION", operator: "IS_ANY_OF", values });
}

function andBranch(filters: HsFilter[], subBranches: HsFilterBranch[] = []): HsFilterBranch {
  return { filterBranchType: "AND", filterBranches: subBranches, filters };
}

function orRoot(...children: HsFilterBranch[]): HsFilterBranch {
  return { filterBranchType: "OR", filterBranches: children, filters: [] };
}

const ACTIVE_LEAD_STATUSES = ["IN_PROGRESS", "NEW", "ATTEMPTED_TO_CONTACT", "BAD_TIMING", "CONNECTED", "OPEN_DEAL"];

export function buildClientLists(clientName: string, folderId: number | null) {
  const c = strEq("bullseye_client_name", clientName);
  return [
    {
      name: `Alta interacción (priorizar) - ${clientName}`,
      folderId,
      filterBranch: orRoot(
        andBranch([c, numGte("bullseye_engagement_score", 50), enumAnyOf("hs_lead_status", ACTIVE_LEAD_STATUSES)])
      ),
    },
    {
      name: `Warm por llamar (fit 5-7 + phone) - ${clientName}`,
      folderId,
      filterBranch: orRoot(
        andBranch([c, numGte("bullseye_fit_score", 5), numLte("bullseye_fit_score", 7), enumAnyOf("hs_lead_status", ["NEW"]), isKnown("phone")]),
        andBranch([c, numGte("bullseye_fit_score", 5), numLte("bullseye_fit_score", 7), enumAnyOf("hs_lead_status", ["NEW"]), isKnown("bullseye_telefono_lusha")])
      ),
    },
    {
      name: `Hot por llamar (fit ≥ 8 + phone) - ${clientName}`,
      folderId,
      filterBranch: orRoot(
        andBranch([c, numGte("bullseye_fit_score", 8), enumAnyOf("hs_lead_status", ["NEW"]), isKnown("phone")]),
        andBranch([c, numGte("bullseye_fit_score", 8), enumAnyOf("hs_lead_status", ["NEW"]), isKnown("bullseye_telefono_lusha")])
      ),
    },
  ];
}

export async function createHSListFolder(name: string): Promise<number | null> {
  const res = await fetch(`${HS}/contacts/v1/lists/folders`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  const id = d.folder?.id ?? d.id ?? null;
  return id != null ? Number(id) : null;
}

export async function createHSList(list: {
  name: string;
  folderId: number | null;
  filterBranch: HsFilterBranch;
}): Promise<{ name: string; id: string | null; status: "created" | "error"; error?: string }> {
  const body: Record<string, unknown> = {
    name: list.name,
    objectTypeId: "0-1",
    processingType: "DYNAMIC",
    filterBranch: list.filterBranch,
  };
  if (list.folderId) body.folderId = list.folderId;

  const res = await fetch(`${HS}/crm/v3/lists`, {
    method: "POST",
    headers: hsHeaders(),
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const d = await res.json();
    return { name: list.name, id: d.listId ?? d.id ?? null, status: "created" };
  }
  const text = await res.text().catch(() => "");
  if (text.includes("DUPLICATE_LIST_NAME") || text.includes("already exist")) {
    return { name: list.name, id: null, status: "created" };
  }
  return { name: list.name, id: null, status: "error", error: text.slice(0, 300) };
}

export async function provisionClientHubSpot(clientName: string): Promise<void> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return;
  const folderId = await createHSListFolder(clientName).catch(() => null);
  const listDefs = buildClientLists(clientName, folderId);
  await Promise.all(listDefs.map(createHSList)).catch(() => {/* no bloquea */});
}
