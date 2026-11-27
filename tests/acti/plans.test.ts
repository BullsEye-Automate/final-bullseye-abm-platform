import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  canSeePulsoView,
  monthProgress,
  monthlyCompanyQuota,
  normalizeConfig,
  trialState,
} from "@/lib/acti/plans";

const cfg = normalizeConfig(DEFAULT_CONFIG);
const member = { joined_at: "2026-11-01", trial_start: "2026-11-01", trial_end: null };

describe("configuración de planes", () => {
  it("sin configuración guardada usa los valores por defecto", () => {
    expect(normalizeConfig(null)).toEqual(cfg);
    expect(cfg.plans.conecta.baseUf).toBe(18);
    expect(cfg.plans.crece.guaranteedMeetings).toBe(8);
    expect(cfg.params.conversionRate).toBe(0.1);
    expect(cfg.params.revenueSharePct).toBe(10);
  });

  it("valores inválidos caen al valor por defecto y no rompen", () => {
    const c = normalizeConfig({ plans: { conecta: { baseUf: "abc", guaranteedMeetings: -5, pulsoViews: ["peitho", "no-existe"] } }, params: { conversionRate: 7 } });
    expect(c.plans.conecta.baseUf).toBe(18);
    expect(c.plans.conecta.guaranteedMeetings).toBe(0);
    expect(c.plans.conecta.pulsoViews).toEqual(["peitho"]);
    expect(c.params.conversionRate).toBe(1);
  });

  it("al cambiar el plan en la configuración cambian los límites sin tocar código", () => {
    const c = normalizeConfig({ plans: { conecta: { guaranteedMeetings: 6 } } });
    expect(monthlyCompanyQuota(c.plans.conecta, c.params)).toBe(60);
  });
});

describe("cupo de empresas = reuniones garantizadas ÷ conversión (10%)", () => {
  it("planes pagados", () => {
    expect(monthlyCompanyQuota(cfg.plans.conecta, cfg.params)).toBe(50);
    expect(monthlyCompanyQuota(cfg.plans.crece, cfg.params)).toBe(80);
    expect(monthlyCompanyQuota(cfg.plans.acelera, cfg.params)).toBe(120);
  });
  it("Freemium: 20 empresas fijas", () => {
    expect(monthlyCompanyQuota(cfg.plans.freemium, cfg.params)).toBe(20);
  });
  it("cupo fijo configurado manda sobre el cálculo", () => {
    expect(monthlyCompanyQuota({ ...cfg.plans.crece, companiesPerMonth: 30 }, cfg.params)).toBe(30);
  });
});

describe("prueba Freemium: 20 empresas o 2 reuniones en 90 días, lo que ocurra primero", () => {
  const plan = cfg.plans.freemium;
  it("en curso", () => {
    const t = trialState(member, plan, { meetings: 1, companies: 10 }, "2026-11-27");
    expect(t.completed).toBe(false);
    expect(t.end).toBe("2027-01-30");
    expect(t.daysLeft).toBe(64);
  });
  it("bloquea al llegar a 2 reuniones", () => {
    const t = trialState(member, plan, { meetings: 2, companies: 3 }, "2026-11-27");
    expect(t.completed).toBe(true);
    expect(t.reason).toBe("meetings");
  });
  it("bloquea al llegar a 20 empresas", () => {
    const t = trialState(member, plan, { meetings: 0, companies: 20 }, "2026-11-27");
    expect(t.reason).toBe("companies");
  });
  it("bloquea al vencer los 90 días", () => {
    const t = trialState(member, plan, { meetings: 0, companies: 0 }, "2027-02-01");
    expect(t.reason).toBe("expired");
    expect(t.daysLeft).toBe(0);
  });
  it("respeta una fecha de término manual", () => {
    const t = trialState({ ...member, trial_end: "2026-12-15" }, plan, { meetings: 0, companies: 0 }, "2026-12-01");
    expect(t.end).toBe("2026-12-15");
    expect(t.daysLeft).toBe(14);
  });
});

describe("avance del mes y Pulso por plan", () => {
  it("avance contra la garantía", () => {
    expect(monthProgress(cfg.plans.crece, 4, 2)).toEqual({ goal: 8, done: 4, scheduled: 2, pct: 50, missing: 4 });
    expect(monthProgress(cfg.plans.conecta, 7, 0).pct).toBe(100);
  });
  it("vistas de Pulso: Freemium ninguna, Conecta sin Peitho, Crece con Peitho, Acelera todo con contactos", () => {
    expect(cfg.plans.freemium.pulsoViews).toEqual([]);
    expect(canSeePulsoView(cfg.plans.conecta, "reuniones")).toBe(true);
    expect(canSeePulsoView(cfg.plans.conecta, "peitho")).toBe(false);
    expect(canSeePulsoView(cfg.plans.crece, "peitho")).toBe(true);
    expect(cfg.plans.crece.pulsoShowContacts).toBe(false);
    expect(cfg.plans.acelera.pulsoShowContacts).toBe(true);
  });
});
