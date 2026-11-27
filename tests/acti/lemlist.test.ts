import { afterEach, describe, expect, it } from "vitest";
import { clientLemlistListNames, getClientOwnLemlistKey } from "@/lib/lemlistDatabase";

// Base falsa mínima: client_configs (key propia), acti_members (socios) y clients
function fakeDb(opts: { ownKey?: string | null; acti?: boolean; name?: string }) {
  return {
    from(table: string) {
      const row =
        table === "client_configs" ? (opts.ownKey !== undefined ? { lemlist_api_key: opts.ownKey } : null)
        : table === "acti_members" ? (opts.acti ? { client_id: "c1" } : null)
        : table === "clients" ? { name: opts.name ?? "Nube Segura" }
        : null;
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) };
      return q;
    },
  } as never;
}

describe("Lemlist: socios ACTI usan la cuenta de BullsEye", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it("cliente normal: igual que antes (key propia o nada, nunca la de BullsEye)", async () => {
    process.env.LEMLIST_API_KEY = "be-key";
    expect(await getClientOwnLemlistKey(fakeDb({ ownKey: "propia" }), "c1")).toBe("propia");
    expect(await getClientOwnLemlistKey(fakeDb({ ownKey: null }), "c1")).toBeNull();
    expect(await getClientOwnLemlistKey(fakeDb({}), "c1")).toBeNull();
    expect(await clientLemlistListNames(fakeDb({ ownKey: "propia" }), "c1")).toEqual({ companies: "Wishlist BullsEye", contacts: "Contactos Wishlist BullsEye" });
    expect(await clientLemlistListNames(fakeDb({}), "c1")).toEqual({ companies: "Wishlist BullsEye", contacts: "Contactos Wishlist BullsEye" });
  });

  it("socio ACTI sin key propia: key de BullsEye y listas propias del socio", async () => {
    process.env.LEMLIST_API_KEY = "be-key";
    delete process.env.ACTI_LEMLIST_API_KEY;
    expect(await getClientOwnLemlistKey(fakeDb({ acti: true }), "c1")).toBe("be-key");
    process.env.ACTI_LEMLIST_API_KEY = "acti-key";
    expect(await getClientOwnLemlistKey(fakeDb({ acti: true }), "c1")).toBe("acti-key");
    expect(await clientLemlistListNames(fakeDb({ acti: true, name: "Nube  Segura" }), "c1")).toEqual({
      companies: "ACTI · Nube Segura · Empresas",
      contacts: "ACTI · Nube Segura · Contactos",
    });
  });

  it("socio ACTI con key propia: usa la suya y las listas de siempre", async () => {
    process.env.LEMLIST_API_KEY = "be-key";
    expect(await getClientOwnLemlistKey(fakeDb({ ownKey: "propia", acti: true }), "c1")).toBe("propia");
    expect((await clientLemlistListNames(fakeDb({ ownKey: "propia", acti: true }), "c1")).companies).toBe("Wishlist BullsEye");
  });
});
