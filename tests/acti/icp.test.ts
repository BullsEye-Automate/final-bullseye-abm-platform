import { describe, expect, it } from "vitest";
import { deserializeIcpForm, EMPTY_FORM, serializeIcpForm, serializeSectionForm, type IcpFormData } from "@/lib/icp-form";
import { icpHash } from "@/lib/wishlistFit";
import { decodePersonas, encodePersonas } from "@/lib/acti/icp";

// ICP de un cliente actual (sin los campos nuevos de ACTI)
const legacy: IcpFormData = {
  ...EMPTY_FORM,
  nombre_empresa: "Acme",
  descripcion_negocio: "Software de logística",
  industrias_objetivo: "Retail, Minería",
  tamano_empresa: ["51–100", "101–200"],
  geografias: "Chile, Perú",
  senales_positivas: "Expansión regional",
  cargos_decisores: "Gerente de Operaciones",
  departamentos: ["Operaciones"],
  seniority: ["Director"],
  propuesta_valor: "Bajamos costos de última milla",
  diferenciadores: "Implementación en 30 días",
  objeciones: "Precio → ROI en 6 meses",
  mejores_clientes: "Falabella",
  ticket_acv: "USD 30K, 4 meses",
};

describe("ICP compartido: campos nuevos opcionales", () => {
  it("el ICP de un cliente actual queda idéntico (mismo texto y mismo hash de fit)", () => {
    const { regulaciones, buyer_personas_extra, servicios, casos_exito, no_ofrecer, ...base } = EMPTY_FORM;
    void regulaciones; void buyer_personas_extra; void servicios; void casos_exito; void no_ofrecer;
    const oldShape = { ...base, ...legacy } as IcpFormData;
    delete (oldShape as Partial<IcpFormData>).regulaciones;
    const text = serializeIcpForm(oldShape);
    expect(text).not.toMatch(/Regulaciones|Servicios que ofreces|Casos de éxito|no se debe ofrecer|Buyer personas adicionales/);
    // Ida y vuelta (lo que hace Sistema → ICP al guardar): mismo texto
    const again = serializeIcpForm(deserializeIcpForm(text));
    expect(again).toBe(text);
    expect(icpHash(again)).toBe(icpHash(text));
  });

  it("los campos nuevos se guardan y sobreviven a una edición desde Sistema → ICP", () => {
    const text = serializeIcpForm({ ...legacy, regulaciones: "Ley 21.663", servicios: "SOC 24/7", casos_exito: "Banco X: -40% incidentes", no_ofrecer: "Descuentos", buyer_personas_extra: "Persona 2: Finanzas\n- Cargos: CFO" });
    const form = deserializeIcpForm(text);
    expect(form.regulaciones).toBe("Ley 21.663");
    expect(form.servicios).toBe("SOC 24/7");
    expect(form.casos_exito).toBe("Banco X: -40% incidentes");
    expect(form.no_ofrecer).toBe("Descuentos");
    expect(form.buyer_personas_extra).toBe("Persona 2: Finanzas\n- Cargos: CFO");
    // El equipo edita otro campo en Sistema → ICP: lo de ACTI se conserva
    const edited = deserializeIcpForm(serializeIcpForm({ ...form, geografias: "Chile" }));
    expect(edited.servicios).toBe("SOC 24/7");
    expect(edited.geografias).toBe("Chile");
    expect(edited.propuesta_valor).toBe("Bajamos costos de última milla");
  });

  it("modo por industria conserva los campos nuevos", () => {
    const form = { ...legacy, servicios: "SOC", buyer_personas_extra: "Persona 2: X" };
    expect(serializeSectionForm("value_prop", form)).toContain("SOC");
    expect(serializeSectionForm("buyer_persona", form)).toContain("Persona 2: X");
  });
});

describe("buyer personas adicionales", () => {
  it("ida y vuelta", () => {
    const list = [
      { name: "Decisor de finanzas", area: "Finanzas", level: "Gerente", titles: "CFO, Gerente de Finanzas", pains: "Control de costos" },
      { name: "TI", area: "Tecnología", level: "", titles: "CIO", pains: "" },
    ];
    const text = encodePersonas(list);
    expect(text).toContain("Persona 2: Decisor de finanzas");
    expect(text).toContain("Persona 3: TI");
    expect(decodePersonas(text)).toEqual(list);
  });
  it("no rompe el formato del ICP", () => {
    const text = encodePersonas([{ name: "[x]", area: "a\n[b]", level: "---", titles: "t", pains: "" }]);
    expect(text).not.toMatch(/\n\[|\n-{3,}/);
    const icp = serializeIcpForm({ ...legacy, buyer_personas_extra: text });
    expect(deserializeIcpForm(icp).buyer_personas_extra).toBe(text);
  });
  it("sin personas = vacío", () => {
    expect(encodePersonas([{ name: "", area: "x", level: "", titles: "", pains: "" }])).toBe("");
    expect(decodePersonas("")).toEqual([]);
  });
});
