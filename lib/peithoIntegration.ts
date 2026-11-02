import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPeithoEnabled } from "@/lib/peitho";

// Conexión servidor a servidor con el backend de Peitho (Railway). El portal
// muestra Peitho a los clientes que lo tienen contratado ("Incluir Peitho")
// sin que entren a app.peithob2b.com: el backend de Peitho acepta la clave
// compartida PEITHO_INTEGRATION_KEY y reconoce al cliente por su "ID Cliente"
// de la Maestra (= id o slug del cliente acá) o, si no, por nombre
// (peitho-backend/src/bullseyeIntegration.ts). La request queda como un
// usuario "cliente" de Peitho de ese cliente: nunca ve datos de otro.
//
// Solo se reenvían las rutas de la lista de abajo (lo que muestran las vistas
// de Peitho del portal); la gestión de usuarios solo desde la app interna.

type Rule = { method: string; re: RegExp; internalOnly?: boolean };

const ID = "[A-Za-z0-9-]+";
const RULES: Rule[] = [
  { method: "GET", re: /^\/me$/ },
  { method: "GET", re: /^\/meetings$/ },
  { method: "GET", re: new RegExp(`^/meetings/${ID}$`) },
  { method: "GET", re: new RegExp(`^/meetings/${ID}/video$`) },
  { method: "POST", re: new RegExp(`^/meetings/${ID}/research$`) },
  { method: "PUT", re: new RegExp(`^/meetings/${ID}/executive$`) },
  { method: "GET", re: new RegExp(`^/clients/${ID}/executives$`) },
  { method: "GET", re: /^\/panel\/funnel$/ },
  { method: "GET", re: /^\/panel\/funnel\/rows$/ },
  { method: "GET", re: /^\/panel\/ejecutivos$/ },
  { method: "GET", re: /^\/integration\/client$/, internalOnly: true },
  { method: "GET", re: /^\/integration\/users$/, internalOnly: true },
  { method: "POST", re: /^\/integration\/users$/, internalOnly: true },
  { method: "POST", re: new RegExp(`^/integration/users/${ID}/password$`), internalOnly: true },
  { method: "DELETE", re: new RegExp(`^/integration/users/${ID}$`), internalOnly: true },
];

export type PeithoClientRef = { id: string; slug: string | null; name: string };

export function peithoConfigured(): boolean {
  return !!process.env.PEITHO_BACKEND_URL && !!process.env.PEITHO_INTEGRATION_KEY;
}

export async function loadPeithoClient(db: SupabaseClient, clientId: string): Promise<PeithoClientRef | null> {
  const { data } = await db.from("clients").select("id, slug, name").eq("id", clientId).maybeSingle();
  return data ?? null;
}

// Reenvía la request al backend de Peitho. `segments` = la ruta del
// catch-all ([...path]); la query se pasa tal cual.
export async function forwardToPeitho(
  req: Request,
  db: SupabaseClient,
  client: PeithoClientRef,
  segments: string[],
  opts: { internal: boolean }
): Promise<NextResponse> {
  if (!peithoConfigured()) {
    return NextResponse.json({ error: "La conexión con Peitho no está configurada (PEITHO_BACKEND_URL / PEITHO_INTEGRATION_KEY)" }, { status: 503 });
  }
  const path = "/" + segments.map(encodeURIComponent).join("/");
  const rule = RULES.find((r) => r.method === req.method && r.re.test(path));
  if (!rule || (rule.internalOnly && !opts.internal)) {
    return NextResponse.json({ error: "Ruta de Peitho no permitida" }, { status: 404 });
  }
  // Los datos de Peitho solo para clientes que lo tienen contratado (la
  // gestión de usuarios sí se permite antes, para dejarlo listo)
  if (!path.startsWith("/integration/") && !(await isPeithoEnabled(db, client.id))) {
    return NextResponse.json({ error: "Este cliente no tiene Peitho activado" }, { status: 403 });
  }

  const { search } = new URL(req.url);
  const headers: Record<string, string> = {
    "x-peitho-integration-key": process.env.PEITHO_INTEGRATION_KEY!,
    "x-bullseye-client-id": client.id,
    "x-bullseye-client-name": encodeURIComponent(client.name),
  };
  if (client.slug) headers["x-bullseye-client-slug"] = encodeURIComponent(client.slug);
  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "DELETE") {
    body = await req.text();
    headers["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(`${process.env.PEITHO_BACKEND_URL!.replace(/\/+$/, "")}${path}${search}`, {
      method: req.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Peitho proxy:", err);
    return NextResponse.json({ error: "No se pudo conectar con Peitho" }, { status: 502 });
  }
}
