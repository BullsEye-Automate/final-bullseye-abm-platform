import { describe, expect, it } from "vitest";
import { computeBill, lastDayOf, prevMonth, toClp, type BillMeeting } from "@/lib/acti/billing";
import { DEFAULT_CONFIG, normalizeConfig } from "@/lib/acti/plans";
import { meetingStatus } from "@/lib/acti/meetings";

const cfg = normalizeConfig(DEFAULT_CONFIG);
const mt = (id: string, fecha: string, realizado: string, extra: Partial<BillMeeting> = {}): BillMeeting => ({ id, empresa: `E${id}`, fecha_reunion: fecha, fecha_agendamiento: "2026-11-02", realizado, ...extra });

const meetings: BillMeeting[] = [
  mt("1", "2026-11-05", "Si"),
  mt("2", "2026-11-10", "Si"),
  mt("3", "2026-11-12", "No"),                               // no-show: sin cargo
  mt("4", "2026-11-20", "Si", { disputa: "en_revision" }),    // en revisión: sin cargo
  mt("5", "2026-11-21", "Si", { disputa: "cobrar" }),         // revisada: se cobra
  mt("6", "2026-11-28", "Pendiente"),                         // aún no ocurre
  mt("7", "2026-10-30", "Si"),                                // otro mes
];

describe("facturación del mes", () => {
  it("Crece: base 26 UF + 3 reuniones × 4 UF, más IVA, sin cobrar no-shows ni disputas", () => {
    const b = computeBill(cfg.plans.crece, cfg.params, "activo", meetings, "2026-11");
    expect(b.baseUf).toBe(26);
    expect(b.meetingsCharged).toBe(3);
    expect(b.meetingsNoShow).toBe(1);
    expect(b.meetingsDisputed).toBe(1);
    expect(b.meetingsDone).toBe(4);
    expect(b.variableUf).toBe(12);
    expect(b.subtotalUf).toBe(38);
    expect(b.ivaUf).toBe(7.22);
    expect(b.totalUf).toBe(45.22);
    expect(b.revenueShareUf).toBe(2.6); // 10% de la base, no del variable
    expect(b.lines.map((l) => l.estado)).toEqual(["cobrada", "cobrada", "no_show", "en_revision", "cobrada"]);
  });

  it("Freemium: $0 aunque tenga reuniones", () => {
    const b = computeBill(cfg.plans.freemium, cfg.params, "en_prueba", meetings, "2026-11");
    expect(b.free).toBe(true);
    expect(b.totalUf).toBe(0);
    expect(b.meetingsCharged).toBe(0);
    expect(b.revenueShareUf).toBe(0);
  });

  it("pausado o dado de baja: sin base, pero las reuniones realizadas se cobran", () => {
    const b = computeBill(cfg.plans.conecta, cfg.params, "pausado", meetings, "2026-11");
    expect(b.baseUf).toBe(0);
    expect(b.variableUf).toBe(12);
    expect(b.revenueShareUf).toBe(0);
  });

  it("variable por reunión agendada (configurable): por fecha de agendamiento, sin no-shows", () => {
    const params = { ...cfg.params, chargeVariableOn: "agendada" as const };
    const b = computeBill(cfg.plans.conecta, params, "activo", meetings, "2026-11");
    // Agendadas en noviembre: 1, 2, 4 (disputa), 5, 6 (pendiente), 7 → no-show 3 fuera, 4 en revisión
    expect(b.meetingsCharged).toBe(5);
    expect(b.meetingsNoShow).toBe(1);
  });

  it("al cambiar el precio en la configuración cambia el cálculo", () => {
    const c = normalizeConfig({ plans: { crece: { baseUf: 30, perMeetingUf: 5 } } });
    const b = computeBill(c.plans.crece, c.params, "activo", meetings, "2026-11");
    expect(b.subtotalUf).toBe(45);
  });

  it("CLP y fechas", () => {
    expect(toClp(45.22, 39000)).toBe(1763580);
    expect(toClp(10, null)).toBeNull();
    expect(prevMonth("2027-01")).toBe("2026-12");
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
  });
});

describe("estado de la reunión para el socio", () => {
  it("según la planilla y la fecha", () => {
    expect(meetingStatus("Si", "2026-11-01", "2026-11-27")).toBe("realizada");
    expect(meetingStatus("No", "2026-11-01", "2026-11-27")).toBe("no_show");
    expect(meetingStatus("Pendiente", "2026-12-01", "2026-11-27")).toBe("proxima");
    expect(meetingStatus("Pendiente", "2026-11-20", "2026-11-27")).toBe("por_confirmar");
    expect(meetingStatus("Reagendar", "2026-11-20", "2026-11-27")).toBe("reagendada");
  });
});
