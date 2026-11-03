import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

// Clave del conector MCP del Centro de prospección (va en la URL del
// conector). Orden: variable de Vercel CENTRO_MCP_SECRET si existe; si no,
// la que la app generó y guardó en centro_settings (key = 'mcp_secret').
// Para cambiarla (si se filtra): borrar esa fila o setear la variable, y
// actualizar la URL del conector en claude.ai.

const MIN_LEN = 32;
let cached: { value: string | null; at: number } | null = null;

async function readStored(): Promise<string | null> {
  const { data, error } = await supabaseAdmin().from("centro_settings").select("value").eq("key", "mcp_secret").maybeSingle();
  if (error) return null;
  return (data?.value as string | undefined) ?? null;
}

export async function getMcpSecret(): Promise<string | null> {
  const env = process.env.CENTRO_MCP_SECRET ?? "";
  if (env.length >= MIN_LEN) return env;
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const value = await readStored();
  cached = { value: value && value.length >= MIN_LEN ? value : null, at: Date.now() };
  return cached.value;
}

// La genera si todavía no existe (la llama la pantalla del administrador).
export async function ensureMcpSecret(): Promise<string> {
  const current = await getMcpSecret();
  if (current) return current;
  const value = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await supabaseAdmin().from("centro_settings").insert({ key: "mcp_secret", value });
  if (error) {
    // Otra pestaña la creó al mismo tiempo: se usa la guardada.
    cached = null;
    const again = await getMcpSecret();
    if (again) return again;
    throw new Error(error.message);
  }
  cached = { value, at: Date.now() };
  return value;
}

export async function isValidMcpSecret(given: string): Promise<boolean> {
  const expected = await getMcpSecret();
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
