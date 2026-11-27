import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/radarAbm/server/store", () => ({ loadRadarConfig: async () => null }));

const { sortRecos } = await import("@/lib/acti/reco");
const { stageOf, sanitizePersonas } = await import("@/lib/acti/requests");
const { summarizePeople } = await import("@/lib/acti/people");
const { sanitizeFilters, filtersKey } = await import("@/lib/acti/search");
const { DEFAULT_TITLE_RULES } = await import("@/lib/radarAbm/dictionaries");

const r = (name: string, score: number, mobiles: number, demand = 0) => ({ name, fit: { score }, people: { mobiles }, demand });

describe("orden de recomendaciones: fit → contactos con celular → menor demanda", () => {
  it("dentro del mismo tramo de fit, primero las con celular y menos demanda", () => {
    const out = sortRecos([r("A", 82, 0), r("B", 85, 0, 2), r("C", 80, 3), r("D", 95, 0), r("E", 88, 2, 1)]).map((x) => x.name);
    // 95 va primero (tramo 90); en el tramo 80: con celular (C, E) antes, y entre ellas la sin demanda
    expect(out).toEqual(["D", "C", "E", "A", "B"]);
  });
  it("un fit claramente mayor gana aunque no tenga celular", () => {
    expect(sortRecos([r("baja", 61, 5), r("alta", 90, 0)]).map((x) => x.name)).toEqual(["alta", "baja"]);
  });
});

describe("etapas de Mis solicitudes desde el flujo real", () => {
  const wl = (status: string, contacts_status = "pending") => ({ id: "w", status, contacts_status, contacts_found: 0 });
  it("cola, research, contacto, reunión y sin respuesta", () => {
    expect(stageOf({ status: "en_cola" }, null, 0, null).stage).toBe("cola");
    expect(stageOf({ status: "liberada" }, wl("new"), 0, null).stage).toBe("research");
    expect(stageOf({ status: "liberada" }, wl("in_progress", "done"), 0, null).stage).toBe("research");
    expect(stageOf({ status: "liberada" }, wl("contacts_found", "done"), 2, null)).toEqual({ stage: "contacto", detail: "2 perfiles en contacto" });
    expect(stageOf({ status: "liberada" }, wl("contacts_found"), 2, "2026-12-03").stage).toBe("reunion");
    expect(stageOf({ status: "liberada" }, wl("discarded"), 0, null).stage).toBe("sin_respuesta");
  });
});

describe("perfiles por empresa: solo conteos y tipos de cargo", () => {
  it("agrega por dominio sin datos personales", () => {
    const m = summarizePeople(
      [
        { company_domain: "acme.cl", title: "Gerente de TI", mobiles: ["+56911111111"] },
        { company_domain: "acme.cl", title: "CFO", mobiles: [] },
        { company_domain: "ACME.cl", title: null, mobiles: null },
        { company_domain: "gmail.com", title: "CEO", mobiles: ["+5699"] },
        { company_domain: null, title: "CEO", mobiles: [] },
      ],
      DEFAULT_TITLE_RULES
    );
    expect([...m.keys()]).toEqual(["acme.cl"]);
    const a = m.get("acme.cl")!;
    expect(a.contacts).toBe(3);
    expect(a.mobiles).toBe(1);
    expect([...a.areas.keys()].sort()).toEqual(["Finanzas", "Tecnología"]);
    expect([...a.levels.keys()].sort()).toEqual(["C-Level", "Gerente"]);
    expect(JSON.stringify([...a.titles])).not.toMatch(/\+56/);
  });
});

describe("validación de entradas", () => {
  it("filtros", () => {
    const f = sanitizeFilters({ industry: ["Banca", "", 3], mobile: "si", q: "  acme ", evil: ["x"] });
    expect(f).toEqual({ q: "acme", industry: ["Banca"] });
    expect(filtersKey(f)).toBe(filtersKey({ q: "acme", industry: ["Banca"] }));
  });
  it("buyer persona de la solicitud (tipos de cargo, nunca personas)", () => {
    expect(sanitizePersonas({ areas: ["Tecnología", 1], levels: "x", titles: " CIO " })).toEqual({ areas: ["Tecnología"], levels: [], titles: "CIO" });
  });
});
