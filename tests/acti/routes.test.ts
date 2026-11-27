import { describe, expect, it } from "vitest";
import { actiClientRoute, isActiRoute } from "@/lib/acti/routes";
import { chileToday, monthBounds } from "@/lib/acti/home";
import { canCreateActiAdmins, canEditEvents, canEditPlans } from "@/lib/acti/permissions";

describe("rutas de un socio ACTI", () => {
  it("entra a /acti y /api/acti", () => {
    expect(actiClientRoute("/acti")).toBe("allow");
    expect(actiClientRoute("/acti/icp")).toBe("allow");
    expect(actiClientRoute("/api/acti/home")).toBe("allow");
  });
  it("el portal normal lo redirige a /acti y sus APIs quedan bloqueadas", () => {
    expect(actiClientRoute("/portal")).toBe("redirect");
    expect(actiClientRoute("/portal/radar")).toBe("redirect");
    expect(actiClientRoute("/api/portal/radar")).toBe("forbid");
    expect(actiClientRoute("/api/clients")).toBe("forbid");
  });
  it("las rutas internas de ACTI no son del socio", () => {
    expect(isActiRoute("/acti-equipo")).toBe(false);
    expect(actiClientRoute("/api/acti-equipo/members")).toBe("forbid");
    expect(actiClientRoute("/actividad")).toBe("redirect");
  });
});

describe("fechas", () => {
  it("día de Chile", () => {
    expect(chileToday(new Date("2026-12-01T02:00:00Z"))).toBe("2026-11-30");
  });
  it("límites del mes", () => {
    expect(monthBounds("2026-12-15")).toEqual({ start: "2026-12-01", next: "2027-01-01" });
  });
});

describe("permisos del equipo", () => {
  it("planes: solo Adolfo, Ingri y jkarmy", () => {
    expect(canEditPlans("AMADRIZ@bullseye-abm.com")).toBe(true);
    expect(canEditPlans("ihincapie@bullseye-abm.com")).toBe(true);
    expect(canEditPlans("jkarmy@bullseye-abm.com")).toBe(true);
    expect(canEditPlans("jguajardo@bullseye-abm.com")).toBe(false);
    expect(canEditPlans(null)).toBe(false);
  });
  it("eventos y administradores ACTI", () => {
    expect(canEditEvents("iarrieta@bullseye-abm.com")).toBe(true);
    expect(canEditEvents("amadriz@bullseye-abm.com")).toBe(false);
    expect(canCreateActiAdmins("ccontador@bullseye-abm.com")).toBe(true);
    expect(canCreateActiAdmins("iarrieta@bullseye-abm.com")).toBe(false);
  });
});
