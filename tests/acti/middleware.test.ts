import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// No regresión del middleware: un usuario interno, un cliente normal del
// portal y un anónimo siguen exactamente igual; el socio ACTI va a /acti.
let currentUser: Record<string, unknown> | null = null;
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: currentUser }, error: null }) } }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const { middleware } = await import("@/middleware");

async function hit(path: string, method = "GET") {
  const res = await middleware(new NextRequest(new URL(path, "https://portal.bullseye-abm.com"), { method }));
  const location = res.headers.get("location");
  return { status: res.status, location: location ? new URL(location).pathname : null };
}

const internal = { id: "u1", email: "equipo@bullseye-abm.com", app_metadata: {} };
const client = { id: "u2", email: "cliente@x.com", app_metadata: { role: "client", client_id: "c1" } };
const actiClient = { id: "u3", email: "socio@x.com", app_metadata: { role: "client", client_id: "c2", acti: true } };

describe("middleware", () => {
  beforeEach(() => { currentUser = null; });

  it("anónimo: login para páginas, 401 para APIs, públicas abiertas", async () => {
    expect(await hit("/dashboard")).toEqual({ status: 307, location: "/login" });
    expect((await hit("/api/companies")).status).toBe(401);
    expect((await hit("/acti")).location).toBe("/login");
    expect((await hit("/encuesta/abc")).status).toBe(200);
    expect((await hit("/api/clients")).status).toBe(200);
  });

  it("equipo interno: igual que hoy, y puede abrir la vista interna de ACTI", async () => {
    currentUser = internal;
    expect((await hit("/dashboard")).status).toBe(200);
    expect((await hit("/clientes")).status).toBe(200);
    expect((await hit("/api/clients/abc/config")).status).toBe(200);
    expect(await hit("/portal")).toEqual({ status: 307, location: "/empresas" });
    expect((await hit("/acti-equipo")).status).toBe(200);
  });

  it("cliente normal del portal: igual que hoy", async () => {
    currentUser = client;
    expect((await hit("/portal")).status).toBe(200);
    expect((await hit("/portal/radar")).status).toBe(200);
    expect((await hit("/api/portal/radar")).status).toBe(200);
    expect(await hit("/dashboard")).toEqual({ status: 307, location: "/portal" });
    expect((await hit("/api/companies")).status).toBe(403);
    expect(await hit("/acti")).toEqual({ status: 307, location: "/portal" });
    expect((await hit("/api/acti/home")).status).toBe(403);
  });

  it("socio ACTI: solo /acti", async () => {
    currentUser = actiClient;
    expect((await hit("/acti")).status).toBe(200);
    expect((await hit("/api/acti/home")).status).toBe(200);
    expect(await hit("/portal")).toEqual({ status: 307, location: "/acti" });
    expect(await hit("/dashboard")).toEqual({ status: 307, location: "/acti" });
    expect((await hit("/api/portal/radar")).status).toBe(403);
    expect((await hit("/api/acti-equipo/members")).status).toBe(403);
  });
});
